import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Recipe {
  title: string;
  ingredients: string[];
  instructions: string[];
  prepTime: string;
}

export async function getRecipeRecommendations(availableIngredients: string[]): Promise<Recipe[]> {
  if (availableIngredients.length === 0) return [];

  const prompt = `Based on these available ingredients: ${availableIngredients.join(", ")}, suggest 3 simple and healthy recipes. 
  Focus on using the ingredients provided. Provide the output in JSON format.`;

  try {
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
              title: { type: Type.STRING, description: "The name of the recipe" },
              ingredients: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of ingredients" },
              instructions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Step-by-step instructions" },
              prepTime: { type: Type.STRING, description: "Estimated preparation time" }
            },
            required: ["title", "ingredients", "instructions", "prepTime"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as Recipe[];
  } catch (error) {
    console.error("Error getting recipe recommendations:", error);
    return [];
  }
}
