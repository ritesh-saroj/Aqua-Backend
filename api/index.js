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

app.post('/api/chat', async (req, res) => {
  const { query, data, chatHistory } = req.body;

  if (!process.env.VITE_OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API Key not configured on server.' });
  }

  const prompt = `
You are AquaGuide AI, a friendly and intelligent groundwater assistant for India.

CONVERSATION RULES:
- If the user says a greeting (hi, hello, hey, namaste, etc.), respond warmly and briefly. Introduce yourself and ask how you can help with groundwater queries. Do NOT dump data.
- If the user says thanks, goodbye, okay, cool, etc., respond naturally and briefly like a human would.
- If the user asks something unrelated to groundwater or water (like weather, sports, coding, etc.), politely say you specialize in groundwater intelligence and redirect them. 
- If the user asks "what can you do" or "help", list your capabilities briefly.
- ONLY use the DATA CONTEXT below when the user asks an actual groundwater/water-related question.

CONTEXT AWARENESS (VERY IMPORTANT):
- You receive the last few messages of the conversation. USE THEM to understand what the user is referring to.
- If the user says "it", "this state", "that", "there", "which districts in it", etc., look at the previous messages to figure out which state/district they mean.
- ALWAYS continue the conversation in the context of the topic being discussed. Do NOT switch to national data unless explicitly asked.
- Understand common typos, grammatical errors, abbreviations, and informal language. Examples: "gimme", "wats", "hw is", "tel me", "show me abt", "kritical" = critical, "xploited" = exploited, "grndwater" = groundwater.

DATA ACCURACY RULES (CRITICAL — FOLLOW STRICTLY):
- You are part of the INGRES (India's National Ground Water Resource Estimation System).
- You ONLY have CGWB (Central Ground Water Board) assessment data for FY 2024-25. NO other year exists.
- If the user asks about 2023, 2022, 2020, or ANY other year: say "I only have FY 2024-25 data from CGWB. Would you like me to show that instead?"
- NEVER fabricate, guess, estimate, or hallucinate ANY number. Every number you cite MUST come from the DATA CONTEXT below.
- If a state, district, or block is NOT in the DATA CONTEXT, say "I don't have data for [name] in my database."
- Do NOT use your general training knowledge for any data answers. ONLY use what is in DATA CONTEXT.

AVAILABLE DATA FIELDS (per district/block):
- Rainfall (mm), Geographical area (ha), Recharge worthy area
- Ground Water Recharge (from rainfall, canals, irrigation, tanks, conservation structures)
- Annual Ground Water Recharge, Environmental Flows
- Annual Extractable Ground Water Resource
- Ground Water Extraction for all uses
- Stage of Ground Water Extraction (%) — this determines category: Safe (<70%), Semi-Critical (70-90%), Critical (90-100%), Over-Exploited (>100%)
- Allocation for Domestic Use (projected 2025)
- Net Annual Ground Water Availability for Future Use
- Quality Tagging (what contaminants are present)

DATA CONTEXT:
${JSON.stringify(data)}

User Query: "${query}"
`;

  try {
    const historyMessages = chatHistory.slice(-6).map(m => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.text
    }));

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
