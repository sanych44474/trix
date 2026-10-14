// The athlete context the AI coach is grounded in (plan, recent logs, today's check-in), shared by the bot's coach and the Mini App's. Moved from bot/coach.ts.
import type { UserDoc } from "../../types";
import { getRecentContext } from "../../adapters/d1/v2Analytics";
import { getActivePlan } from "../../adapters/d1/v2Plans";
import { recentAdjustments } from "../../adapters/d1/v2PlanHistory";
import { computeCyclePhase, phaseHint, phaseLabel } from "../../domain/cycle";
import { phaseGuidance, trainingWeek } from "../../domain/mesocycle";
import { bestSetForMetric, formatSetEntry, metricOfSets } from "../../domain/setFormat";
import { localParts, localCutoff } from "../../domain/localTime";
import { planNextTargets } from "../../domain/progression";
import { readinessAdvice } from "../../domain/deload";
import { getDailyCheckin } from "../../adapters/d1/v2Tracking";
import { CONDITIONING_LANDMARK, conditioningWeek } from "../../domain/conditioning";
import { recentCoachingReasons } from "../../domain/coachMemory";
import { weekdayName } from "../../render";

// `owner` is whose plan/history the coach reasons about — the operator themselves when
// self-coaching, or the managed client when a trainer is editing that client's plan (see
// handleCoach, which resolves it via planOwnerId). Everything here reads from `owner`, not
// `ctx.user`, so a trainer coaching a client gets THAT client's data, not their own.
export async function coachContext(ctx: { db: D1Database }, owner: UserDoc): Promise<string> {
  // Plan and recent logs are independent reads — fetch them together.
  const { date } = localParts(owner.profile.timezone);
  const [plan, recent, checkin] = await Promise.all([
    getActivePlan(ctx.db, owner._id),
    // Last 14 days of real logs so the coach grounds advice in actual numbers (not generic tips).
    getRecentContext(ctx.db, owner._id, 14),
    getDailyCheckin(ctx.db, owner._id, date).catch(() => null),
  ]);
  // Full plan with ISO weekday + 0-based exercise indices, so the coach can target any exercise.
  const planText = plan?.split.length
    ? plan.split
        .map(
          (d) =>
            `${weekdayName("en", d.weekday)}(${d.weekday}): ` +
            d.exercises.map((e, i) => `${i}:${e.name} ${e.sets} ${e.startWeight}`).join(" | "),
        )
        .join("\n")
    : "no active plan";
  const { workouts, nutrition } = recent;
  const workoutText = workouts.length
    ? workouts
        .map((w) => {
          const lifts = w.exercises
            .filter((e) => !e.skipped && e.setsDone.length)
            .map((e) => {
              // Cardio has no top *weight* — reduced by weight it printed as "Rowing BW×0", which
              // told the coach nothing. Render each exercise on the axis it was actually logged on.
              const metric = metricOfSets(e.setsDone);
              if (metric !== "reps") {
                const best = bestSetForMetric(e.setsDone, metric) ?? e.setsDone[0];
                return `${e.name} ${formatSetEntry(best)}${e.rpe ? `@${e.rpe}` : ""}`;
              }
              const top = e.setsDone.reduce((a, b) => (b.weight >= a.weight ? b : a), e.setsDone[0]);
              return `${e.name} ${top.weight || "BW"}×${top.reps}${e.rpe ? `@${e.rpe}` : ""}`;
            })
            .join(", ");
          return `${w.date}(${w.completed ? "done" : "skip"}${lifts ? `: ${lifts}` : ""})`;
        })
        .join(" | ")
    : "none";
  const nutDays = nutrition.length;
  const avgKcal = nutDays
    ? Math.round(
        nutrition.reduce((s, n) => s + n.meals.reduce((m, x) => m + (x.kcal || 0), 0), 0) / nutDays,
      )
    : 0;
  const target = owner.nutrition ? `${owner.nutrition.calories}kcal` : "n/a";
  const injuries = owner.profile.limitations?.trim();
  // Cycle-phase awareness (opt-in only). Injected as a compact English hint so the coach can
  // adjust load / carbs advice around the phase without needing a separate prompt.
  const cy = computeCyclePhase(owner.profile, date);
  const cycleLine = cy ? `Cycle phase: ${phaseLabel(cy.phase)} (day ${cy.day}/${cy.cycleLength}) — ${phaseHint(cy.phase)}.\n` : "";
  // Same block-periodization state the scheduler advances weekly (domain/mesocycle.ts) — lets
  // the coach explain "why is my plan built this way" grounded in the actual phase driving it,
  // instead of guessing a rationale disconnected from what the plan generator actually did.
  // Conditioning load for the week — the coach used to see only barbell work and would happily
  // suggest "add a couple of runs" to someone already 5 sessions deep.
  const cond = conditioningWeek(workouts, localCutoff(owner.profile.timezone, 7));
  const condLine = `Conditioning last 7d: ${cond.sessions} session(s)${cond.minutes ? `, ~${cond.minutes} min` : ""}${cond.meters ? `, ${Math.round(cond.meters / 100) / 10} km` : ""} (zone: ${cond.zone}; aerobic baseline ${CONDITIONING_LANDMARK.targetMin} min/wk, high ${CONDITIONING_LANDMARK.highMin} min/wk).\n`;
  const meso = plan?.mesocycle;
  const mesoLine = meso
    ? `Mesocycle: ${meso.phase} phase, week ${meso.weekInBlock}/${meso.blockLength} (target ${phaseGuidance(meso.phase).reps} reps @ ${phaseGuidance(meso.phase).intensity}).\n`
    : "";
  // What the app itself has already decided — the coach quotes these instead of re-deriving
  // (and contradicting) them: the progression engine's next targets, a planned deload week,
  // today's readiness from the check-in.
  const targets = plan ? planNextTargets(plan, recent.workouts) : [];
  const targetsLine = targets.length ? `Next targets (the app's progression engine — quote these, don't compute different numbers):\n${targets.join("\n")}\n` : "";
  const deloadLine = plan && trainingWeek(plan, date).deload ? "This week is a planned DELOAD week: ~40% fewer sets, light loads, RPE ≤ 7 — don't push intensity.\n" : "";
  const readiness = readinessAdvice(checkin);
  const readinessLine = readiness !== "ok" ? `Today's check-in readiness: ${readiness === "light" ? "LOW — go ~15% lighter or drop a set today" : "reduced — ~10% lighter today"}.\n` : "";
  // Long-term memory: the recent, deduplicated "why" behind past plan adjustments (see
  // domain/coachMemory.ts) -- lets the coach say "still building back up after that light week"
  // instead of re-deriving a rationale from scratch on every question, or contradicting a
  // decision it already made. Capped and deduplicated on purpose: a full adjustment history
  // dump would bury the actually-relevant recent reasons in noise.
  const pastReasons = recentCoachingReasons(await recentAdjustments(ctx.db, owner._id, 5).catch(() => []));
  const memoryLine = pastReasons.length ? `Recent coaching decisions: ${pastReasons.join("; ")}.\n` : "";
  return (
    `PLAN (weekday in parens, exercise index before colon):\n${planText}\n` +
    `Nutrition target: ${target}. Last 14d nutrition: ${nutDays} day(s) logged${nutDays ? `, avg ${avgKcal}kcal` : ""}.\n` +
    `Last 14d workouts (top set per lift): ${workoutText}.\n` +
    `${injuries ? `Injuries/limitations: ${injuries}.\n` : ""}` +
    cycleLine +
    condLine +
    mesoLine +
    deloadLine +
    readinessLine +
    targetsLine +
    memoryLine +
    `Training pace: ${owner.progressionRate ?? "normal"}. Today: ${date}.`
  );
}
