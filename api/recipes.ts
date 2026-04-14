import { GoogleGenAI, Type } from "@google/genai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ingredients } = req.body;
    
    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ error: "Invalid ingredients list" });
    }

    // Check for our custom key name
    const GEMINI_API_KEY = process.env.MY_CUSTOM_GEMINI_KEY || process.env.GEMINI_API_KEY || "";

    if (!GEMINI_API_KEY || GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
      return res.status(500).json({ 
        error: "Konfigurasi Server Error", 
        details: "Kunci API Gemini belum dipasang di Vercel. Silakan cek Environment Variables." 
      });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const ingredientList = ingredients.map((i: any) => `${i.name} (${i.category})`).join(", ");
    const prompt = `As a smart kitchen assistant, suggest 3 recipes based on these available ingredients: ${ingredientList}.
    
    Logic:
    1. If there are ingredients with category "Daging", prioritize recipes that use them as the main protein.
    2. If some ingredients are missing for a great recipe, include them in the "missingIngredients" list.
    3. Calculate a "matchScore" (0-100) based on how many available ingredients are used vs total ingredients needed.
    4. Rank recipes that use the most available ingredients (especially spices/vegetables) at the top.
    
    Provide the output in JSON format.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
              missingIngredients: { type: Type.ARRAY, items: { type: Type.STRING } },
              instructions: { type: Type.ARRAY, items: { type: Type.STRING } },
              prepTime: { type: Type.STRING },
              matchScore: { type: Type.NUMBER }
            },
            required: ["title", "ingredients", "missingIngredients", "instructions", "prepTime", "matchScore"]
          }
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response from Gemini");
    }
    
    res.status(200).json(JSON.parse(responseText));
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: "Failed to generate recipes", details: error.message });
  }
}
