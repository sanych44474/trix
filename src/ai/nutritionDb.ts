import type { Env } from "../types";
import { getFoodCache, putFoodCache } from "../adapters/d1/v2Nutrition";
import { aiJSON } from "./index";
import { catalogExact } from "../domain/foodCatalog";
import { PER100G_SCHEMA, per100gSystem, type Per100gResult } from "./prompts";

import { CURATED, type Per100g } from "../domain/curatedFoods";

// Cooking/prep adjectives stripped to map "grilled salmon" / "steamed broccoli" / "raw egg"
// onto their curated base entry.
const PREP_WORDS =
  /\b(raw|fresh|dry|dried|cooked|boiled|steamed|grilled|baked|roasted|fried|plain|skinless|boneless|lean|whole|large|medium|small)\b/g;

/** Authoritative curated lookup: exact name, then the name with prep adjectives removed, then
 *  an exact name/synonym match in the app's food catalog (domain/foodCatalog.ts -- covers
 *  Ukrainian dishes and foods the curated list doesn't). */
export function curatedPer100g(query: string): Per100g | null {
  const norm = query.toLowerCase().trim();
  if (CURATED[norm]) return CURATED[norm];
  const base = norm.replace(PREP_WORDS, "").replace(/\s+/g, " ").trim();
  if (base && CURATED[base]) return CURATED[base];
  const food = catalogExact(norm);
  if (food) return { source: "trix", kcal: food.per100.kcal, protein: food.per100.p, fats: food.per100.f, carbs: food.per100.c };
  return null;
}

// USDA descriptions that mean the WRONG form for a generic whole-food query.
const BAD_FORM = /dried|dehydrated|powder|chips?|juice|sauce|breaded|infant|baby food|candied|fried/i;

/** Look up reference macros per 100g for a food name.
 * Primary: USDA FoodData Central. Fallback: Gemini (replaces the flaky OFF search).
 * Returns null if no confident match — verification is best-effort. */
export async function lookupPer100g(env: Env, query: string): Promise<Per100g | null> {
  const q = query.trim();
  if (!q) return null;
  const curated = curatedPer100g(q);
  if (curated) return curated;
  const key = env.USDA_FDC_API_KEY || "DEMO_KEY";
  try {
    const usda = await usdaLookup(key, q);
    if (usda) return usda;
  } catch { /* fall through to Gemini */ }
  return null; // no DB available here — Gemini fallback requires D1, use lookupPer100gCached
}

/** Cached per-100g lookup (D1 `food_cache`).
 * Order: CURATED → cache → USDA → Gemini.
 * Caches the result so subsequent calls (same food, same session) are free. */
export async function lookupPer100gCached(db: D1Database, env: Env, query: string): Promise<Per100g | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // Curated wins over any cached row for common foods (cache may be stale/wrong form).
  const curated = curatedPer100g(q);
  if (curated) return curated;
  const cached = (await getFoodCache(db, q).catch(() => null)) as Per100g | null;
  if (cached) return cached;
  // Try USDA first.
  const key = env.USDA_FDC_API_KEY || "DEMO_KEY";
  let fresh: Per100g | null = null;
  try { fresh = await usdaLookup(key, q); } catch { /* ignore */ }
  // Gemini fallback — fires only when USDA has no match (unknown brand, regional food, etc.)
  if (!fresh) {
    try {
      const res = await aiJSON<Per100gResult>(env, {
        system: per100gSystem(),
        user: q,
        schema: PER100G_SCHEMA,
        temperature: 0.1,
        kind: "nutrition",
        db,
      });
      if (res.kcal > 0) fresh = { source: "Gemini", kcal: Math.round(res.kcal), protein: Math.round(res.protein), fats: Math.round(res.fats), carbs: Math.round(res.carbs) };
    } catch { /* Gemini also unavailable — give up */ }
  }
  if (fresh) await putFoodCache(db, q, fresh).catch(() => {});
  return fresh;
}

async function usdaLookup(apiKey: string, query: string): Promise<Per100g | null> {
  // Pull several candidates and pick the first whose description isn't a wrong form
  // (dried/powder/juice/…) — pageSize=1 used to grab e.g. "egg white" for "egg".
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(query)}&pageSize=5&dataType=Foundation,SR%20Legacy`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    foods?: { description?: string; foodNutrients?: { nutrientId?: number; value?: number }[] }[];
  };
  const foods = data.foods ?? [];
  // Prefer candidates whose description doesn't read as a wrong form; fall back to any.
  const ordered = [...foods.filter((f) => !BAD_FORM.test(f.description ?? "")), ...foods];
  for (const food of ordered) {
    if (!food?.foodNutrients) continue;
    const byId = (id: number) => food.foodNutrients!.find((n) => n.nutrientId === id)?.value ?? 0;
    // Foundation foods report energy as Atwater (2047/2048); SR Legacy/Branded use 1008.
    const kcal = byId(1008) || byId(2047) || byId(2048);
    if (!kcal) continue;
    return {
      source: "USDA",
      kcal: Math.round(kcal),
      protein: Math.round(byId(1003)),
      fats: Math.round(byId(1004)),
      carbs: Math.round(byId(1005)),
    };
  }
  return null;
}

// offLookup (Open Food Facts) removed — replaced by Gemini fallback in lookupPer100gCached.
