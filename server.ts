import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini AI Setup (Server-side)
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
    console.warn("WARNING: GEMINI_API_KEY is empty or using placeholder value!");
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // API Route for Recipes
  app.post("/api/recipes", async (req, res) => {
    try {
      const { ingredients } = req.body;
      
      if (!ingredients || !Array.isArray(ingredients)) {
        return res.status(400).json({ error: "Invalid ingredients list" });
      }

      if (!GEMINI_API_KEY || GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
        return res.status(500).json({ 
          error: "Konfigurasi Server Error", 
          details: "Kunci API Gemini belum dipasang di server. Silakan cek Environment Variables." 
        });
      }

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
      res.json(JSON.parse(responseText));
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: "Failed to generate recipes", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
