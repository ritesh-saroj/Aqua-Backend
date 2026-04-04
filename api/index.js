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

// Helper to search and filter data for the AI
function getRelevantContext(query, chatHistory, data) {
  const queryLower = query.toLowerCase();
  const historyText = chatHistory.slice(-3).map(m => m.content.toLowerCase()).join(" ");
  const combined = queryLower + " " + historyText;

  // 1. Always provide state-level summaries for ALL states (very important for comparisons)
  // We calculate these state summaries if they don't exist, or just use the pre-calculated ones if the data structure has them.
  // Given the current summaryData.json structure, we need to aggregate or use the pre-parsed format.
  
  const statesArr = [];
  const stateMap = {};

  // For efficiency in the AI prompt, we'll only send the most critical fields for the states
  data.districts.forEach(d => {
    const sName = d.state.toUpperCase();
    if (!stateMap[sName]) {
      stateMap[sName] = {
        state: sName,
        extractionPct: 0,
        category: "Safe",
        _count: 0,
        _totalExtractable: 0,
        _totalExtraction: 0
      };
      statesArr.push(stateMap[sName]);
    }
    const s = stateMap[sName];
    s._count++;
    s._totalExtractable += (d.rawData["Annual Extractable Ground water Resource (ham) - Total"] || 0);
    s._totalExtraction += (d.rawData["Ground Water Extraction for all uses (ha.m) - Total"] || 0);
  });

  statesArr.forEach(s => {
    s.extractionPct = s._totalExtractable > 0 ? (s._totalExtraction / s._totalExtractable * 100) : 0;
    if (s.extractionPct > 100) s.category = "Over-Exploited";
    else if (s.extractionPct > 90) s.category = "Critical";
    else if (s.extractionPct > 70) s.category = "Semi-Critical";
    else s.category = "Safe";
    
    // Clean up internal keys
    delete s._count;
    delete s._totalExtractable;
    delete s._totalExtraction;
  });

  const context = {
    state_summaries: statesArr,
    detailed_districts: []
  };

  // 2. Identify mentioned states and include their full district details
  const mentionedStates = statesArr.filter(s => 
    combined.includes(s.state.toLowerCase()) || 
    (s.state.length > 5 && combined.includes(s.state.toLowerCase().substring(0, 5)))
  );

  if (mentionedStates.length > 0) {
    const sNames = mentionedStates.map(s => s.state);
    context.detailed_districts = data.districts.filter(d => sNames.includes(d.state.toUpperCase()));
  }

  return context;
}

app.post('/api/chat', async (req, res) => {
  const { query, chatHistory } = req.body;

  if (!process.env.VITE_OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API Key not configured on server.' });
  }

  // Load full data from disk
  let fullData = { districts: [] };
  try {
    if (fs.existsSync(dataPath)) {
      fullData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
  } catch (e) {
    console.error("Data Load Error:", e);
  }

  const historyMessages = (chatHistory || []).slice(-6).map(m => ({
    role: m.role === "ai" || m.role === "assistant" ? "assistant" : "user",
    content: m.text || m.content
  }));

  const dataContext = getRelevantContext(query, historyMessages, fullData);

  const prompt = `
You are AquaGuide AI, a friendly and intelligent groundwater assistant for India.

CONVERSATION RULES:
- If the user says a greeting, respond warmly and briefly.
- If the user asks something unrelated to groundwater, politely redirect them.
- ALWAYS use the DATA CONTEXT below to answer groundwater queries.

DATA CONTEXT RULES:
- You have access to the full CGWB FY 2024-25 database through me.
- I have provided State Summaries for all of India below.
- I have also provided detailed District/Block data for the states you are currently discussing.
- If you need data for a state that isn't in "detailed_districts", use the "state_summaries" and tell the user: "I have the overall status for [State]. Would you like me to pull up the district-level details?"

DATA CONTEXT:
${JSON.stringify(dataContext)}

User Query: "${query}"
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        ...historyMessages,
        { role: "user", content: query }
      ]
    });

    res.json({ text: response.choices[0].message.content });
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
