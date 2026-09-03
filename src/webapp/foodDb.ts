// FatSecret food search — much better branded/international coverage than Open Food Facts.
// OAuth2 client-credentials; token cached in settings until expiry. Best-effort: any failure
// (missing keys, IP allowlist, scope, throttle) returns null so the caller falls back to OFF/AI.
import { getSetting, setSetting } from "../db/repos";
import { aiJSON } from "../ai/index";
import type { Env, Lang } from "../types";

export interface FoodItem { name: string; brand: string; per100: { kcal: number; p: number; f: number; c: number }; ai?: boolean }

// FatSecret (and occasionally OFF) return HTML-entity-encoded names (e.g. `&quot;Insalata&quot;`).
// Decode them server-side so the client escapes exactly once — otherwise the entity is
// double-escaped and shows up literally ("&quot;") in the UI.
export function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&quot;/g, '"').replace(/&#0?34;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Last-resort AI lookup when no food database has the product (common for Ukrainian items). The
// LLM has NO web access, so it can only answer from training knowledge, which is usually reliable
// for a named product. Hard guardrail: unsure → found:false, never invent.
const AI_PRODUCT_SCHEMA = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN" },
    name: { type: "STRING" },
    brand: { type: "STRING" },
    kcal: { type: "INTEGER" },
    protein: { type: "NUMBER" },
    fat: { type: "NUMBER" },
    carbs: { type: "NUMBER" },
  },
  required: ["found", "name", "kcal", "protein", "fat", "carbs"],
} as const;

interface AiProduct { found: boolean; name?: string; brand?: string; kcal?: number; protein?: number; fat?: number; carbs?: number }

export async function aiProductLookup(env: Env, lang: Lang, q: { name?: string }, userId?: number): Promise<FoodItem | null> {
  const subject = q.name ? `product "${q.name}"` : "";
  if (!subject) return null;
  const res = await aiJSON<AiProduct>(env, {
    system:
      "You are a food-nutrition database. Given a product name, return its " +
      "per-100g nutrition. Set found=true ONLY if you actually recognize the SPECIFIC product " +
      "and are confident of realistic values; otherwise found=false. NEVER invent numbers. " +
      `Write the name in ${lang === "uk" ? "Ukrainian" : "English"}. Return per-100g kcal/protein/fat/carbs.`,
    user: `Identify: ${subject}`,
    schema: AI_PRODUCT_SCHEMA,
    temperature: 0,
    kind: "nutrition",
    db: env.DB,
    ...(userId ? { userId } : {}),
  }).catch(() => null);
  if (!res || !res.found || !res.name || !(res.kcal && res.kcal > 0)) return null;
  const g = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : 0);
  return {
    name: decodeEntities(res.name).trim().slice(0, 60),
    brand: decodeEntities(res.brand || "").trim().slice(0, 30),
    per100: { kcal: Math.round(res.kcal), p: g(res.protein), f: g(res.fat), c: g(res.carbs) },
    ai: true,
  };
}

async function fsToken(env: Env): Promise<string | null> {
  if (!env.FATSECRET_CLIENT_ID || !env.FATSECRET_CLIENT_SECRET) return null;
  const cached = await getSetting(env.DB, "fatsecret_token").catch(() => null);
  if (cached) {
    try {
      const c = JSON.parse(cached) as { token: string; exp: number };
      if (c.exp > Date.now() + 30_000) return c.token;
    } catch { /* refetch */ }
  }
  const basic = btoa(`${env.FATSECRET_CLIENT_ID}:${env.FATSECRET_CLIENT_SECRET}`);
  const res = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=basic",
    signal: AbortSignal.timeout(6000),
  }).then((r) => (r.ok ? (r.json() as Promise<{ access_token?: string; expires_in?: number }>) : null)).catch(() => null);
  if (!res?.access_token) return null;
  await setSetting(env.DB, "fatsecret_token", JSON.stringify({ token: res.access_token, exp: Date.now() + (res.expires_in ?? 3600) * 1000 })).catch(() => {});
  return res.access_token;
}

// FatSecret food_description looks like "Per 100g - Calories: 52kcal | Fat: 0.13g | Carbs:
// 13.81g | Protein: 0.26g" (sometimes "Per 1 serving ..."). We only trust the per-100g form so
// the macros are directly comparable; per-serving descriptions are skipped.
function parsePer100(desc: string): FoodItem["per100"] | null {
  if (!/per\s*100\s*g/i.test(desc)) return null;
  const kcal = /calories:\s*([\d.]+)\s*kcal/i.exec(desc);
  const fat = /fat:\s*([\d.]+)\s*g/i.exec(desc);
  const carbs = /carbs?:\s*([\d.]+)\s*g/i.exec(desc);
  const prot = /protein:\s*([\d.]+)\s*g/i.exec(desc);
  const kc = kcal ? Math.round(parseFloat(kcal[1])) : 0;
  if (!kc) return null;
  const g = (m: RegExpExecArray | null) => (m ? Math.round(parseFloat(m[1]) * 10) / 10 : 0);
  return { kcal: kc, p: g(prot), f: g(fat), c: g(carbs) };
}

export async function fatSecretSearch(env: Env, query: string): Promise<FoodItem[] | null> {
  const token = await fsToken(env);
  if (!token) return null;
  const url = `https://platform.fatsecret.com/rest/server.api?method=foods.search&format=json&max_results=8&search_expression=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ foods?: { food?: unknown } }>) : null))
    .catch(() => null);
  if (!res?.foods) return null;
  const raw = res.foods.food;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as {
    food_name?: string; brand_name?: string; food_description?: string;
  }[];
  const items = list
    .map((f) => {
      const per100 = parsePer100(f.food_description ?? "");
      if (!per100) return null;
      return { name: decodeEntities(f.food_name || "").trim().slice(0, 60), brand: decodeEntities(f.brand_name || "").trim().slice(0, 30), per100 };
    })
    .filter((x): x is FoodItem => !!x && !!x.name)
    .slice(0, 6);
  return items.length ? items : null;
}
