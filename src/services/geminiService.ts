import { GoogleGenAI, Type } from "@google/genai";

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

export interface RecipeResponse {
  recipes: Recipe[];
  isFallback: boolean;
}

// Initialize Gemini in the frontend as per skill guidelines
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Cache TTL: 24 hours
const CACHE_TTL = 1000 * 60 * 60 * 24;

export async function getRecipeRecommendations(availableIngredients: IngredientInfo[]): Promise<RecipeResponse> {
  if (availableIngredients.length === 0) return { recipes: [], isFallback: false };

  // Create a cache key from sorted ingredient names
  const cacheKey = `recipes_${availableIngredients
    .map((i) => i.name.toLowerCase())
    .sort()
    .join("|")}`;

  try {
    // Check localStorage cache
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData);
      if (Date.now() - timestamp < CACHE_TTL) {
        console.log("Serving recipes from local cache");
        return { recipes: data, isFallback: false };
      }
    }

    const ingredientList = availableIngredients.map((i) => `${i.name} (${i.category})`).join(", ");
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

    let responseText = response.text || "";
    // Clean markdown if present
    responseText = responseText.replace(/```json\n?|```/g, "").trim();
    
    if (!responseText) {
      throw new Error("Empty response from Gemini");
    }
    
    const recipes = JSON.parse(responseText);
    
    // Save to localStorage cache
    localStorage.setItem(cacheKey, JSON.stringify({ data: recipes, timestamp: Date.now() }));
    
    return { recipes, isFallback: false };
  } catch (error: any) {
    console.error("Error getting recipe recommendations:", error);
    
    // Handle Quota Exceeded specifically
    if (error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      console.warn("Gemini Quota Hit - Serving Fallback Recipes");
      
      const fallbackRecipes = [
        {
          title: "Nasi Goreng Spesial Dapur",
          ingredients: ["Nasi putih", "Bawang merah", "Bawang putih", "Telur", "Kecap manis"],
          missingIngredients: ["Ayam suwir", "Kerupuk"],
          instructions: ["Tumis bumbu halus", "Masukkan telur dan orak-arik", "Masukkan nasi dan kecap", "Aduk hingga merata"],
          prepTime: "15 menit",
          matchScore: 85
        },
        {
          title: "Omelet Sayur Sehat",
          ingredients: ["Telur", "Garam", "Merica"],
          missingIngredients: ["Bayam", "Jamur", "Keju"],
          instructions: ["Kocok telur dengan bumbu", "Tumis sayuran (jika ada)", "Tuang telur ke wajan", "Masak hingga matang"],
          prepTime: "10 menit",
          matchScore: 70
        },
        {
          title: "Tumis Bahan Tersedia",
          ingredients: ["Bahan yang ada di stok Anda"],
          missingIngredients: [],
          instructions: ["Potong semua bahan", "Tumis dengan bawang putih", "Tambahkan sedikit air dan bumbu", "Sajikan selagi hangat"],
          prepTime: "20 menit",
          matchScore: 90
        }
      ];

      return { recipes: fallbackRecipes, isFallback: true };
    }
    throw error;
  }
}

export interface AnalyzedItem {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  estimatedExpiryDays: number;
}

export async function analyzeImageForInventory(base64Image: string, mimeType: string): Promise<AnalyzedItem[]> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    
    const imagePart = {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    };

    const textPart = {
      text: `Identify food items from this image (receipt or product label). 
      Extract the following information for each item:
      - name (product name)
      - category (e.g., Sayuran, Daging, Bumbu, Buah, dll)
      - quantity (numeric)
      - unit (e.g., kg, gram, pcs, liter)
      - estimatedExpiryDays (integer, how many days the item typically lasts if not specified)
      
      Return ONLY a JSON array of objects following the defined schema. 
      If it's a receipt, list multiple items. If it's a single product, list one item.
      Language: use Indonesian for names and categories.`,
    };

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [imagePart, textPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              quantity: { type: Type.NUMBER },
              unit: { type: Type.STRING },
              estimatedExpiryDays: { type: Type.NUMBER },
            },
            required: ["name", "category", "quantity", "unit", "estimatedExpiryDays"]
          }
        }
      }
    });

    const responseText = response.text || "";
    return JSON.parse(responseText.replace(/```json\n?|```/g, "").trim());
  } catch (error) {
    console.error("Error analyzing image:", error);
    throw new Error("Gagal mengenali gambar.");
  }
}
