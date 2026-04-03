import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);
  console.log("Fetching models...");
  try {
    // Actually the SDK might not have listModels easily exposed in older versions, let's try a test prompt with gemini-pro
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const res = await model.generateContent("Test");
    console.log("gemini-pro success:", res.response.text());
  } catch(e) {
    console.log("gemini-pro error", e.message);
  }
}
run();
