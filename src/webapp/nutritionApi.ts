// Nutrition suite for the Mini App (roadmap P4): today's meal history (view), portion re-weigh
// (½ / 1.5× / 2× / grams) and item delete, plus the meal-plan display. AI photo/voice logging
// stays in the bot (media). Same initData auth as every webapp API.
import { getActivePlan, getDayMeals, getMealPlan, getRecentFoods, setDayMeals, putUserFoodCorrection } from "../db/repos";
import { localParts } from "../domain/progression";
import { miniAppUser } from "./auth";
import { aiText } from "../ai/index";
import { cleanAi } from "../locales/i18n";
import { aiProductLookup, decodeEntities, fatSecretSearch } from "./foodDb";
import type { Env, MealEntry, NutritionTargets, UserDoc } from "../types";

function totals(meals: MealEntry[]) {
  return meals.reduce(
    (a, m) => ({ kcal: a.kcal + (m.kcal || 0), protein: a.protein + (m.protein || 0), fats: a.fats + (m.fats || 0), carbs: a.carbs + (m.carbs || 0) }),
    { kcal: 0, protein: 0, fats: 0, carbs: 0 },
  );
}
const round = (m: MealEntry): MealEntry => ({
  ...m,
  kcal: Math.round(m.kcal || 0),
  protein: Math.round(m.protein || 0),
  fats: Math.round(m.fats || 0),
  carbs: Math.round(m.carbs || 0),
  ...(m.grams != null ? { grams: Math.round(m.grams) } : {}),
});

async function dayTargets(env: Env, user: UserDoc): Promise<NutritionTargets | null> {
  const { weekday } = localParts(user.profile.timezone);
  const plan = await getActivePlan(env.DB, user._id).catch(() => null);
  const trainingDays = user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as (typeof trainingDays)[number]);
  return (!isTraining && plan?.restDayNutrition) || user.nutrition || null;
}

export async function handleNutritionApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { date } = localParts(user.profile.timezone);

  if (req.method === "GET") {
    const recentSince = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const [meals, targets, mp, recent] = await Promise.all([
      getDayMeals(env.DB, user._id, date),
      dayTargets(env, user),
      getMealPlan(env.DB, user._id, 0).catch(() => null),
      getRecentFoods(env.DB, user._id, recentSince, 12).catch(() => [] as MealEntry[]),
    ]);
    return Response.json(
      {
        date,
        meals: meals.map((m, i) => ({ index: i, desc: m.desc, kcal: Math.round(m.kcal || 0), protein: Math.round(m.protein || 0), fats: Math.round(m.fats || 0), carbs: Math.round(m.carbs || 0), grams: m.grams ?? null, query: m.query ?? null })),
        totals: totals(meals),
        targets,
        mealPlan: mp ? { days: mp.days } : null,
        // Quick re-add: distinct recently-logged foods (last 30d), re-added by index via "readd".
        recent: recent.map((m, i) => ({ ri: i, desc: m.desc, kcal: Math.round(m.kcal || 0), protein: Math.round(m.protein || 0) })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const action = String(body.action);

  // Robust per-100g extraction across Open Food Facts field variants: kcal may live in
  // energy-kcal_100g / energy-kcal / energy-kcal_value, or only as kilojoules (energy_100g,
  // in kJ → ÷4.184). Guarantees a fully-numeric per100 so the UI never shows "undefined".
  const offPer100 = (n?: Record<string, number>): { kcal: number; p: number; f: number; c: number } => {
    const nn = n ?? {};
    let kcal = nn["energy-kcal_100g"] ?? nn["energy-kcal"] ?? nn["energy-kcal_value"] ?? 0;
    if (!kcal) {
      const kj = nn["energy_100g"] ?? nn["energy"] ?? 0;
      if (kj) kcal = kj / 4.184;
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0);
    return { kcal: Math.round(num(kcal)), p: num(nn.proteins_100g), f: num(nn.fat_100g), c: num(nn.carbohydrates_100g) };
  };

  // Food-DB search — FatSecret first (broad branded/international coverage), Open Food Facts as
  // fallback. Both proxied server-side. AI free-text stays the universal last resort (client).
  if (action === "dbsearch") {
    const q = typeof body.q === "string" ? body.q.trim().slice(0, 60) : "";
    if (q.length < 2) return Response.json({ error: "bad request" }, { status: 400 });
    const fs = await fatSecretSearch(env, q).catch(() => null);
    if (fs && fs.length) return Response.json({ items: fs, source: "fatsecret" }, { headers: { "cache-control": "no-store" } });
    const url2 = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=6&fields=product_name,brands,nutriments`;
    const res = await fetch(url2, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "trix-bot/1.0" } })
      .then((r) => (r.ok ? (r.json() as Promise<{ products?: { product_name?: string; brands?: string; nutriments?: Record<string, number> }[] }>) : null))
      .catch(() => null);
    const items = (res?.products ?? [])
      .map((p) => ({
        name: decodeEntities(p.product_name || "").trim().slice(0, 60),
        brand: decodeEntities((p.brands || "").split(",")[0]).trim().slice(0, 30),
        per100: offPer100(p.nutriments),
      }))
      .filter((p) => p.name && p.per100.kcal > 0)
      .slice(0, 5);
    if (items.length) return Response.json({ items, source: "off" }, { headers: { "cache-control": "no-store" } });
    // No database hit → AI knowledge lookup by name (reliable for well-known products).
    const ai = await aiProductLookup(env, user.lang, { name: q }, user._id).catch(() => null);
    return Response.json({ items: ai ? [ai] : [], source: ai ? "ai" : "off" }, { headers: { "cache-control": "no-store" } });
  }
  // Barcode lookup: the Mini App scans an EAN/UPC via Telegram's QR/barcode scanner and posts
  // the digits here; we resolve exact per-100g macros from Open Food Facts by barcode.
  if (action === "barcode") {
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "").slice(0, 14) : "";
    if (code.length < 6) return Response.json({ error: "bad request" }, { status: 400 });
    const url2 = `https://world.openfoodfacts.org/api/v0/product/${code}.json`;
    const res = await fetch(url2, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "trix-bot/1.0" } })
      .then((r) => (r.ok ? (r.json() as Promise<{ status?: number; product?: { product_name?: string; brands?: string; nutriments?: Record<string, number> } }>) : null))
      .catch(() => null);
    const p = res && res.status === 1 ? res.product : undefined;
    const per100 = p ? offPer100(p.nutriments) : null;
    if (p && p.product_name && per100 && per100.kcal > 0) {
      return Response.json({
        item: { name: decodeEntities(p.product_name).trim().slice(0, 60), brand: decodeEntities((p.brands || "").split(",")[0]).trim().slice(0, 30), per100 },
      });
    }
    // Not in OFF (common for UA products) → AI attempt by barcode (rarely known) then null.
    const ai = await aiProductLookup(env, user.lang, { barcode: code }, user._id).catch(() => null);
    return Response.json({ item: ai });
  }
  if (action === "dbadd") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    const grams = Number(body.grams);
    const per = (body.per100 ?? {}) as { kcal?: unknown; p?: unknown; f?: unknown; c?: unknown };
    const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
    const kcal100 = num(per.kcal, 1000), p100 = num(per.p, 100), f100 = num(per.f, 100), c100 = num(per.c, 100);
    if (!name || !Number.isFinite(grams) || grams < 1 || grams > 3000 || kcal100 === null || p100 === null || f100 === null || c100 === null) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const f2 = grams / 100;
    const cur = await getDayMeals(env.DB, user._id, date);
    cur.push({
      desc: name,
      kcal: Math.round(kcal100 * f2),
      protein: Math.round(p100 * f2 * 10) / 10,
      fats: Math.round(f100 * f2 * 10) / 10,
      carbs: Math.round(c100 * f2 * 10) / 10,
      grams,
    });
    await setDayMeals(env.DB, user._id, date, cur);
    return Response.json({
      ok: true,
      meals: cur.map((m, i) => ({ index: i, desc: m.desc, kcal: Math.round(m.kcal || 0), protein: Math.round(m.protein || 0), fats: Math.round(m.fats || 0), carbs: Math.round(m.carbs || 0), grams: m.grams ?? null })),
      totals: totals(cur),
    });
  }

  // Quick re-add of a recently-logged food (by index into the server-fetched recent list, so the
  // client can't inject arbitrary macros — the entry is copied verbatim from history).
  if (action === "readd") {
    const ri = Number(body.ri);
    const recentSince = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const recent = await getRecentFoods(env.DB, user._id, recentSince, 12);
    const pick = recent[ri];
    if (!pick) return Response.json({ error: "bad request" }, { status: 400 });
    const cur = await getDayMeals(env.DB, user._id, date);
    cur.push({
      desc: pick.desc,
      kcal: Math.round(pick.kcal || 0),
      protein: pick.protein || 0,
      fats: pick.fats || 0,
      carbs: pick.carbs || 0,
      ...(pick.grams != null ? { grams: pick.grams } : {}),
      ...(pick.query ? { query: pick.query } : {}),
    });
    await setDayMeals(env.DB, user._id, date, cur);
    return Response.json({
      ok: true,
      meals: cur.map((m, i) => ({ index: i, desc: m.desc, kcal: Math.round(m.kcal || 0), protein: Math.round(m.protein || 0), fats: Math.round(m.fats || 0), carbs: Math.round(m.carbs || 0), grams: m.grams ?? null })),
      totals: totals(cur),
    });
  }

  // AI recipe hitting today's REMAINING macros (target − logged) — a dish suggestion from common foods.
  if (action === "recipe") {
    const cur = await getDayMeals(env.DB, user._id, date);
    const tot = totals(cur);
    const tg = await dayTargets(env, user);
    if (!tg) return Response.json({ text: "" });
    const remKcal = Math.max(0, Math.round(tg.calories - tot.kcal));
    const remP = Math.max(0, Math.round(tg.protein - tot.protein));
    if (remKcal < 50) return Response.json({ text: "", done: true });
    const langName = user.lang === "uk" ? "Ukrainian" : "English";
    const text = await aiText(env, {
      system: `You are a practical nutrition coach. Suggest ONE simple dish that fits about ${remKcal} kcal and ${remP} g protein, using common affordable foods. Give the dish name, a short ingredient list with grams, and its approx kcal/protein. Answer in ${langName}. Plain text only — no markdown, no LaTeX, no backslashes, max 7 short lines.`,
      user: `Remaining today: ~${remKcal} kcal, ~${remP} g protein.`,
      temperature: 0.7,
      kind: "coach",
      db: env.DB,
      userId: user._id,
    }).catch(() => "");
    return Response.json({ text: cleanAi(text).slice(0, 700) });
  }

  // 🍔 Cheat-meal / overate recovery: a supportive plan to get back on track tomorrow.
  if (action === "recover") {
    const cur = await getDayMeals(env.DB, user._id, date);
    const tot = totals(cur);
    const tg = await dayTargets(env, user);
    if (!tg) return Response.json({ text: "" });
    const over = Math.round(tot.kcal - tg.calories);
    const langName = user.lang === "uk" ? "Ukrainian" : "English";
    const text = await aiText(env, {
      system: `You are a supportive, non-judgmental nutrition coach. Today the athlete ate ${Math.round(tot.kcal)} kcal vs a ${Math.round(tg.calories)} kcal target (${over > 0 ? over + " over" : "within target"}). Give a short, encouraging recovery plan for TOMORROW: 2-3 concrete tips (e.g. protein-first breakfast, more steps, hydration, a normal — not crash — deficit). Never shame, never suggest starving or skipping meals. Answer in ${langName}. Plain text, no markdown, no LaTeX, max 6 short lines.`,
      user: `Today ${Math.round(tot.kcal)} kcal, target ${Math.round(tg.calories)}. Give a recovery plan.`,
      temperature: 0.6,
      kind: "coach",
      db: env.DB,
      userId: user._id,
    }).catch(() => "");
    return Response.json({ text: cleanAi(text).slice(0, 700) });
  }

  const index = Number(body.index);
  const meals = await getDayMeals(env.DB, user._id, date);
  if (!Number.isInteger(index) || index < 0 || index >= meals.length) return Response.json({ error: "bad request" }, { status: 400 });

  try {
    if (action === "macros") {
      const safeNum = (v: unknown, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };
      const kcal = safeNum(body.kcal, 5000), protein = safeNum(body.protein, 500);
      const fats = safeNum(body.fats, 500), carbs = safeNum(body.carbs, 500);
      if (kcal === null || protein === null || fats === null || carbs === null) return Response.json({ error: "bad request" }, { status: 400 });
      const item = meals[index];
      meals[index] = { ...item, kcal, protein, fats, carbs };
      await setDayMeals(env.DB, user._id, date, meals);
      // Cache the corrected per-100g values so subsequent lookups use them automatically.
      let cached = false;
      const grams = item.grams ?? 0;
      if (item.query && grams > 0) {
        await putUserFoodCorrection(env.DB, user._id, item.query, {
          kcal: Math.round((kcal / grams) * 100),
          protein: Math.round((protein / grams) * 100),
          fats: Math.round((fats / grams) * 100),
          carbs: Math.round((carbs / grams) * 100),
        }).catch(() => {});
        cached = true;
      }
      return Response.json({
        ok: true, cached,
        meals: meals.map((m, i) => ({ index: i, desc: m.desc, kcal: Math.round(m.kcal || 0), protein: Math.round(m.protein || 0), fats: Math.round(m.fats || 0), carbs: Math.round(m.carbs || 0), grams: m.grams ?? null, query: m.query ?? null })),
        totals: totals(meals),
      });
    } else if (action === "del") {
      meals.splice(index, 1);
    } else if (action === "scale") {
      const f = Number(body.factor);
      if (![0.5, 1.5, 2].includes(f)) return Response.json({ error: "bad request" }, { status: 400 });
      const m = meals[index];
      meals[index] = round({ ...m, kcal: (m.kcal || 0) * f, protein: (m.protein || 0) * f, fats: (m.fats || 0) * f, carbs: (m.carbs || 0) * f, ...(m.grams != null ? { grams: m.grams * f } : {}) });
    } else if (action === "grams") {
      const g = Number(body.grams);
      const m = meals[index];
      if (!Number.isFinite(g) || g <= 0 || g > 5000 || m.grams == null || m.grams <= 0) return Response.json({ error: "bad request" }, { status: 400 });
      const f = g / m.grams;
      meals[index] = round({ ...m, kcal: (m.kcal || 0) * f, protein: (m.protein || 0) * f, fats: (m.fats || 0) * f, carbs: (m.carbs || 0) * f, grams: g });
    } else {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    await setDayMeals(env.DB, user._id, date, meals);
    return Response.json({
      ok: true,
      meals: meals.map((m, i) => ({ index: i, desc: m.desc, kcal: Math.round(m.kcal || 0), protein: Math.round(m.protein || 0), fats: Math.round(m.fats || 0), carbs: Math.round(m.carbs || 0), grams: m.grams ?? null })),
      totals: totals(meals),
    });
  } catch (err) {
    console.error("api/nutrition", user._id, action, err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
