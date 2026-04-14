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

  try {
    const response = await fetch("/api/recipes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ingredients: availableIngredients }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to fetch recipes");
    }

    return await response.json();
  } catch (error) {
    console.error("Error getting recipe recommendations:", error);
    return [];
  }
}
