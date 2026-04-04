import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.VITE_OPENAI_API_KEY,
});

// Path to the processed data
const dataPath = path.resolve(__dirname, '../data/summaryData.json');

// Load full data into memory once
let groundwaterData = { districts: [] };
try {
  if (fs.existsSync(dataPath)) {
    groundwaterData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  }
} catch (e) {
  console.error("Critical Data Load Error:", e);
}

// ─── AI Tools (Function Calling) ─────────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "get_national_summaries",
      description: "Get groundwater assessment summaries for all 36 States/UTs in India (FY 2024-25). Use this for national comparisons or identifying top/bottom states.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "search_groundwater_data",
      description: "Search for detailed district-level groundwater data. You can filter by state name, district name, or assessment category (Safe, Semi-Critical, Critical, Over-Exploited).",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "Name of the state (e.g., 'Jharkhand', 'Maharashtra')." },
          district: { type: "string", description: "Name of the district (e.g., 'Ranchi', 'Pune')." },
          category: { type: "string", enum: ["Safe", "Semi-Critical", "Critical", "Over-Exploited"], description: "Filter by assessment category." }
        }
      }
    }
  }
];

const handleToolCall = (toolCall) => {
  const { name, arguments: argsString } = toolCall.function;
  const args = JSON.parse(argsString);

  if (name === "get_national_summaries") {
    // Aggregate data for all states
    const stateMap = {};
    groundwaterData.districts.forEach(d => {
      const sName = d.state.toUpperCase();
      if (!stateMap[sName]) {
        stateMap[sName] = { state: sName, extractionPct: 0, category: "Safe", _totalExtractable: 0, _totalExtraction: 0 };
      }
      const s = stateMap[sName];
      s._totalExtractable += (d.rawData["Annual Extractable Ground water Resource (ham) - Total"] || 0);
      s._totalExtraction += (d.rawData["Ground Water Extraction for all uses (ha.m) - Total"] || 0);
    });

    return Object.values(stateMap).map(s => {
      s.extractionPct = s._totalExtractable > 0 ? (s._totalExtraction / s._totalExtractable * 100) : 0;
      if (s.extractionPct > 100) s.category = "Over-Exploited";
      else if (s.extractionPct > 90) s.category = "Critical";
      else if (s.extractionPct > 70) s.category = "Semi-Critical";
      else s.category = "Safe";
      delete s._totalExtractable;
      delete s._totalExtraction;
      return s;
    });
  }

  if (name === "search_groundwater_data") {
    let results = groundwaterData.districts;
    if (args.state) results = results.filter(d => d.state.toLowerCase().includes(args.state.toLowerCase()));
    if (args.district) results = results.filter(d => d.district.toLowerCase().includes(args.district.toLowerCase()));
    if (args.category) results = results.filter(d => d.category === args.category);
    
    // Return only top 50 matches to stay within token limits
    return results.slice(0, 50).map(d => ({
      state: d.state,
      district: d.district,
      category: d.category,
      extractionPct: d.extractionPct,
      extraction_ham: d.rawData["Ground Water Extraction for all uses (ha.m) - Total"],
      recharge_ham: d.rawData["Annual Ground water Recharge (ham) - Total"],
      quality: d.rawData["Quality Tagging - Major Parameter Present - C"]
    }));
  }

  return { error: "Unknown tool" };
};

// ─── Chat Route ──────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { query, chatHistory } = req.body;

  if (!process.env.VITE_OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API Key not configured on server.' });
  }

  const historyMessages = (chatHistory || []).slice(-6).map(m => ({
    role: m.role === "ai" || m.role === "assistant" ? "assistant" : "user",
    content: m.text || m.content
  }));

  const messages = [
    { 
      role: "system", 
      content: `You are AquaGuide AI, a groundwater specialist for INGRES (India).
      
      RULES:
      1. You have tools to access dynamic CGWB FY 2024-25 data for 36 States/UTs and 713+ districts.
      2. If you need data, call the appropriate search tool. 
      3. Never say "I don't have data" without calling a tool first.
      4. If a search yields zero results, mention you checked the CGWB 2024 records and found no matching location.
      5. Keep responses professional, data-driven, and human-friendly.` 
    },
    ...historyMessages,
    { role: "user", content: query }
  ];

  try {
    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      tools: tools,
      tool_choice: "auto"
    });

    const responseMessage = response.choices[0].message;

    // Handle single tool call sequence
    if (responseMessage.tool_calls) {
      messages.push(responseMessage);
      
      for (const toolCall of responseMessage.tool_calls) {
        const toolResult = handleToolCall(toolCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(toolResult)
        });
      }

      const finalResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages
      });
      
      res.json({ text: finalResponse.choices[0].message.content });
    } else {
      res.json({ text: responseMessage.content });
    }
  } catch (error) {
    console.error('OpenAI Error:', error);
    res.status(500).json({ error: 'Error communicating with AI service.' });
  }
});

app.get('/api/data', (req, res) => {
  try {
    if (fs.existsSync(dataPath)) {
      const data = fs.readFileSync(dataPath, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.status(404).json({ 
        error: 'Data not found', 
        message: 'Ensure summaryData.json exists in the data directory.' 
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (req, res) => {
  res.send('AquaGuide Backend API is running.');
});

export default app;
