// Macro verification for AI food estimates: each item with a portion and a lookup name is checked
// against the user's own corrections, then the open nutrition databases, and recomputed from the
// reference per-100g when the AI's guess is in a plausible range. Shared by the chat flows and
// the Mini App (text and photo logging).
import { lookupPer100gCached } from "../../ai/nutritionDb";
import type * as P from "../../ai/prompts";
import { getUserFoodCorrection } from "../../adapters/d1/v2Nutrition";
import type { Env } from "../../types";

export type VerifiedItem = { desc: string; kcal: number; protein: number; fats: number; carbs: number; grams?: number; query?: string };

// Coerce any AI value (number, numeric string, or junk) to a finite integer.
export function num(x: unknown): number {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? n : 0;
}

// Cross-check each estimated item against an open nutrition DB; when a product
// matches and a portion (grams) is known, recompute macros from reference per-100g.
export async function verifyItems(db: D1Database, env: Env, userId: number, items: P.NutritionItem[]) {
  let verified = 0;
  let source = "";
  const final: VerifiedItem[] = [];
  // A weak/free fallback model in the AI chain only guarantees valid JSON *syntax*, not that
  // `items` is present — degrade to "nothing recognized" (logMeal below) instead of throwing.
  for (const it of items ?? []) {
    const grams = num(it.grams);
    let kcal = num(it.kcal), p = num(it.protein), f = num(it.fats), c = num(it.carbs);
    if (grams > 0 && it.query) {
      // User's own correction takes precedence over any external DB.
      const userRef = await getUserFoodCorrection(db, userId, it.query).catch(() => null);
      // lookupPer100gCached: CURATED → D1 cache → USDA → Gemini fallback.
      const ref = userRef ?? await lookupPer100gCached(db, env, it.query);
      if (ref) {
        const k = grams / 100;
        if (userRef) {
          // Trust user corrections unconditionally (they chose these values deliberately).
          kcal = Math.round(ref.kcal * k);
          p = Math.round(ref.protein * k);
          f = Math.round(ref.fats * k);
          c = Math.round(ref.carbs * k);
          verified++;
          source = "user";
        } else {
          // External ref: apply only when the AI estimate is in a plausible range.
          const geminiPer100 = kcal > 0 ? (kcal / grams) * 100 : ref.kcal;
          const ratio = geminiPer100 > 0 ? ref.kcal / geminiPer100 : 1;
          if (ratio >= 0.6 && ratio <= 1.7) {
            kcal = Math.round(ref.kcal * k);
            p = Math.round(ref.protein * k);
            f = Math.round(ref.fats * k);
            c = Math.round(ref.carbs * k);
            verified++;
            source = (ref as { source?: string }).source === "USDA" ? "USDA" : "Open Food Facts";
          }
        }
      }
    }
    final.push({ desc: it.desc || "meal", kcal, protein: p, fats: f, carbs: c, grams: grams || undefined, query: it.query || undefined });
  }
  return { final, verified, source };
}
