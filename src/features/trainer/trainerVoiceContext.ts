// What the AI sees when a trainer gives a voice command about a client (ADR-0018): the client's plan
// with indices, the last 14 days of training and the progression engine's next targets. Deliberately
// narrower than the coach's own context (features/coach/coachContext.ts): cycle phase, nutrition and
// the daily check-in are the client's to share, and the model's reply goes to the trainer. Health
// limitations are included only when the client shares health data with their trainer.
import type { PlanDoc, UserDoc, WorkoutLogDoc } from "../../types";
import { getActivePlan } from "../../adapters/d1/v2Plans";
import { getRecentContext } from "../../adapters/d1/v2Analytics";
import { planNextTargets } from "../../domain/progression";
import { trainerCanSee } from "../../domain/clientCard";
import { planListing, workoutsLine } from "../coach/coachContext";

export interface TrainerVoiceContext {
  plan: PlanDoc | null;
  workouts: WorkoutLogDoc[];
  /** Names an exercise can be matched to: the plan's, then the recently logged ones. */
  candidates: string[];
  text: string;
}

export async function trainerVoiceContext(db: D1Database, client: UserDoc): Promise<TrainerVoiceContext> {
  const [plan, recent] = await Promise.all([
    getActivePlan(db, client._id).catch(() => null),
    getRecentContext(db, client._id, 14).catch(() => ({ workouts: [] as WorkoutLogDoc[], nutrition: [] })),
  ]);
  const workouts = recent.workouts;
  const candidates = [
    ...new Set([...(plan?.split ?? []).flatMap((d) => d.exercises.map((e) => e.name)), ...workouts.flatMap((w) => w.exercises.map((e) => e.name))]),
  ];
  const targets = plan ? planNextTargets(plan, workouts, 10, client.profile.progression) : [];
  const limitations = trainerCanSee(client.profile, "health") ? client.profile.limitations?.trim() : undefined;
  const text =
    `PLAN (weekday in parens, exercise index before colon):\n${planListing(plan)}\n` +
    `Last 14d workouts (top set per lift): ${workoutsLine(workouts)}.\n` +
    (limitations ? `Injuries/limitations: ${limitations}.\n` : "") +
    (targets.length ? `Next targets (the app's progression engine):\n${targets.join("\n")}\n` : "");
  return { plan, workouts, candidates, text };
}
