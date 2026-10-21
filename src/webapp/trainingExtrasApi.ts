// Training extras for the apps: the cardio templates, the strength standards and the
// post-vacation comeback interview. Each reuses the bot's pure domain code (cardioPlan, standards,
// vacation.comebackSteps, planService.rebuildPlan); the quick cardio log lives in quickLogApi.ts.
import { bodyLogsByUser } from "../adapters/d1/v2Tracking";
import { listStrength } from "../adapters/d1/v2Workouts";
import { updateUser } from "../adapters/d1/v2Users";
import { comebackSteps } from "../bot/vacation";
import { CARDIO_TEMPLATES, CARDIO_TYPES, cardioName, zoneBpm } from "../domain/cardioPlan";
import { e1rm } from "../domain/records";
import { strengthStandard } from "../domain/standards";
import { rebuildPlan, replanRunning } from "../features/plan/planService";
import { t } from "../locales/i18n";
import { miniAppUser } from "./auth";
import type { Env, Lang } from "../types";

type TKey = Parameters<typeof t>[1];
const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
const err = (status: number, error: string) => Response.json({ error }, { status });

export async function handleTrainingExtrasApi(req: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return err(401, "unauthorized");
  const lang: Lang = user.lang;
  const path = url.pathname;

  // ---- Cardio templates (bot: survey.ts showCardioMenu / showCardioPlans / showCardioSession) ----
  if (req.method === "GET" && path === "/api/cardio") {
    const age = user.profile.age ?? 30;
    return json({
      // name: the prefix the free-text logger writes ("" for other); label: the button caption.
      quick: CARDIO_TYPES.map((c) => ({
        key: c.key,
        name: c.key === "other" ? "" : cardioName(lang, c.key),
        label: t(lang, `cardio_${c.key}` as TKey),
      })),
      structured: {
        intro: t(lang, "cardio_structured_intro"),
        zoneNote: t(lang, "cardio_zone_note"),
        templates: CARDIO_TEMPLATES.map((tpl) => ({
          key: tpl.key,
          emoji: tpl.emoji,
          name: t(lang, `cardio_tpl_${tpl.key}` as TKey),
          totalMin: tpl.totalMin,
          steps: tpl.steps.map((st) => ({
            label: t(lang, `cardio_step_${st.label}` as TKey),
            minutes: st.minutes,
            zone: st.zone,
            reps: st.reps ?? 1,
            bpm: zoneBpm(age, st.zone),
          })),
        })),
      },
      bpmLabel: t(lang, "cardio_bpm"),
    });
  }

  // ---- Strength standards (bot: progressCmds.ts cmdStandards) ----
  if (req.method === "GET" && path === "/api/standards") {
    const sex = user.profile.sex;
    const records = await listStrength(env.DB, user._id);
    // Bodyweight: latest logged weight, else profile weight (the bot's rule).
    const bodyLogs = await bodyLogsByUser(env.DB, user._id).catch(() => []);
    const weights = bodyLogs.filter((b) => typeof b.weight === "number" && b.weight! > 0);
    const bw = weights.length ? (weights[weights.length - 1].weight as number) : (user.profile.weightKg ?? 0);
    if (bw <= 0) return json({ needsWeight: true, bodyweight: null, sex: sex ?? null, lifts: [] });
    const lifts = [];
    for (const r of records) {
      if (r.bestWeight <= 0) continue;
      const oneRm = e1rm(r.bestWeight, r.bestReps);
      const std = strengthStandard(r.exercise, sex, bw, oneRm);
      if (!std) continue;
      lifts.push({
        exercise: r.exercise,
        e1rm: Math.round(oneRm),
        ratio: std.ratio,
        level: std.level,
        levelLabel: t(lang, `std_lvl_${std.level}` as TKey),
        ...(std.next && std.nextTargetKg
          ? { next: std.next, nextLabel: t(lang, `std_lvl_${std.next}` as TKey), nextTargetKg: std.nextTargetKg }
          : {}),
      });
    }
    return json({ needsWeight: false, bodyweight: Math.round(bw), sex: sex ?? null, lifts });
  }

  // ---- Comeback interview (bot: vacation.ts comebackSteps / finishComeback) ----
  if (path === "/api/comeback") {
    const pending = user.session.mode === "comeback";
    const steps = comebackSteps().map((s) => ({
      key: s.key,
      kind: s.kind,
      question: t(lang, s.q),
      ...(s.buttons ? { buttons: s.buttons.map((b) => ({ value: b.value, label: t(lang, b.label) })) } : {}),
    }));
    if (req.method === "GET") return json({ pending, steps });
    if (req.method !== "POST") return err(405, "method not allowed");
    if (!pending) return err(409, "conflict");

    let body: { answers?: Record<string, unknown>; decision?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return err(400, "bad request");
    }
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const clean: Record<string, string> = {};
    for (const s of comebackSteps().filter((x) => x.key !== "decision")) {
      const v = answers[s.key];
      if (s.kind === "text") {
        if (typeof v !== "string" || !v.trim()) return err(400, "bad request");
        clean[s.key] = v.trim().slice(0, 300);
      } else {
        if (typeof v !== "string" || !(s.buttons ?? []).some((b) => b.value === v)) return err(400, "bad request");
        clean[s.key] = v;
      }
    }
    const decision = body.decision;
    if (decision !== "keep" && decision !== "adjust" && decision !== "recreate") return err(400, "bad request");

    if (decision === "recreate") {
      // Same guards as the Mini App's replan route: trainer clients follow their trainer's plan.
      if (user.role === "client" && user.trainerId) return err(403, "trainer_managed");
      if (!user.onboarded) return err(409, "not_onboarded");
      if (replanRunning(user)) return json({ ok: true, decision, planPending: true });
    }

    // The bot's finishComeback, minus the chat replies: keep → idle, adjust → the adaptive check-in
    // (the next message drives it, as in the bot), recreate → the app's background plan rebuild.
    if (decision === "keep") {
      await updateUser(env.DB, user._id, { session: { mode: "idle" } });
      return json({ ok: true, decision, planPending: false });
    }
    if (decision === "adjust") {
      await updateUser(env.DB, user._id, { session: { mode: "checkin_adaptive" } });
      return json({ ok: true, decision, planPending: false });
    }
    const session = { mode: "idle" as const, replanAt: new Date().toISOString() };
    await updateUser(env.DB, user._id, { session });
    const job = rebuildPlan(env, env.DB, { ...user, session });
    if (ctx) ctx.waitUntil(job);
    else await job;
    return json({ ok: true, decision, planPending: true });
  }

  return err(404, "not found");
}
