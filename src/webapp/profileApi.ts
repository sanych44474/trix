// Profile / settings editing for the Mini App (roadmap P3). GET returns the editable profile
// fields plus localized option lists; POST validates a patch against the allowed enum values and
// merges it into the profile. AI replan is NOT triggered here — the plan refreshes weekly, or the
// user rebuilds it in the bot (/replan); this screen just keeps the profile in sync.
import { listProgressPhotos, updateUser } from "../db/repos";
import { t } from "../locales/i18n";
import { miniAppUser } from "./auth";
import type { Env, Lang, UserProfile, Weekday } from "../types";

// Canonical value → i18n label key. Values MUST match the bot's obSteps() so a plan built from
// either surface reads the same profile.
const GOALS: [string, string][] = [["fat loss", "ob_goal_fatloss"], ["muscle gain", "ob_goal_muscle"], ["recomposition", "ob_goal_recomp"], ["strength", "ob_goal_strength"], ["endurance", "ob_goal_endurance"]];
const LEVELS: [string, string][] = [["beginner", "ob_level_beginner"], ["intermediate", "ob_level_intermediate"], ["advanced", "ob_level_advanced"]];
const EQUIP: [string, string][] = [["full gym", "ob_eq_gym"], ["home basics (dumbbells, bands)", "ob_eq_home"], ["dumbbells only", "ob_eq_dumbbells"], ["bodyweight only", "ob_eq_bodyweight"]];
const DIET: [string, string][] = [["none", "ob_diet_none"], ["vegetarian", "ob_diet_vegetarian"], ["vegan", "ob_diet_vegan"]];
const WD_KEYS = ["", "wd_mon", "wd_tue", "wd_wed", "wd_thu", "wd_fri", "wd_sat", "wd_sun"];

const opts = (lang: Lang, list: [string, string][]) => list.map(([value, key]) => ({ value, label: t(lang, key as Parameters<typeof t>[1]) }));

export async function handleProfileApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const lang = user.lang;
  const p = user.profile;

  if (req.method === "GET") {
    const photos = await listProgressPhotos(env.DB, user._id, 12).catch(() => []);
    return Response.json(
      {
        photos: photos.map((ph) => ({ id: ph.id, takenAt: ph.takenAt.slice(0, 10) })),
        profile: {
          name: p.name ?? "",
          goal: p.goal ?? "",
          level: p.level ?? "",
          equipment: p.equipment ?? "",
          dietPrefs: p.dietPrefs ?? "",
          limitations: p.limitations ?? "",
          goalWeight: p.goalWeight ?? null,
          waterGoalMl: p.waterGoalMl ?? null,
          waterEvery: p.waterEvery ?? 0,
          stepsGoal: p.stepsGoal ?? null,
          quietFrom: p.quietFrom ?? null,
          quietTo: p.quietTo ?? null,
          reminderHour: p.reminderHour ?? 9,
          trainingWeekdays: p.trainingWeekdays ?? [],
          share: user.role === "client" ? { body: !!p.shareWithTrainer?.body, health: !!p.shareWithTrainer?.health } : null,
        },
        options: { goal: opts(lang, GOALS), level: opts(lang, LEVELS), equipment: opts(lang, EQUIP), diet: opts(lang, DIET) },
        weekdays: [1, 2, 3, 4, 5, 6, 7].map((w) => ({ value: w, label: t(lang, WD_KEYS[w] as Parameters<typeof t>[1]) })),
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

  const patch: Partial<UserProfile> = {};
  const inSet = (v: unknown, list: [string, string][]) => typeof v === "string" && list.some(([val]) => val === v);
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 60) || undefined;
  if (inSet(body.goal, GOALS)) patch.goal = body.goal as string;
  if (inSet(body.level, LEVELS)) patch.level = body.level as UserProfile["level"];
  if (inSet(body.equipment, EQUIP)) patch.equipment = body.equipment as string;
  if (inSet(body.dietPrefs, DIET)) patch.dietPrefs = body.dietPrefs as string;
  if (typeof body.limitations === "string") patch.limitations = body.limitations.trim().slice(0, 500);
  if (body.goalWeight === null || body.goalWeight === "") patch.goalWeight = undefined;
  else if (typeof body.goalWeight === "number" && body.goalWeight >= 30 && body.goalWeight <= 300) patch.goalWeight = Math.round(body.goalWeight * 10) / 10;
  if (typeof body.reminderHour === "number" && Number.isInteger(body.reminderHour) && body.reminderHour >= 0 && body.reminderHour <= 23) patch.reminderHour = body.reminderHour;
  // Personal daily goals for the activity rings; empty clears back to formula/default.
  if (body.waterGoalMl === null || body.waterGoalMl === "") patch.waterGoalMl = undefined;
  else if (typeof body.waterGoalMl === "number" && body.waterGoalMl >= 500 && body.waterGoalMl <= 8000) patch.waterGoalMl = Math.round(body.waterGoalMl / 50) * 50;
  if (body.waterEvery === 0 || body.waterEvery === null) patch.waterEvery = undefined;
  else if (body.waterEvery === 2 || body.waterEvery === 3 || body.waterEvery === 4) patch.waterEvery = body.waterEvery;
  if (body.stepsGoal === null || body.stepsGoal === "") patch.stepsGoal = undefined;
  else if (typeof body.stepsGoal === "number" && body.stepsGoal >= 1000 && body.stepsGoal <= 50000) patch.stepsGoal = Math.round(body.stepsGoal / 500) * 500;
  // Quiet hours: both bounds together or both cleared (0..23; equal = off).
  const qHour = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
  if (body.quietFrom === null || body.quietTo === null || body.quietFrom === "" || body.quietTo === "") {
    patch.quietFrom = undefined;
    patch.quietTo = undefined;
  } else if (qHour(body.quietFrom) !== null && qHour(body.quietTo) !== null) {
    patch.quietFrom = qHour(body.quietFrom) as number;
    patch.quietTo = qHour(body.quietTo) as number;
  }
  if (Array.isArray(body.trainingWeekdays)) {
    const wd = [...new Set(body.trainingWeekdays.map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b) as Weekday[];
    if (wd.length) { patch.trainingWeekdays = wd; patch.daysPerWeek = wd.length; }
  }
  // Client-owned trainer-sharing consent (only clients).
  if (user.role === "client" && body.share && typeof body.share === "object") {
    const s = body.share as { body?: unknown; health?: unknown };
    patch.shareWithTrainer = { body: s.body === true, health: s.health === true };
  }

  const profile = { ...user.profile, ...patch };
  await updateUser(env.DB, user._id, { profile });
  return Response.json({ ok: true });
}

// Initial onboarding as a web form (P3 optional part). Saves the same profile fields the bot's
// button wizard collects and parks the session in plan_pending — the every-minute scheduler's
// recovery sweep then generates the plan (bank-first, AI when available) and pushes "plan ready"
// to the chat, exactly like a wizard finish that hit a Worker timeout. No new AI plumbing.
export async function handleOnboardingApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  if (user.onboarded) return Response.json({ error: "already onboarded" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const patch: Partial<UserProfile> = {};
  if (body.sex === "male" || body.sex === "female") patch.sex = body.sex;
  if (typeof body.age === "number" && body.age > 0 && body.age <= 120) patch.age = Math.round(body.age);
  if (typeof body.heightCm === "number" && body.heightCm >= 100 && body.heightCm <= 250) patch.heightCm = Math.round(body.heightCm);
  if (typeof body.weightKg === "number" && body.weightKg >= 30 && body.weightKg <= 300) patch.weightKg = Math.round(body.weightKg * 10) / 10;
  const inSet = (v: unknown, list: [string, string][]) => typeof v === "string" && list.some(([val]) => val === v);
  if (inSet(body.goal, GOALS)) patch.goal = body.goal as string;
  if (inSet(body.level, LEVELS)) patch.level = body.level as UserProfile["level"];
  if (inSet(body.equipment, EQUIP)) patch.equipment = body.equipment as string;
  if (inSet(body.dietPrefs, DIET)) patch.dietPrefs = body.dietPrefs as string;
  if (body.lifestyle === "sedentary" || body.lifestyle === "moderate" || body.lifestyle === "active") patch.lifestyle = body.lifestyle;
  if (body.sleepSchedule === "morning" || body.sleepSchedule === "evening") patch.sleepSchedule = body.sleepSchedule;
  if (typeof body.limitations === "string") patch.limitations = body.limitations.trim().slice(0, 500) || "none";
  if (Array.isArray(body.trainingWeekdays)) {
    const wd = [...new Set(body.trainingWeekdays.map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b) as Weekday[];
    if (wd.length) { patch.trainingWeekdays = wd; patch.daysPerWeek = wd.length; }
  }
  // The wizard's required core: without these the plan generator can't do a decent job.
  const merged = { ...user.profile, ...patch };
  if (!merged.sex || !merged.age || !merged.goal || !merged.level || !(merged.trainingWeekdays ?? []).length || !merged.equipment) {
    return Response.json({ error: "incomplete" }, { status: 400 });
  }
  if (merged.limitations === undefined) merged.limitations = "none";
  await updateUser(env.DB, user._id, { profile: merged, session: { mode: "plan_pending" } });
  return Response.json({ ok: true, pending: true });
}
