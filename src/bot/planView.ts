// Viewing training in the bot: /plan, /today, /schedule, workout info, exercise videos for the
// shown days, and the compact plan-day references used in callback data.
import { offerRecoverySwap } from "./recoverySwap";
import { kitFitButton } from "./kitFit";
import { InlineKeyboard } from "grammy";
import type { ExerciseVideo, PlanDay, Weekday } from "../types";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getDailyCheckin } from "../adapters/d1/v2Tracking";
import { getExerciseVideos, getUserVideos } from "../adapters/d1/v2Catalog";
import { escapeHtml, t } from "../locales/i18n";
import { deloadSets, readinessAdvice } from "../domain/deload";
import { localParts } from "../domain/localTime";
import { phaseKey as mesoPhaseKey, trainingWeek } from "../domain/mesocycle";
import { buildVideoOpenLink } from "../domain/videoLink";
import { exerciseVideoKey, renderPlan, renderSchedule, renderToday, upcomingSessions } from "../render";
import { localCutoff } from "./report";
import { renderDayInline } from "./workoutSave";
import { showPlanEditDay } from "../features/trainer/clientCard";
import { menuBtn, planViewKb, difficultyKeyboard, todayWorkoutKeyboard } from "./keyboards";
import { healPlanIfDegenerate } from "./plan";
import { readinessWithConditioning, recentConditioningStrain } from "../domain/conditioning";
import { lookupExerciseVideoCached } from "../youtube";
import { clearEditOwner, reply, type MyContext } from "../adapters/telegram/context";
import { healPlanNamesForDisplay, sendExerciseDescriptions } from "./exerciseCatalog";
import { APP_URL } from "./appLinks";

// A weekday + exercise index packed into a single numeric session.targetId (weekday*1000 + idx).
export function encodePlanRef(weekday: number, index: number): number {
  return weekday * 1000 + index;
}

export function decodePlanRef(ref: number): { weekday: number; index: number } {
  return { weekday: Math.floor(ref / 1000), index: ref % 1000 };
}

// Re-show the managed user's edit-day view after a shared edit action (delete/swap/…), so the
// trainer/owner stays in the client's plan instead of being dropped into their OWN today view.
// Stayed in bot.ts (not adapters/telegram/context.ts) because it calls showPlanEditDay, a
// feature-layer function (features/trainer/trainer.ts) — moving it would just recreate the cycle one file over.
export async function reRenderEditDay(ctx: MyContext, weekday: Weekday) {
  const owner = ctx.user.session.editPlanOwner;
  const prefix = ctx.user.session.editPlanPrefix ?? "cl";
  if (owner === undefined) return;
  await showPlanEditDay(ctx, owner, prefix, weekday);
}

// ---------------- command implementations ----------------

// Cached technique videos for the exercises in the given days, for rendering. Any exercise that
// has never been searched is queued for a background YouTube lookup (fire-and-forget, stops on
// quota) so it appears on the next view — the current render is never blocked or slowed.
export async function videosForDays(ctx: MyContext, days: PlanDay[]): Promise<Map<string, ExerciseVideo>> {
  const keys = [...new Set(days.flatMap((d) => d.exercises.map((e) => exerciseVideoKey(e))))];
  if (!keys.length) return new Map();
  const map = await getExerciseVideos(ctx.db, keys).catch(() => new Map<string, ExerciseVideo>());
  // A viewer's personal override (set via 🎥 Відео) wins over the shared/global video.
  const overrides = await getUserVideos(ctx.db, ctx.user._id, keys).catch(() => new Map<string, ExerciseVideo>());
  for (const [k, v] of overrides) map.set(k, v);
  // Route links through the Worker's /v redirect so opens are counted (video_open event).
  // Only when deployed (APP_URL set) — local dev keeps direct links.
  for (const [k, v] of map) {
    if (v.url) map.set(k, { ...v, url: await buildVideoOpenLink(APP_URL, v.url, ctx.user._id, ctx.env.TELEGRAM_BOT_TOKEN) });
  }
  if (ctx.env.YOUTUBE_API_KEY) {
    const missing = days.flatMap((d) => d.exercises).filter((e) => !map.has(exerciseVideoKey(e)));
    if (missing.length) {
      ctx.waitUntil(
        (async () => {
          const seen = new Set<string>();
          for (const e of missing) {
            const k = exerciseVideoKey(e);
            if (seen.has(k)) continue;
            seen.add(k);
            try {
              await lookupExerciseVideoCached(ctx.db, ctx.env, e.canonicalName || e.name);
            } catch {
              break; // quota (or other error) — stop the batch
            }
          }
        })(),
      );
    }
  }
  return map;
}

export async function cmdPlan(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  let plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"));
    return;
  }
  plan = await healPlanIfDegenerate(ctx, plan);
  plan = await healPlanNamesForDisplay(ctx, plan, lang);
  // Exercises needing equipment they don't have → a one-tap fix leads the keyboard (bot/kitFit.ts).
  const kb = planViewKb(lang);
  const fit = await kitFitButton(ctx).catch(() => null);
  await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), fit ? new InlineKeyboard().text(fit.text, fit.data).row().append(kb) : kb);
}

export type PendingExercise = NonNullable<MyContext["user"]["session"]["pendingExercise"]>;

export async function cmdToday(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  let plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"));
    return;
  }
  plan = await healPlanIfDegenerate(ctx, plan);
  plan = await healPlanNamesForDisplay(ctx, plan, lang);
  const tz = ctx.user.profile.timezone;
  const recentLogs = await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14));
  const logs = recentLogs.map((l) => ({ date: l.date, completed: l.completed }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 6);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today);
  if (todays && todays.status === "pending") {
    // Overview + action buttons. Full instructions/safety are available on demand via the
    // "📖 Інфо про вправи" button (showWorkoutInfo) — not auto-sent here, to avoid clutter.
    // Auto-deload week: same exercises, ~40% fewer sets, with a notice (no manual /replan).
    const week = trainingWeek(plan, today);
    const deload = week.deload;
    const day = deload
      ? { ...todays.day, exercises: todays.day.exercises.map((e) => ({ ...e, sets: deloadSets(e.sets) })) }
      : todays.day;
    // Periodization awareness: the plan's block phase (only plans with a mesocycle have one).
    // On a deload week the deload notice already says it, so no phase line on top.
    const phaseLine =
      !deload && week.phase
        ? t(lang, "periodization_line", { phase: t(lang, mesoPhaseKey(week.phase) as Parameters<typeof t>[1]), week: week.weekInBlock ?? 1, len: week.blockLength ?? 4 }) + "\n\n"
        : "";
    const notice = deload ? t(lang, "deload_today") + "\n\n" : "";
    // Same-day autoregulation: today's check-in (energy/sleep/stress) has always gated the
    // WEEKLY progression (computePlanProgression's heldForWellbeing) but never said anything
    // about today's session. On a bad-readiness day, say so up front — on a deload week the
    // load is already cut, so don't stack a second "go easier" message on top of it.
    let readinessLine = "";
    if (!deload) {
      const checkin = await getDailyCheckin(ctx.db, ctx.user._id, today).catch(() => null);
      const base = readinessAdvice(checkin);
      // A long run yesterday is a recovery cost the check-in may not reflect at all — fold recent
      // conditioning in, and say which of the two is doing the talking.
      const strained = recentConditioningStrain(recentLogs, today);
      const readiness = readinessWithConditioning(base, strained);
      if (readiness !== "ok") {
        const key = base === "ok" ? "readiness_cardio" : readiness === "light" ? "readiness_light" : "readiness_easy";
        readinessLine = t(lang, key) + "\n\n";
      }
    }
    await reply(ctx, phaseLine + notice + readinessLine + renderToday(lang, day, todays.label, undefined, await videosForDays(ctx, [day])), todayWorkoutKeyboard(lang, todays.weekday));
    await offerRecoverySwap(ctx, plan, recentLogs, today, todays.weekday).catch(() => {});
    return;
  } else {
    // Rest day or already logged → show the dated schedule then next session with action buttons.
    const next = sessions.find((s) => s.isNext);
    await reply(ctx, renderSchedule(lang, sessions, next ? await videosForDays(ctx, [next.day]) : undefined));
    if (next) {
      await reply(
        ctx,
        `🏋️ <b>${escapeHtml(next.label)} — ${escapeHtml(next.day.muscleGroup)}</b>\n` + renderDayInline(next.day),
        difficultyKeyboard(lang, next.weekday),
      );
    } else {
      // No upcoming session — a bare menu button with an empty body renders as a blank message.
      await reply(ctx, t(lang, "today_rest"), menuBtn(lang));
    }
  }
}

export async function cmdSchedule(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"));
    return;
  }
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 8);
  const next = sessions.find((s) => s.isNext) ?? sessions[0];
  await reply(ctx, renderSchedule(lang, sessions, next ? await videosForDays(ctx, [next.day]) : undefined), menuBtn(lang));
}

export async function showWorkoutInfo(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"), menuBtn(lang));
    return;
  }
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 6);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today && s.status === "pending");
  const next = todays ? todays.day : sessions.find((s) => s.isNext)?.day ?? sessions[0]?.day;
  if (!next) {
    await reply(ctx, t(lang, "exercise_info_unavailable"), menuBtn(lang));
    return;
  }
  await reply(ctx, `${t(lang, "exercise_info_header")}\n📖 <b>${escapeHtml(next.muscleGroup)}</b>`);
  await sendExerciseDescriptions(ctx, next, lang);
}
