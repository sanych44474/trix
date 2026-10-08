// Ready programs in the Mini App (More → Ready programs): the 45 hand-written plans of
// domain/programCatalog.ts. GET lists them with their days in the viewer's language; POST
// applies one to the viewer -- adapted to their body, records and level like a bank plan, on
// their own training days when they have enough, and becomes the active plan.
import { setActivePlan } from "../adapters/d1/v2Plans";
import { recordPlanSource } from "../adapters/d1/v2Analytics";
import { listStrength } from "../adapters/d1/v2Workouts";
import { stampOnboardedAt, updateUser } from "../adapters/d1/v2Users";
import { adaptPlan } from "../domain/planAdapt";
import { PROGRAMS, buildProgram, findProgram } from "../domain/programCatalog";
import { formatRecordBest } from "../domain/setFormat";
import { logInfo } from "../log";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
import type { Env, Weekday } from "../types";

const noStore = { headers: { "cache-control": "no-store" } };

/** The person's own weekdays when they train at least as often as the program, else the program's. */
export function programWeekdays(own: Weekday[] | undefined, programDays: Weekday[]): Weekday[] {
  const mine = [...new Set(own ?? [])].sort((a, b) => a - b);
  return mine.length >= programDays.length ? mine.slice(0, programDays.length) : programDays;
}

export async function handleProgramsApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const lang = user.lang === "en" ? "en" : "uk";

  if (req.method === "GET") {
    const programs = PROGRAMS.map((p) => {
      const plan = buildProgram(p.id, lang);
      return {
        id: p.id,
        place: p.place,
        audience: p.audience,
        level: p.level,
        goal: p.goal,
        daysPerWeek: p.daysPerWeek,
        minutes: p.minutes,
        name: p.name[lang],
        summary: p.summary[lang],
        days: (plan?.split ?? []).map((d) => ({ title: d.muscleGroup, exercises: d.exercises.map((e) => ({ name: e.name, sets: e.sets })) })),
      };
    });
    return Response.json({ role: user.role, programs }, noStore);
  }

  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  // A trainer's client follows the trainer's plan.
  if (user.role === "client" && user.trainerId) return Response.json({ error: "trainer_managed" }, { status: 403 });
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const id = typeof (parsed.body as { id?: unknown }).id === "string" ? (parsed.body as { id: string }).id : "";
  const meta = findProgram(id);
  const base = meta ? buildProgram(meta.id, lang) : null;
  if (!meta || !base) return Response.json({ error: "not found" }, { status: 404 });

  const weekdays = programWeekdays(user.profile.trainingWeekdays, base.split.map((d) => d.weekday));
  const profile = { ...user.profile, trainingWeekdays: weekdays, daysPerWeek: weekdays.length };
  const records = await listStrength(env.DB, user._id, 8).catch(() => []);
  const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
  const plan = adaptPlan(base, profile, user._id, { prs, finishFor: lang });
  await setActivePlan(env.DB, plan);
  if (!user.onboarded) {
    logInfo("onboarding_completed", { role: user.role });
    logInfo("first_plan_ready", { source: "template" });
    await stampOnboardedAt(env.DB, user._id).catch(() => {});
  }
  await updateUser(env.DB, user._id, { onboarded: true, nutrition: plan.nutrition, profile });
  await recordPlanSource(env.DB, user._id, "workout", "template").catch(() => {});
  logInfo("program_applied", { id: meta.id, place: meta.place, level: meta.level });
  return Response.json({ ok: true, name: meta.name[lang], weekdays });
}
