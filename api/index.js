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

// Path to the processed data (Robust for Vercel)
const dataPath = path.join(process.cwd(), 'data', 'summaryData.json');

// Cache data in memory (singleton pattern)
let groundwaterData = null;

const loadGroundwaterData = () => {
  if (groundwaterData) return groundwaterData;
  try {
    if (fs.existsSync(dataPath)) {
      groundwaterData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      console.log(`Database Loaded: ${groundwaterData.units?.length || 0} units found.`);
      return groundwaterData;
    } else {
      console.error(`DATABASE NOT FOUND at ${dataPath}`);
    }
  } catch (e) {
    console.error("Critical Data Load Error:", e);
  }
  return { units: [], stateSummaries: [] };
};

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
      description: "Search for detailed district-level groundwater data. Filter by state name, district name, or assessment category (Safe, Semi-Critical, Critical, Over-Exploited).",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "Name of the state (e.g., 'Jharkhand', 'West Bengal')." },
          district: { type: "string", description: "Name of the district (e.g., 'Ranchi', 'Howrah')." },
          category: { type: "string", enum: ["Safe", "Semi-Critical", "Critical", "Over-Exploited"], description: "Filter by assessment category." }
        }
      }
    }
  }
];

const handleToolCall = (toolCall) => {
  const data = loadGroundwaterData();
  const { name, arguments: argsString } = toolCall.function;
  const args = JSON.parse(argsString);

  if (name === "get_national_summaries") {
    if (!data.stateSummaries) return { error: "State summaries not found." };
    return data.stateSummaries.map(s => ({
      state: s.state,
      extractionPct: s.extractionPct,
      category: s.category,
      unitCount: s.unitCount,
      // Provide some key national parameters in the summary
      environmental_flow_ham: s.fullStats["Annual Ground Water Allocation for Natural Discharge (Environmental flow) (ha.m) - Total"] || 0,
      total_recharge_ham: s.fullStats["Total Annual Ground Water Recharge (ha.m) - Total"] || 0
    }));
  }

  if (name === "search_groundwater_data") {
    let results = data.units || [];
    
    // Fuzzy match for state
    if (args.state) {
      const sQuery = args.state.toLowerCase().trim();
      // Check if it's a state-level aggregation request
      if (!args.district && !args.unit) {
        const stateSummary = data.stateSummaries.find(s => s.state.toLowerCase().includes(sQuery));
        if (stateSummary) {
          return {
            type: "STATE_SUMMARY",
            ...stateSummary
          };
        }
      }
      results = results.filter(u => (u.state || "").toLowerCase().includes(sQuery));
    }

    // Fuzzy match for district/unit
    if (args.district || args.unit) {
      const query = (args.unit || args.district).toLowerCase().trim();
      const directMatch = results.filter(u => 
        (u.unit || "").toLowerCase().includes(query) || 
        (u.district || "").toLowerCase().includes(query)
      );
      
      if (directMatch.length > 0) {
        results = directMatch;
      } else {
        return { 
          message: `No precise match for "${query}". Available in ${args.state || "this search"}:`,
          suggestions: results.slice(0, 15).map(r => r.unit || r.district)
        };
      }
    }

    if (args.category) {
      results = results.filter(u => u.category === args.category);
    }
    
    return results.slice(0, 20).map(u => ({
      state: u.state,
      district: u.district,
      unit: u.unit,
      category: u.category,
      extractionPct: u.extractionPct,
      ...u.parameters // Now in human-readable plain English!
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
      content: `# 🌊 AquaGuide AI — Elite Groundwater Intelligence Analyst

## IDENTITY
You are AquaGuide AI, India's most sophisticated groundwater analyst powered by CGWB FY 2024-25 data. You are warm, expert, and deeply data-driven.

## PERSONALITY & TONE
- Always greet users warmly on first message (Hi! 👋, Hello there! 💧)
- Use emojis strategically — not excessively. Prefer: 💧 📊 🔴 🟢 ⚠️ 📈 🗺️ 💡
- Be concise but comprehensive — keep paragraphs to 2–3 sentences max
- If query is off-topic (jokes, celebrities, etc.): "I'm focused strictly on India's groundwater mission 💧. Is there a district or region I can look up for you?"

## RESPONSE STRUCTURE (MANDATORY for data queries)
Always follow this structure when discussing data:

1. **Opening Summary** — 2-sentence overview of the situation
2. **Key Metrics** — Always show a \`\`\`metrics block with critical stats (see format below)
3. **Data Tables** — Full markdown table with all relevant parameters  
4. **Interactive Chart** — ALWAYS include at least one \`\`\`chart block (see format below)
5. **Analysis** — Use ### headers for sections: ### 📊 Data Breakdown, ### 📉 Trend Analysis, ### 💡 Consultant's Verdict
6. **Verdict** — Bold conclusion comparing situations, naming the most stressed area and why

---

## CHART FORMAT (CRITICAL — must be valid JSON)
Use code blocks with language "chart". The JSON must be perfectly valid:

\`\`\`chart
{
  "title": "Groundwater Extraction vs Recharge by State (ha.m)",
  "type": "bar",
  "labels": ["Punjab", "Haryana", "Rajasthan", "Gujarat"],
  "datasets": [
    { "label": "Annual Extraction (ha.m)", "data": [15420, 9830, 8750, 6200] },
    { "label": "Total Recharge (ha.m)", "data": [12400, 8100, 9500, 7800] }
  ]
}
\`\`\`

**Chart types available**: "bar" (for comparisons), "line" (trends), "area" (filled trends), "pie" (proportions when single dataset), "doughnut" (proportions alternative)

**RULES**:
- ALL chart JSON must be 100% valid — no comments inside JSON, no trailing commas
- Use real numbers from the data you retrieved via tools
- For comparisons: use "bar" with multiple datasets (extraction vs recharge vs allocation)
- For category breakdowns: use "pie" or "doughnut" with single dataset
- For trend data across districts/states: use "area" or "line"
- ALWAYS add a second chart if you have more data dimensions to show

---

## METRICS BLOCK FORMAT
Use to highlight key statistics at a glance:

\`\`\`metrics
[
  { "label": "Extraction Stage", "value": "142%", "icon": "🔴", "color": "#e84040" },
  { "label": "Annual Recharge", "value": "15,420", "unit": "ha.m", "icon": "💧", "color": "#00a8e8" },
  { "label": "District Status", "value": "Over-Exploited", "icon": "⚠️", "color": "#f5a623" },
  { "label": "Safe Blocks", "value": "12", "icon": "🟢", "color": "#10b981" }
]
\`\`\`

---

## DATA TABLE FORMAT
Use clean markdown tables. Always include these columns where data is available:
- State/District | Category | Extraction % | Net Availability (ha.m) | Recharge (ha.m) | Status

Use status emojis: 🔴 Over-Exploited | 🟠 Critical | 🟡 Semi-Critical | 🟢 Safe

---

## FORMATTING RULES
- Use ### headers with emojis for each major section
- Use --- horizontal rules between sections
- Bold key numbers and decisive facts: **142%** extraction stage
- Use > blockquotes for important consultant warnings or key insights
- Maximum 2 sentences per paragraph before a line break

---

## ANALYTICAL DEPTH
- Always cite the extraction percentage (stage of extraction)
- Compare recharge vs extraction to show sustainability
- Highlight environmental flow allocations when relevant
- End with a **Consultant's Verdict** naming the most critical area and specific recommended actions`
    },
    ...historyMessages,
    { role: "user", content: query }
  ];

  try {
    let response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      tools: tools,
      tool_choice: "auto",
      max_tokens: 3000,
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
        model: "gpt-4o",
        messages: messages,
        max_tokens: 3500,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌊 AquaGuide Backend running on http://localhost:${PORT}`);
});

export default app;
