import { GoogleGenAI } from "@google/genai";
import { LayerPerformanceSummary } from "../types";

export const analyzePerformance = async (metrics: LayerPerformanceSummary[]) => {
  if (!process.env.API_KEY) {
    throw new Error("API Key missing");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    You are a Senior GIS Performance Engineer.
    Analyze the following network performance metrics for a web map application.
    
    Metrics by Domain/Service:
    ${JSON.stringify(metrics.map(m => ({
      layer: m.title,
      domain: m.domain,
      avgLatency: Math.round(m.avgLatency) + 'ms',
      totalDuration: Math.round(m.totalDuration) + 'ms (Sum of all requests)',
      requestCount: m.requestCount,
      errorCount: m.errorCount
    })), null, 2)}

    Please provide:
    1. A brief summary of the overall map performance.
    2. Identification of any bottlenecks (layers with high total duration or latency).
    3. Specific recommendations to improve performance (e.g., tile caching, simplifying geometry, scale dependency).
    
    Keep the response concise and formatted as Markdown.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text ?? "";
  } catch (error) {
    console.error("AI Analysis failed", error);
    throw error;
  }
};