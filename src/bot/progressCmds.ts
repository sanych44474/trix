// Progress commands: /progress, week card, strength standards, /volume, plate calculator,
// wellbeing, macro suggestions and the lift charts. Split out of bot.ts (god-file split);
// bot.ts re-exports everything here, so existing imports keep working.
import { InlineKeyboard, InputFile } from "grammy";
import type { Weekday } from "../types";
import { recordError, userStatCounts } from "../adapters/d1/v2Admin";
import { countCompletedWorkouts, listStrength, workoutLogsSince } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { bodyLogsByUser, dailyCheckinsSince } from "../adapters/d1/v2Tracking";
import { getDayMeals, nutritionLogsSince } from "../adapters/d1/v2Nutrition";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { aiText } from "../ai";
import * as P from "../ai/prompts";
import { buildActivityCells, deloadDue, localParts } from "../domain/progression";
import { e1rm, weekStartStr, weekStreak } from "../domain/records";
import { conditioningLoadLabel, renderActivityGrid, renderStrength, exerciseChart, wellbeingChart } from "../render";
import { strengthStandard, type StrengthLevel } from "../domain/standards";
import { localCutoff } from "./report";
import { num } from "../features/nutrition/nutritionLog";
import { buildWeekCard } from "../features/gamification/weekCard";
import { menuBtn } from "./keyboards";
import { botDeepLink } from "./links";
import { deferAi } from "./router";
import { computeXp, levelFromXp } from "../domain/gamification";
import { weeklyVolume, projectWeight, stalledLifts, type MuscleVolume } from "../domain/analysis";
import { conditioningWeek } from "../domain/conditioning";
import { platePlan, warmupRamp } from "../domain/calc";
import { progressBar } from "../domain/challenges";
import { clearEditOwner, reply, setMode, type MyContext, type TKey } from "../adapters/telegram/context";
import { dashboardUrl } from "../bot";

export async function cmdProgress(ctx: MyContext) {
  const lang = ctx.user.lang;
  const records = await listStrength(ctx.db, ctx.user._id);
  if (!records.length) {
    await reply(ctx, t(lang, "progress_none"), menuBtn(lang));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  // Personal 28-day streak calendar (gamification, no leaderboard).
  const since28 = localCutoff(ctx.user.profile.timezone, 28);
  const [wLogs, nLogs, total, plan, bodyLogs, statCounts] = await Promise.all([
    workoutLogsSince(ctx.db, ctx.user._id, since28),
    nutritionLogsSince(ctx.db, ctx.user._id, since28),
    countCompletedWorkouts(ctx.db, ctx.user._id),
    getActivePlan(ctx.db, ctx.user._id),
    bodyLogsByUser(ctx.db, ctx.user._id).catch(() => []),
    userStatCounts(ctx.db, ctx.user._id).catch(() => ({ workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 })),
  ]);
  const completed = wLogs.filter((l) => l.completed);
  const workoutDates = new Set(completed.map((l) => l.date));
  const nutritionDates = new Set(nLogs.map((l) => l.date));
  // Off-plan vs planned: a completed log on a weekday the plan doesn't schedule is a bonus session.
  const planWeekdays = new Set((plan?.split ?? []).map((d) => d.weekday));
  const offPlan = completed.filter((l) => planWeekdays.size > 0 && !planWeekdays.has(l.weekday)).length;
  const weekStart = weekStartStr(date);
  const thisWeek = completed.filter((l) => l.date >= weekStart).length;
  const streak = weekStreak([...workoutDates], date, ctx.user.reminders?.lastVacation);
  // Rest-day activity: days fed/tracked but not trained — so a rest day isn't "empty".
  const restActive = [...nutritionDates].filter((d) => !workoutDates.has(d)).length;
  const lv = levelFromXp(computeXp(statCounts));
  const summary =
    `${t(lang, "progress_summary")}\n` +
    `${t(lang, "progress_level_line", { level: lv.level, xp: lv.xp, bar: progressBar((lv.intoLevel / lv.needed) * 100) })}\n` +
    `${t(lang, "progress_total_line", { total, week: thisWeek })}\n` +
    `${t(lang, "progress_streak_line", { n: streak })}\n` +
    (offPlan > 0 ? `${t(lang, "progress_offplan_line", { n: offPlan })}\n` : "") +
    `${t(lang, "progress_restdays_line", { n: restActive })}`;
  let msg = `${summary}\n\n${renderStrength(lang, records)}`;
  msg += `\n\n${renderActivityGrid(lang, buildActivityCells(date, workoutDates, nutritionDates, 28))}`;
  if (deloadDue(records, date)) msg += `\n\n${t(lang, "deload_due")}`;
  // No strength records = nothing to analyse. The prompt asks the model to "note improvements
  // and give the next progression target per lift"; handed an empty array it can only produce
  // generic filler that reads as praise for training that was never logged.
  try {
    if (!records.length) throw new Error("no records to narrate");
    const narrative = await aiText(ctx.env, {
      system: P.progressSystem(lang),
      user: JSON.stringify(
        records.map((r) => ({
          exercise: r.exercise,
          best: `${r.bestWeight}x${r.bestReps}`,
          history: r.history.slice(-6),
        })),
      ),
      temperature: 0.5,
      kind: "progress",
      db: ctx.db,
      userId: ctx.user._id,
    });
    msg += `\n\n💬 <i>${escapeHtml(narrative)}</i>`;
  } catch {
    /* narrative is optional */
  }
  const weights = bodyLogs.filter((b) => typeof b.weight === "number" && b.weight > 0).map((b) => ({ date: b.date, weight: b.weight as number }));
  // Weight-goal projection: trend toward the target, with an ETA when on track.
  const goalLine = weightGoalLine(ctx, weights);
  if (goalLine) msg += `\n\n${goalLine}`;
  // Plateau heads-up: lifts with no recent e1RM gain.
  const stalled = stalledLifts(records, date);
  if (stalled.length) msg += `\n\n${t(lang, "plateau_line", { lifts: stalled.slice(0, 3).map(escapeHtml).join(", ") })}`;
  // Visual charts (weight trend, e1RM, measurements) live in the Mini App dashboard now —
  // no more external QuickChart PNG round-trips on every /progress.
  const kb = new InlineKeyboard()
    .text(t(lang, "exchart_btn"), "exlist")
    .text(t(lang, "standards_btn"), "std")
    .row()
    .text(t(lang, "volume_btn"), "vol")
    .text(t(lang, "calc_btn"), "calc")
    .row()
    .text(t(lang, "wellbeing_btn"), "well")
    .text(t(lang, "wcard_btn"), "share:week")
    .row();
  const app = dashboardUrl();
  if (app) kb.webApp(t(lang, "menu_dashboard"), app).row();
  kb.text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, msg, kb);
}

// Shareable week card — a <pre> summary of the last 7 days the user can forward to friends.
export async function cmdWeekCard(ctx: MyContext) {
  const lang = ctx.user.lang;
  const card = await buildWeekCard(ctx.db, ctx.user._id, ctx.user.profile.timezone, ctx.user.profile.name ?? "", lang, ctx.user.reminders?.lastVacation);
  if (!card) {
    await reply(ctx, t(lang, "wcard_empty"), menuBtn(lang));
    return;
  }
  // The card gets forwarded into group chats as-is, so it carries the sender's referral link:
  // every forward becomes a click target instead of just a screenshot. Only on the self-serve
  // path — a trainer forwarding a CLIENT's card (buildWeekCard's other callers) must not attach
  // the client's link.
  const ref = botDeepLink(ctx.env, `ref_${ctx.user._id}`);
  const footer = ref ? t(lang, "wcard_ref", { link: ref }) : t(lang, "wcard_share_hint");
  await reply(ctx, `${card}\n\n${footer}`, menuBtn(lang));
}

// Strength standards — classify the user's tracked big lifts (squat/bench/deadlift/OHP/row) into
// a bodyweight-relative bracket, with the load needed for the next level. Approximate, motivational.
export async function cmdStandards(ctx: MyContext) {
  const lang = ctx.user.lang;
  const sex = ctx.user.profile.sex;
  const records = await listStrength(ctx.db, ctx.user._id);
  // Bodyweight: latest logged weight, else profile weight.
  const bodyLogs = await bodyLogsByUser(ctx.db, ctx.user._id).catch(() => []);
  const weights = bodyLogs.filter((b) => typeof b.weight === "number" && b.weight! > 0);
  const bw = weights.length ? (weights[weights.length - 1].weight as number) : (ctx.user.profile.weightKg ?? 0);
  if (bw <= 0) {
    // One-tap route into the body editor instead of a "go find Settings" dead end.
    const kb = new InlineKeyboard().text(t(lang, "edit_body"), "set:body").row().text(t(lang, "menu_open"), "menu:open");
    await reply(ctx, t(lang, "standards_no_weight"), kb);
    return;
  }
  const levelName = (lv: StrengthLevel) => t(lang, `std_lvl_${lv}` as TKey);
  const lines: string[] = [];
  for (const r of records) {
    if (r.bestWeight <= 0) continue;
    const oneRm = e1rm(r.bestWeight, r.bestReps);
    const std = strengthStandard(r.exercise, sex, bw, oneRm);
    if (!std) continue;
    let line = `${escapeHtml(r.exercise)}: <b>${levelName(std.level)}</b> · ${Math.round(oneRm)}${t(lang, "unit_kg")} (×${std.ratio.toFixed(2)})`;
    if (std.next && std.nextTargetKg) {
      line += `\n   ${t(lang, "standards_next", { level: levelName(std.next), kg: std.nextTargetKg })}`;
    }
    lines.push(line);
  }
  if (!lines.length) { await reply(ctx, t(lang, "standards_none"), menuBtn(lang)); return; }
  const header = t(lang, "standards_title", { bw: Math.round(bw), sex: t(lang, sex === "female" ? "sex_female" : "sex_male") });
  await reply(ctx, `${header}\n\n${lines.join("\n\n")}\n\n${t(lang, "standards_footer")}`, menuBtn(lang));
}

// Weight-goal projection line for the progress screen — trend toward the user's target, ETA when
// on track. Returns null when no goal is set or there's too little weight history.
export function weightGoalLine(ctx: MyContext, weights: { date: string; weight: number }[]): string | null {
  const lang = ctx.user.lang;
  const goal = ctx.user.profile.goalWeight;
  if (!goal || goal <= 0) return null;
  const p = projectWeight(weights, goal);
  if (!p) return null;
  if (p.reached) return t(lang, "goal_reached", { goal });
  const trend = t(lang, p.slopePerWeek === 0 ? "goal_trend_flat" : p.slopePerWeek < 0 ? "goal_trend_down" : "goal_trend_up", { kg: Math.abs(p.slopePerWeek) });
  if (p.onTrack && p.etaWeeks) {
    return t(lang, "goal_on_track", { current: Math.round(p.current), goal, trend, weeks: p.etaWeeks });
  }
  return t(lang, "goal_off_track", { current: Math.round(p.current), goal, trend });
}

export const VOL_GROUP_LABEL: Record<string, TKey> = {
  legs: "mg_legs", back: "mg_back", chest: "mg_chest", shoulders: "mg_shoulders", arms: "mg_arms", core: "mg_core",
};

export const VOL_ZONE_EMOJI: Record<string, string> = { below: "🔻", optimal: "✅", above: "🔺" };

// Weekly training volume (working sets) per muscle group vs. MEV/MAV landmarks.
export async function cmdVolume(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const since = localCutoff(ctx.user.profile.timezone, 7);
  const logs = await workoutLogsSince(ctx.db, ctx.user._id, since);
  const vols = weeklyVolume(logs, since).filter((v) => v.group !== "core" || v.sets > 0);
  // Conditioning sits next to the lifting volume, not in a separate world: the same week that
  // holds a strength increase is the one the athlete needs to see here.
  const cond = conditioningWeek(logs, since);
  const totalSets = vols.reduce((s, v) => s + v.sets, 0);
  if (!totalSets && !cond.sessions) { await reply(ctx, t(lang, "volume_none"), menuBtn(lang)); return; }
  const fmt = (v: MuscleVolume) =>
    `${VOL_ZONE_EMOJI[v.zone]} ${t(lang, VOL_GROUP_LABEL[v.group])}: <b>${v.sets}</b> ${t(lang, "volume_sets")} (MEV ${v.mev} · MAV ${v.mav})`;
  const condLine =
    `${VOL_ZONE_EMOJI[cond.zone]} ${t(lang, "volume_cardio")}: <b>${conditioningLoadLabel(lang, cond)}</b>` +
    (cond.untimedSets ? `\n${t(lang, "volume_cardio_untimed", { n: cond.untimedSets })}` : "");
  const body =
    `${t(lang, "volume_title")}\n\n${vols.map(fmt).join("\n")}\n\n${condLine}\n\n` +
    `${t(lang, "volume_legend")}\n${t(lang, "volume_cardio_legend")}`;
  await reply(ctx, body, menuBtn(lang));
}

// Plate & warm-up calculator: ask for a working weight, then show the per-side plate breakdown
// and a percentage warm-up ramp.
export async function cmdPlates(ctx: MyContext) {
  await clearEditOwner(ctx);
  await setMode(ctx, "calc_weight");
  await reply(ctx, t(ctx.user.lang, "calc_prompt"));
}

export async function handleCalcWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const target = parseFloat(text.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(target) || target <= 0 || target > 600) { await reply(ctx, t(lang, "calc_invalid")); return; }
  await setMode(ctx, "idle");
  const plan = platePlan(target);
  const kg = t(lang, "unit_kg");
  let body: string;
  if (!plan) {
    body = t(lang, "calc_below_bar", { bar: 20 });
  } else {
    const perSide = plan.perSide.length ? plan.perSide.join(" + ") : "—";
    body = t(lang, "calc_plates", { target: Math.round(plan.loaded), perside: perSide });
    if (plan.leftover > 0) body += "\n" + t(lang, "calc_leftover", { kg: plan.leftover });
  }
  // Warm-up ramp toward the target.
  const ramp = warmupRamp(target);
  const rampLines = ramp.map((w) => `• ${w.weight}${kg} × ${w.reps}${w.pct ? ` (${w.pct}%)` : ""}`).join("\n");
  body += `\n\n${t(lang, "calc_warmup")}\n${rampLines}`;
  await reply(ctx, body, menuBtn(lang));
}

// Wellbeing trend — energy/sleep/stress from daily check-ins (chart + averages).
export async function cmdWellbeing(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const checkins = await dailyCheckinsSince(ctx.db, ctx.user._id, localCutoff(ctx.user.profile.timezone, 90));
  if (checkins.length < 2) { await reply(ctx, t(lang, "wellbeing_none"), menuBtn(lang)); return; }
  const cfg = wellbeingChart(lang, checkins);
  if (cfg) await sendChartPng(ctx, cfg);
  const avg = (sel: (c: (typeof checkins)[number]) => number) => (checkins.reduce((s, c) => s + sel(c), 0) / checkins.length).toFixed(1);
  await reply(
    ctx,
    t(lang, "wellbeing_summary", { n: checkins.length, energy: avg((c) => c.energy), sleep: avg((c) => c.sleep), stress: avg((c) => c.stress) }),
    menuBtn(lang),
  );
}

// AI suggestion for the macros remaining today (button on the nutrition screen).
export async function onMacrosSuggest(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date, weekday } = localParts(ctx.user.profile.timezone);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const trainingDays = ctx.user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as Weekday);
  const targets = (!isTraining && plan?.restDayNutrition) || ctx.user.nutrition;
  if (!targets) { await reply(ctx, t(lang, "nutrition_no_targets")); return; }
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const tot = meals.reduce((a, m) => ({ k: a.k + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }), { k: 0, p: 0, f: 0, c: 0 });
  const left = {
    kcal: Math.max(0, targets.calories - tot.k),
    protein: Math.max(0, targets.protein - tot.p),
    fats: Math.max(0, targets.fats - tot.f),
    carbs: Math.max(0, targets.carbs - tot.c),
  };
  if (left.kcal <= 50 && left.protein <= 5) { await reply(ctx, t(lang, "macros_done"), menuBtn(lang)); return; }
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "coach", async () => {
    const txt = await aiText(ctx.env, {
      system: P.macrosLeftSystem(lang, ctx.user.profile),
      user: JSON.stringify(left),
      temperature: 0.6,
      kind: "nutrition",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const header = t(lang, "macros_left", { kcal: left.kcal, p: left.protein, f: left.fats, c: left.carbs });
    await reply(ctx, `${header}\n\n${escapeHtml(cleanAi(txt))}`, menuBtn(lang));
  });
}

// POST a QuickChart config and upload the PNG (used by overview + per-exercise charts).
export async function sendChartPng(ctx: MyContext, chart: string) {
  try {
    const res = await fetch("https://quickchart.io/chart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chart, width: 720, height: 360, backgroundColor: "white", format: "png", version: "2" }),
    });
    if (!res.ok) {
      await recordError(ctx.db, { userId: ctx.user._id, kind: "chart", errorType: `http_${res.status}`, message: (await res.text()).slice(0, 180) }).catch(() => {});
      return;
    }
    await ctx.replyWithPhoto(new InputFile(new Uint8Array(await res.arrayBuffer()), "chart.png"));
  } catch (e) {
    await recordError(ctx.db, { userId: ctx.user._id, kind: "chart", errorType: "exception", message: String(e).slice(0, 180) }).catch(() => {});
  }
}

// Tracked lifts with ≥2 weighted sessions — the ones that can form a per-exercise trend line.
export async function chartableLifts(ctx: MyContext) {
  return (await listStrength(ctx.db, ctx.user._id)).filter(
    (r) => r.metric !== "time" && r.metric !== "distance" && r.history.filter((h) => h.weight > 0).length >= 2,
  );
}

export async function showExerciseList(ctx: MyContext) {
  const lang = ctx.user.lang;
  const lifts = await chartableLifts(ctx);
  if (!lifts.length) { await reply(ctx, t(lang, "exchart_none"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  lifts.slice(0, 20).forEach((r, i) => kb.text(`📈 ${r.exercise}`.slice(0, 55), `exch:${i}`).row());
  await reply(ctx, t(lang, "exchart_pick"), kb);
}

export async function onExerciseChart(ctx: MyContext, index: number) {
  const lift = (await chartableLifts(ctx))[index];
  if (!lift) { await showExerciseList(ctx); return; }
  const cfg = exerciseChart(ctx.user.lang, lift.exercise, lift.history);
  if (cfg) await sendChartPng(ctx, cfg);
  await reply(ctx, lift.exercise, menuBtn(ctx.user.lang));
}
