import { getWorkoutLog, upsertStrengthRecord, upsertWorkoutLog } from "../adapters/d1/v2Workouts";
import { addWater, recordDailyCheckin, upsertBodyLog, upsertStepLog } from "../adapters/d1/v2Tracking";
import { appendMeals } from "../adapters/d1/v2Nutrition";
import { aiJSON } from "../ai/index";
import { nutritionSystem, NUTRITION_SCHEMA, type NutritionEstimate } from "../ai/prompts";
import { localParts, parseMeasurements } from "../domain/progression";
import { cleanAi } from "../locales/i18n";
import { miniAppUser } from "./auth";
import { logError, logInfo } from "../log";
import type { Env, MealEntry, Weekday } from "../types";

type QuickLogBody = {
  kind?: string;
  ml?: number;
  name?: string;
  sets?: number;
  weight?: number;
  reps?: number;
  text?: string;
  steps?: number;
  energy?: number;
  sleep?: number;
  stress?: number;
};

/** Shared Mini App quick-log use case. Legacy /api/log and versioned /api/v2/log use this seam. */
export async function handleQuickLogApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return new Response("unauthorized", { status: 401 });

  let body: QuickLogBody;
  try {
    body = (await req.json()) as QuickLogBody;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const { date: today, weekday } = localParts(user.profile.timezone);
  try {
    if (body.kind === "water") {
      const add = Math.round(Number(body.ml));
      if (!Number.isFinite(add) || add <= 0 || add > 3000) return new Response("bad request", { status: 400 });
      const total = await addWater(env.DB, user._id, today, add);
      return Response.json({ ok: true, ml: total });
    }

    if (body.kind === "workout") {
      const name = String(body.name ?? "").trim().slice(0, 80);
      const sets = Math.round(Number(body.sets));
      const reps = Math.round(Number(body.reps));
      const weight = Number(body.weight) || 0;
      if (!name || !(sets >= 1 && sets <= 20) || !(reps >= 1 && reps <= 1000) || weight < 0 || weight > 1000) {
        return new Response("bad request", { status: 400 });
      }
      const existing = await getWorkoutLog(env.DB, user._id, today);
      const exercises = (existing?.exercises ?? []).filter((e) => e.name !== name);
      exercises.push({ name, setsDone: Array.from({ length: sets }, () => ({ weight, reps })), skipped: false });
      await upsertWorkoutLog(env.DB, user._id, today, weekday as Weekday, exercises, existing?.completed ?? true, existing?.notes);
      if (weight > 0) await upsertStrengthRecord(env.DB, user._id, name, { metric: "reps", weight, reps }, today).catch(() => {});
      return Response.json({ ok: true, exercises: exercises.length });
    }

    if (body.kind === "steps") {
      const steps = Math.round(Number(body.steps));
      if (!Number.isFinite(steps) || steps < 0 || steps > 200000) return new Response("bad request", { status: 400 });
      await upsertStepLog(env.DB, user._id, today, steps);
      return Response.json({ ok: true, steps });
    }

    if (body.kind === "measure") {
      const text = String(body.text ?? "").trim().slice(0, 200);
      const { weight, measurements } = parseMeasurements(text);
      if (weight === undefined && Object.keys(measurements).length === 0) return Response.json({ ok: false, reason: "unreadable" });
      await upsertBodyLog(env.DB, user._id, today, { ...(weight !== undefined ? { weight } : {}), measurements });
      return Response.json({ ok: true, weight: weight ?? null, measurements });
    }

    if (body.kind === "checkin") {
      const c = (v: unknown) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : 0; };
      const energy = c(body.energy), sleep = c(body.sleep), stress = c(body.stress);
      if (!energy || !sleep || !stress) return new Response("bad request", { status: 400 });
      await recordDailyCheckin(env.DB, user._id, today, energy, sleep, stress);
      logInfo("checkin_submitted", {});
      return Response.json({ ok: true });
    }

    if (body.kind === "food") {
      const text = String(body.text ?? "").trim().slice(0, 500);
      if (!text) return new Response("bad request", { status: 400 });
      const est = await aiJSON<NutritionEstimate>(env, {
        system: nutritionSystem(user.lang),
        user: text,
        schema: NUTRITION_SCHEMA,
        temperature: 0.3,
        kind: "nutrition",
        db: env.DB,
        userId: user._id,
      });
      const items: MealEntry[] = (est.items ?? [])
        .filter((i) => i.kcal > 0)
        .map((i) => ({ desc: cleanAi(i.desc), kcal: i.kcal, protein: i.protein, fats: i.fats, carbs: i.carbs, grams: i.grams, query: i.query }));
      if (!items.length) return Response.json({ ok: false, reason: "unreadable" });
      await appendMeals(env.DB, user._id, today, items);
      logInfo("nutrition_logged", { method: "text" });
      const kcal = items.reduce((sum, item) => sum + item.kcal, 0);
      return Response.json({ ok: true, items: items.map((item) => ({ desc: item.desc, kcal: item.kcal })), kcal });
    }
  } catch (err) {
    logError("api/log", err, { userId: user._id });
    return new Response("error", { status: 500 });
  }
  return new Response("bad request", { status: 400 });
}
