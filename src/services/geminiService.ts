import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Recipe {
  title: string;
  ingredients: string[];
  missingIngredients: string[];
  instructions: string[];
  prepTime: string;
  matchScore: number;
}

export interface IngredientInfo {
  name: string;
  category: string;
}

export async function getRecipeRecommendations(availableIngredients: IngredientInfo[]): Promise<Recipe[]> {
  if (availableIngredients.length === 0) return [];

  // Sort to prioritize Meat (Daging) and limit to top 15 for context
  const sortedIngredients = [...availableIngredients].sort((a, b) => {
    if (a.category === "Daging" && b.category !== "Daging") return -1;
    if (a.category !== "Daging" && b.category === "Daging") return 1;
    return 0;
  }).slice(0, 15);

  const ingredientList = sortedIngredients.map(i => `${i.name} (${i.category})`).join(", ");

  const prompt = `As a smart kitchen assistant, suggest 3 recipes based on these available ingredients: ${ingredientList}.
  
  Logic:
  1. If there are ingredients with category "Daging", prioritize recipes that use them as the main protein.
  2. If some ingredients are missing for a great recipe, include them in the "missingIngredients" list.
  3. Calculate a "matchScore" (0-100) based on how many available ingredients are used vs total ingredients needed.
  4. Rank recipes that use the most available ingredients (especially spices/vegetables) at the top.
  
  Provide the output in JSON format.`;

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
              ingredients: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All ingredients needed" },
              missingIngredients: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Ingredients NOT in the available list" },
              instructions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Step-by-step instructions" },
              prepTime: { type: Type.STRING, description: "Estimated preparation time" },
              matchScore: { type: Type.NUMBER, description: "Score from 0-100 based on ingredient availability" }
            },
            required: ["title", "ingredients", "missingIngredients", "instructions", "prepTime", "matchScore"]
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
