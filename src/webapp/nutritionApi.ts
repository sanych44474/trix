// Nutrition suite for the Mini App (roadmap P4): today's meal history (view), portion re-weigh
// (½ / 1.5× / 2× / grams) and item delete, plus the meal-plan display. AI photo/voice logging
// stays in the bot (media). Same initData auth as every webapp API.
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getDayMeals, getMealPlan, getRecentFoods, saveMealPlan, setDayMeals, putUserFoodCorrection } from "../adapters/d1/v2Nutrition";
import { computeTargets, per100gCorrectionFrom, scaleMealEntry, sumItems } from "../domain/mealplan";
import { groceryList } from "../domain/groceryList";
import { localParts } from "../domain/progression";
import { generateMealDayFor } from "../bot/router";
import { miniAppUser } from "./auth";
import { aiText } from "../ai/index";
import { cleanAi } from "../locales/i18n";
import { renderGroceryList } from "../render";
import { aiProductLookup, decodeEntities, fatSecretSearch } from "./foodDb";
import { readJsonBody } from "./validate";
import { logInfo } from "../log";
import type { Env, MealEntry, NutritionTargets, UserDoc } from "../types";

// Same "the webview can't offer a file download, so push it to the viewer's own Telegram chat"
// pattern extrasApi.ts/settingsApi.ts/trainerApi.ts already each define locally -- this endpoint
// gets its own copy rather than a shared import, matching that convention.
async function tgSend(env: Env, chatId: number, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => null);
  return !!res?.ok;
}

function totals(meals: MealEntry[]) {
  return meals.reduce(
    (a, m) => ({ kcal: a.kcal + (m.kcal || 0), protein: a.protein + (m.protein || 0), fats: a.fats + (m.fats || 0), carbs: a.carbs + (m.carbs || 0) }),
    { kcal: 0, protein: 0, fats: 0, carbs: 0 },
  );
}
async function dayTargets(env: Env, user: UserDoc): Promise<{ targets: NutritionTargets | null; isRestDay: boolean }> {
  const { weekday } = localParts(user.profile.timezone);
  const plan = await getActivePlan(env.DB, user._id).catch(() => null);
  const trainingDays = user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as (typeof trainingDays)[number]);
  const isRestDay = !isTraining && !!plan?.restDayNutrition;
  return { targets: (!isTraining && plan?.restDayNutrition) || user.nutrition || null, isRestDay };
}

export async function handleNutritionApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { date } = localParts(user.profile.timezone);

  if (req.method === "GET") {
    const recentSince = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const [meals, dayTg, mp, recent] = await Promise.all([
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
        targets: dayTg.targets,
        isRestDay: dayTg.isRestDay,
        mealPlan: mp ? { days: mp.days } : null,
        // Quick re-add: distinct recently-logged foods (last 30d), re-added by index via "readd".
        recent: recent.map((m, i) => ({ ri: i, desc: m.desc, kcal: Math.round(m.kcal || 0), protein: Math.round(m.protein || 0) })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  // Each action below already bounds-checks its own fields (grams/kcal/macro ranges, factor
  // whitelist, index bounds) -- that per-action logic stays as-is; readJsonBody just adds the
  // size cap and consistent malformed-JSON handling this endpoint was missing.
  const parsedNutrition = await readJsonBody(req);
  if (!parsedNutrition.ok) return parsedNutrition.response;
  const body = parsedNutrition.body as Record<string, unknown>;
  const action = String(body.action);

  if (action === "grocery") {
    const repeat = Math.max(1, Math.min(14, Math.round(Number(body.days) || 1)));
    const menu = await getMealPlan(env.DB, user._id, 0).catch(() => null);
    return Response.json({ days: repeat, lines: menu ? groceryList(menu.days, repeat) : [] }, { headers: { "cache-control": "no-store" } });
  }

  // Push the in-app grocery preview to the viewer's own Telegram chat as a real checklist message
  // -- same renderGroceryList() the bot's /grocery command sends, same tgSend-to-self pattern
  // extrasApi.ts's /api/weekcard and /api/photocompare use for "the webview can't offer a file
  // download" delivery.
  if (action === "grocery_send") {
    const repeat = Math.max(1, Math.min(14, Math.round(Number(body.days) || 1)));
    const menu = await getMealPlan(env.DB, user._id, 0).catch(() => null);
    const lines = menu?.days?.length ? groceryList(menu.days, repeat) : [];
    if (!lines.length) return Response.json({ error: "bad request" }, { status: 400 });
    const ok = await tgSend(env, user.chatId, renderGroceryList(user.lang, lines, repeat));
    return Response.json({ ok });
  }

  // Regenerate today's meal plan -- same "keep my existing allergen/likes/dislikes prefs, build
  // a fresh template day" flow as the bot's mp:useprev callback (deliverMealPlan with useAi=false).
  // Reuses generateMealDayFor (exported from bot/router.ts) so the food-selection/solving logic
  // is never duplicated; this route does not re-ask the allergen/likes/dislikes questionnaire --
  // that stays a bot-only flow (mp:redo) since it is multi-step chat intake, not a single mutation.
  if (action === "mealplan_regen") {
    const plan = await getActivePlan(env.DB, user._id).catch(() => null);
    const targets = computeTargets(user.profile, plan?.nutrition);
    if (!targets.calories) return Response.json({ error: "no targets" }, { status: 400 });
    const p = user.profile;
    const excluded = [p.allergies, p.dietPrefs, p.foodDislikes].filter((x) => x && x.toLowerCase() !== "none").join("; ");
    const likes = p.foodLikes ?? "";
    const display = await generateMealDayFor(env, env.DB, user.lang, p, user._id, targets, 4, excluded, likes, false, 0).catch(() => []);
    if (!display.length) return Response.json({ error: "generation_failed" }, { status: 502 });
    const doc = { userId: user._id, week: 0, days: [{ label: date, meals: display }], targets, generatedAt: new Date() };
    await saveMealPlan(env.DB, doc);
    logInfo("mealplan_regenerated", { method: "miniapp" });
    return Response.json({ ok: true, days: doc.days }, { headers: { "cache-control": "no-store" } });
  }

  // Point edit of a single food item inside the stored meal-plan template (mealPlan.days[].
  // meals[].items[]) -- distinct from the "macros"/"del"/"scale"/"grams" actions further below,
  // which operate on the day's LOGGED meals (getDayMeals/setDayMeals). One owner, no concurrent
  // editors (unlike the trainer-shared workout Plan), so a direct overwrite by index is safe --
  // no version/If-Match guard needed.
  if (action === "mealplan_item_del" || action === "mealplan_item_scale" || action === "mealplan_item_grams") {
    const mp = await getMealPlan(env.DB, user._id, 0).catch(() => null);
    if (!mp) return Response.json({ error: "not found" }, { status: 404 });
    const dayIndex = Number(body.dayIndex);
    const mealIndex = Number(body.mealIndex);
    const itemIndex = Number(body.itemIndex);
    const day = mp.days[dayIndex];
    const meal = day?.meals[mealIndex];
    const item = meal?.items[itemIndex];
    if (!day || !meal || !item) return Response.json({ error: "bad request" }, { status: 400 });

    if (action === "mealplan_item_del") {
      if (meal.items.length <= 1) return Response.json({ error: "last" }, { status: 400 });
      meal.items.splice(itemIndex, 1);
    } else if (action === "mealplan_item_scale") {
      const f = Number(body.factor);
      if (![0.5, 1.5, 2].includes(f)) return Response.json({ error: "bad request" }, { status: 400 });
      meal.items[itemIndex] = scaleMealEntry(item, f);
    } else {
      const g = Number(body.grams);
      if (!Number.isFinite(g) || g <= 0 || g > 5000 || item.grams <= 0) return Response.json({ error: "bad request" }, { status: 400 });
      meal.items[itemIndex] = scaleMealEntry(item, g / item.grams);
    }
    const sums = sumItems(meal.items);
    meal.kcal = sums.kcal; meal.protein = sums.protein; meal.fats = sums.fats; meal.carbs = sums.carbs;
    await saveMealPlan(env.DB, mp);
    return Response.json({ ok: true, days: mp.days }, { headers: { "cache-control": "no-store" } });
  }

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
  // Barcode → product. Open Food Facts' v2 product endpoint is a different API from the name
  // search above (and answers HTTP 200 with status:0 for an unknown code, so res.ok proves
  // nothing — the payload's own status field is the check). Returns the SAME item shape as
  // dbsearch so the client's existing pick → grams → add flow needs no special case.
  if (action === "barcode") {
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
    // EAN-8 through GTIN-14 covers every retail food barcode; anything else is a misread.
    if (code.length < 8 || code.length > 14) return Response.json({ error: "bad request" }, { status: 400 });
    const offUrl = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments`;
    const res = await fetch(offUrl, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "trix-bot/1.0" } })
      .then((r) => (r.ok ? (r.json() as Promise<{ status?: number; product?: { product_name?: string; brands?: string; nutriments?: Record<string, number> } }>) : null))
      .catch(() => null);
    const p = res?.status === 1 ? res.product : undefined;
    const name = decodeEntities(p?.product_name || "").trim().slice(0, 60);
    const per100 = offPer100(p?.nutriments);
    if (!name || per100.kcal <= 0) {
      // Known-good barcode formats still miss (regional products, empty OFF entries) — say so
      // plainly instead of returning an empty list the UI would render as a silent no-op.
      return Response.json({ items: [], source: "off", notFound: true }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json(
      { items: [{ name, brand: decodeEntities((p?.brands || "").split(",")[0]).trim().slice(0, 30), per100 }], source: "off" },
      { headers: { "cache-control": "no-store" } },
    );
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
    logInfo("nutrition_logged", { method: "miniapp_search" });
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
    logInfo("nutrition_logged", { method: "recent" });
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
    const { targets: tg } = await dayTargets(env, user);
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
    const { targets: tg } = await dayTargets(env, user);
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
        await putUserFoodCorrection(env.DB, user._id, item.query, per100gCorrectionFrom(kcal, protein, fats, carbs, grams)).catch(() => {});
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
      meals[index] = scaleMealEntry(m, f);
    } else if (action === "grams") {
      const g = Number(body.grams);
      const m = meals[index];
      if (!Number.isFinite(g) || g <= 0 || g > 5000 || m.grams == null || m.grams <= 0) return Response.json({ error: "bad request" }, { status: 400 });
      meals[index] = scaleMealEntry(m, g / m.grams);
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
