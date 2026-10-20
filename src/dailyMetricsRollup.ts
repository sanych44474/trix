// Populates v2_daily_metrics for one past day (roadmap item 4 / docs/slos.md). Called once per
// day from scheduler.ts's runGlobalJobs, for "yesterday" — the last day guaranteed complete, so
// the numbers never change once written (unlike "today", which is still accumulating).
//
// ai_est_cost_usd is deliberately NOT computed: docs/slos.md flags the per-provider/model price
// table as an open Phase-2+ item, and provider-attempt logs don't split input/output tokens yet —
// there's no honest number to write. Add it once that data exists rather than guessing a price.
//
// Retention is deliberately NOT written here: retention_d1/d7/d30 had no reader, while the number
// the owner actually sees is the cohort retention (domain/cohorts.ts cohortRetention, fed by
// adapters/d1/v2Analytics.ts). Two definitions of one metric is how they drift; that one is the source.
import { aiAndErrorStatsBetween } from "./adapters/d1/v2AiTelemetry";
import { upsertDailyMetrics } from "./adapters/d1/v2DailyMetrics";
import { countCompletedWorkoutsBetween, allWorkoutLogsSince } from "./adapters/d1/v2Workouts";
import { countActivePlans, listActivePlans } from "./adapters/d1/v2Plans";
import { countSessionAccountsBetween } from "./adapters/d1/v2Analytics";
import { countCreatedBetween, countOnboarded } from "./adapters/d1/v2Users";
import { isoDateMinus } from "./features/gamification/boards";
import { isoWeekday } from "./domain/atrisk";

function dayBoundsIso(date: string): { start: string; endExclusive: string } {
  return { start: `${date}T00:00:00.000Z`, endExclusive: `${isoDateMinus(date, -1)}T00:00:00.000Z` };
}

/** Planned-weekday-elapsed-without-a-completed-row count for `date` (docs/slos.md §2/§3 — there
 * is no explicit "skip" event; a skip is only ever derived this way, matching report.ts's
 * existing done/skipped counting). */
async function skippedWorkouts(db: D1Database, date: string): Promise<number> {
  const weekday = isoWeekday(date);
  const [plans, logs] = await Promise.all([listActivePlans(db), allWorkoutLogsSince(db, date)]);
  const completedUserIds = new Set(logs.filter((l) => l.date === date && l.completed).map((l) => l.userId));
  let skipped = 0;
  for (const plan of plans) {
    const plannedToday = plan.split.some((d) => d.weekday === weekday);
    if (plannedToday && !completedUserIds.has(plan.userId)) skipped++;
  }
  return skipped;
}

export async function rollupDailyMetrics(db: D1Database, date: string): Promise<void> {
  const { start, endExclusive } = dayBoundsIso(date);
  const nextDay = isoDateMinus(date, -1);

  const [dau, wau, mau, newUsers, onboardedTotal, activePlans, completedWorkouts, skipped, aiTelemetry] = await Promise.all([
    // Distinct accounts with a session mark in the window (v2Presence). The mark is a per-day log, so
    // a person who was here yesterday still counts for yesterday after coming back today.
    countSessionAccountsBetween(db, date, nextDay),
    countSessionAccountsBetween(db, isoDateMinus(date, 6), nextDay),
    countSessionAccountsBetween(db, isoDateMinus(date, 29), nextDay),
    countCreatedBetween(db, start, endExclusive),
    countOnboarded(db), // cumulative snapshot at rollup time, not scoped to `date`
    countActivePlans(db), // same — no per-day history to backfill against
    countCompletedWorkoutsBetween(db, date, nextDay),
    skippedWorkouts(db, date),
    aiAndErrorStatsBetween(db, start, endExclusive),
  ]);

  const rows: { metric: string; value: number }[] = [
    { metric: "dau", value: dau },
    { metric: "wau", value: wau },
    { metric: "mau", value: mau },
    { metric: "new_users", value: newUsers },
    { metric: "onboarded_total", value: onboardedTotal },
    { metric: "active_plans", value: activePlans },
    { metric: "completed_workouts", value: completedWorkouts },
    { metric: "skipped_workouts", value: skipped },
    { metric: "ai_provider_attempts", value: aiTelemetry.providerAttempts },
    // This is the share of provider attempts after the first attempt, not the share of logical
    // requests that needed fallback. Zero attempts produce a zero share.
    { metric: "ai_fallback_attempt_share", value: aiTelemetry.providerAttempts ? aiTelemetry.fallbackAttempts / aiTelemetry.providerAttempts : 0 },
    // Error events include AI chain exhaustion and non-AI application errors; store a count rather
    // than dividing them by provider attempts and presenting the result as an error rate.
    { metric: "error_events", value: aiTelemetry.errorEvents },
  ];

  await upsertDailyMetrics(db, date, rows);
}
