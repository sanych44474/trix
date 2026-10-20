// One row of milestones per account for the signup -> second workout funnel (domain/funnel.ts).
// "Started onboarding" has no state of its own: it is the funnel event (bot wizard or Mini App form)
// or a Mini App draft with an answer in it. Owner-banned accounts are left out; trainers are not
// (they train too).
import type { FunnelAccount } from "../../domain/funnel";
import { FUNNEL_STARTED } from "./v2Analytics";
import type { DB } from "./shared";

export async function funnelAccounts(db: DB): Promise<FunnelAccount[]> {
  const r = await db
    .prepare(
      `SELECT substr(a.createdAt, 1, 10) AS signupDate,
         (EXISTS (SELECT 1 FROM v2_analytics_events e WHERE e.accountId = a.id AND e.event = ?)
           OR EXISTS (SELECT 1 FROM v2_onboarding_drafts d WHERE d.accountId = a.id AND d.answered > 0)) AS started,
         EXISTS (SELECT 1 FROM v2_onboarding o WHERE o.accountId = a.id AND o.status = 'completed') AS onboarded,
         EXISTS (SELECT 1 FROM v2_plans p WHERE p.accountId = a.id AND p.status != 'draft') AS planned,
         (SELECT MIN(w.date) FROM v2_workout_sessions w WHERE w.accountId = a.id AND w.completed = 1) AS firstWorkout,
         (SELECT w.date FROM v2_workout_sessions w WHERE w.accountId = a.id AND w.completed = 1
           ORDER BY w.date LIMIT 1 OFFSET 1) AS secondWorkout
       FROM v2_accounts a
       WHERE a.blocked = 0`,
    )
    .bind(FUNNEL_STARTED)
    .all<{ signupDate: string; started: number; onboarded: number; planned: number; firstWorkout: string | null; secondWorkout: string | null }>();
  return (r.results ?? []).map((x) => ({
    signupDate: x.signupDate,
    started: Boolean(x.started),
    onboarded: Boolean(x.onboarded),
    planned: Boolean(x.planned),
    firstWorkout: x.firstWorkout ?? null,
    secondWorkout: x.secondWorkout ?? null,
  }));
}
