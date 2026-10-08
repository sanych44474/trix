// Search over the app's own food catalog (foodCatalogData.ts): instant, free, works offline from
// any external database, and answers in the user's language. Food search in the Mini App asks
// here first; FatSecret / Open Food Facts / AI are only consulted when the catalog has nothing.
//
// Matching is forgiving on purpose: Ukrainian inflects ("курку", "курки" → "курка"), so query
// words match by stem prefix against the name, the other language's name and the synonyms; every
// query word must match somewhere. Generic foods win over specific ones of equal fit (a shorter
// name ranks higher), and a synonym that equals the whole query ranks highest.
import { FOOD_CATALOG_DATA } from "./foodCatalogData";
import type { Lang } from "../types";

export interface CatalogFood {
  id: number;
  category: string;
  uk: string;
  en: string;
  per100: { kcal: number; p: number; f: number; c: number };
  portionG: number;
  synonyms: string[];
}

let parsed: CatalogFood[] | null = null;

/** Every catalog food (parsed once per isolate). */
export function catalogFoods(): CatalogFood[] {
  if (parsed) return parsed;
  parsed = FOOD_CATALOG_DATA.split("\n").map((line, id) => {
    const [category, uk, en, kcal, p, f, c, portion, syn] = line.split("|");
    return {
      id,
      category,
      uk,
      en,
      per100: { kcal: Number(kcal), p: Number(p), f: Number(f), c: Number(c) },
      portionG: Number(portion) || 100,
      synonyms: (syn ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    };
  });
  return parsed;
}

/** Lower-case, unify apostrophes, fold Ukrainian/Russian letter variants (і ї ы → и, є э ё → е,
 *  ґ → г, so either keyboard finds the same food), keep letters, digits and %. Matching only --
 *  names are always shown as written. */
export function normalizeFood(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’ʼ`´]/g, "'")
    .replace(/[іїы]/g, "и")
    .replace(/[єэё]/g, "е")
    .replace(/ґ/g, "г")
    .replace(/[^\p{L}\p{N}%' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["з", "із", "зі", "в", "у", "на", "і", "й", "та", "с", "и", "with", "and", "of", "the", "a", "in"]);

/** The query's words, stop words dropped. */
export function foodTokens(s: string): string[] {
  return normalizeFood(s).split(" ").filter((t) => t && !STOP.has(t));
}

/** Prefix that survives inflection: long words lose up to two trailing letters, never below 4. */
export function stem(token: string): string {
  return token.length >= 5 ? token.slice(0, Math.max(4, token.length - 2)) : token;
}

interface Indexed {
  food: CatalogFood;
  primary: string[];
  other: string[];
  synonyms: string[];
}

let index: Indexed[] | null = null;
function indexed(): Indexed[] {
  if (index) return index;
  index = catalogFoods().map((food) => ({
    food,
    primary: foodTokens(food.uk),
    other: foodTokens(food.en),
    synonyms: food.synonyms.map(normalizeFood),
  }));
  return index;
}

const hit = (words: string[], s: string) => words.some((w) => w.startsWith(s));

/** Best catalog matches for `query`, best first. */
export function searchCatalog(query: string, lang: Lang, limit = 6): CatalogFood[] {
  const q = foodTokens(query);
  if (!q.length) return [];
  const whole = q.join(" ");
  const scored: Array<{ food: CatalogFood; score: number }> = [];
  for (const it of indexed()) {
    const name = lang === "en" ? it.other : it.primary;
    const alt = lang === "en" ? it.primary : it.other;
    const synWords = it.synonyms.flatMap((s) => s.split(" "));
    let score = 0;
    let all = true;
    for (const t of q) {
      const s = stem(t);
      if (hit(name, s)) score += name.includes(t) ? 12 : 10;
      else if (hit(synWords, s)) score += 8;
      else if (hit(alt, s)) score += 6;
      else {
        all = false;
        break;
      }
    }
    if (!all) continue;
    if (it.synonyms.includes(whole)) score += 25;
    if (name.join(" ").startsWith(whole)) score += 6;
    score -= name.length; // generic before specific
    scored.push({ food: it.food, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.food.id - b.food.id)
    .slice(0, limit)
    .map((s) => s.food);
}

/** The catalog food whose name (either language) or synonym IS the query, after normalising;
 *  null otherwise. Strict on purpose: it backs macro verification, where a loose match would
 *  overwrite a decent AI estimate with the wrong food. */
export function catalogExact(query: string): CatalogFood | null {
  const q = normalizeFood(query);
  if (!q) return null;
  const bare = (s: string) => normalizeFood(s.replace(/\(.*?\)/g, ""));
  for (const it of indexed()) {
    const f = it.food;
    if (normalizeFood(f.en) === q || normalizeFood(f.uk) === q || bare(f.en) === q || bare(f.uk) === q || it.synonyms.includes(q)) return f;
  }
  return null;
}
