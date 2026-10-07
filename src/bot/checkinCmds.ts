// Daily and bi-weekly check-ins in the chat: the wellbeing check-in, its callback flow and the
// adaptive check-in answer. Split out of router.ts; router.ts re-exports everything here.
import { logInfo } from "../log";
import { aiJSON } from "../ai";
import * as P from "../ai/prompts";
import { checkinScale, menuBtn } from "./keyboards";
import { showEveningSurvey } from "./survey";
import { getWorkoutLog } from "../adapters/d1/v2Workouts";
import { getActivePlan, recordAdjustment, setActivePlan } from "../adapters/d1/v2Plans";
import { recordDailyCheckin } from "../adapters/d1/v2Tracking";
import { updateUser } from "../adapters/d1/v2Users";
import { localParts } from "../domain/localTime";
import { weeksSincePlan } from "../domain/deload";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { MyContext, reply, setMode } from "../adapters/telegram/context";
import { coachContext } from "./coach";
import { maybeCelebrateLevel, deferAi } from "./aiDefer";

export async function cmdCheckin(ctx: MyContext) {
  const lang = ctx.user.lang;
  await updateUser(ctx.db, ctx.user._id, {
    session: { ...ctx.user.session, mode: "checkin_energy", checkin: {} },
  });
  ctx.user.session = { ...ctx.user.session, mode: "checkin_energy", checkin: {} };
  await reply(ctx, t(lang, "checkin_q_energy"), checkinScale("energy"));
}

export async function handleCheckinCallback(ctx: MyContext, data: string) {
  const lang = ctx.user.lang;
  const [, step, nStr] = data.split(":");
  const n = Number(nStr);
  if (!Number.isInteger(n) || n < 1 || n > 5) return;
  // Ignore a stale/double-tapped answer whose step doesn't match the current question — otherwise
  // a re-delivered "energy" tap re-sends the sleep prompt (the duplicate-question bug).
  const expectMode = step === "energy" ? "checkin_energy" : step === "sleep" ? "checkin_sleep" : "checkin_stress";
  if (ctx.user.session.mode !== expectMode) { await ctx.answerCallbackQuery().catch(() => {}); return; }
  const checkin = { ...(ctx.user.session.checkin ?? {}) };
  if (step === "energy") {
    checkin.energy = n;
    await persistCheckinState(ctx, "checkin_sleep", checkin);
    await reply(ctx, t(lang, "checkin_q_sleep"), checkinScale("sleep"));
  } else if (step === "sleep") {
    checkin.sleep = n;
    await persistCheckinState(ctx, "checkin_stress", checkin);
    await reply(ctx, t(lang, "checkin_q_stress"), checkinScale("stress"));
  } else if (step === "stress") {
    const energy = checkin.energy ?? 3;
    const sleep = checkin.sleep ?? 3;
    const stress = n;
    const { date, weekday } = localParts(ctx.user.profile.timezone);
    await recordDailyCheckin(ctx.db, ctx.user._id, date, energy, sleep, stress);
    logInfo("checkin_submitted", {});
    await persistCheckinState(ctx, "idle", undefined);
    await reply(ctx, t(lang, "checkin_saved", { e: energy, s: sleep, st: stress }));
    // Context-aware advice: 2+ readiness markers ≤ 2 → back off; otherwise "train as planned"
    // ONLY when a session is still ahead today (training day, not yet logged) — else frame it as
    // recovery so we never tell someone to train on a rest day or after they've already trained.
    const low = [energy, sleep, stress].filter((v) => v <= 2).length >= 2;
    const trainingToday = (ctx.user.profile.trainingWeekdays ?? []).includes(weekday);
    const trainedAlready = trainingToday ? !!(await getWorkoutLog(ctx.db, ctx.user._id, date)) : false;
    const key = low ? "checkin_low" : trainingToday && !trainedAlready ? "checkin_ok" : "checkin_ok_rest";
    await reply(ctx, t(lang, key), menuBtn(lang));
    await maybeCelebrateLevel(ctx);
    if (ctx.user.session.survey) await showEveningSurvey(ctx);
  }
}

export async function persistCheckinState(
  ctx: MyContext,
  mode: "checkin_sleep" | "checkin_stress" | "idle",
  checkin: { energy?: number; sleep?: number } | undefined,
) {
  const session = { ...ctx.user.session, mode, checkin };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// ---------- bi-weekly adaptive check-in: AI micro-adjusts the live plan ----------

export async function handleAdaptiveCheckin(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  await setMode(ctx, "idle");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "coach", async () => {
    const result = await aiJSON<P.AdaptiveResult>(ctx.env, {
      system: P.adaptiveAdjustmentSystem(lang, ctx.user.profile, await coachContext(ctx, ctx.user)),
      user: text,
      schema: P.ADAPTIVE_SCHEMA,
      temperature: 0.5,
      kind: "coach",
      db: ctx.db,
      userId: ctx.user._id,
    });
    // Apply each micro-adjustment to the live plan (only the fields the AI changed).
    const applied: string[] = [];
    for (const adj of result.adjustments ?? []) {
      const day = plan.split.find((d) => d.weekday === adj.weekday);
      const ex = day?.exercises[adj.index];
      if (!ex) continue;
      if (adj.sets) ex.sets = cleanAi(adj.sets);
      if (adj.startWeight) ex.startWeight = cleanAi(adj.startWeight);
      if (adj.sets || adj.startWeight) {
        applied.push(`${ex.name}: ${ex.sets} · ${ex.startWeight}`);
      }
    }
    if (applied.length) {
      await setActivePlan(ctx.db, plan);
      const week = weeksSincePlan(plan.generatedAt.toISOString(), localParts(ctx.user.profile.timezone).date);
      await recordAdjustment(ctx.db, ctx.user._id, week, JSON.stringify(result.adjustments ?? []));
    }
    const summary = applied.length ? "\n\n" + applied.map((a) => `• ${escapeHtml(a)}`).join("\n") : "";
    await reply(ctx, escapeHtml(cleanAi(result.reply)) + summary, menuBtn(lang));
  });
}

// ---------- /mealplan — AI nutritionist (daily menu, grounded in USDA/OFF) ----------
