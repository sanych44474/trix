// GET /api/v2/training-signals: the Clef advisory signals for one user. The result is cached per
// user per UTC day in v2_settings (key-value, no migration), so the Progress and Today screens cost
// at most one Clef call per user per day. A failed or unavailable Clef gives empty signals, and that
// empty result is cached for the day too.
import { clefAsk } from "../ai/clef";
import { getSetting, setSetting } from "../adapters/d1/v2Admin";
import { dailyCheckinsSince } from "../adapters/d1/v2Tracking";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { shouldDeload } from "../domain/deload";
import { buildSignalState, readSignals, type TrainingSignals } from "../domain/trainingSignals";
import type { Env } from "../types";

export interface TrainingSignalsPayload extends TrainingSignals {
  computedAt: string;
}

const DAY = 86_400_000;
const LOOKBACK_DAYS = 42;

const cacheKey = (userId: number) => `training_signals:${userId}`;

async function cached(db: Env["DB"], userId: number, today: string): Promise<TrainingSignalsPayload | null> {
  const raw = await getSetting(db, cacheKey(userId));
  if (!raw) return null;
  const entry = JSON.parse(raw) as { day: string; payload: TrainingSignalsPayload };
  return entry.day === today ? entry.payload : null;
}

export async function loadTrainingSignals(env: Env, userId: number, now: Date = new Date()): Promise<TrainingSignalsPayload> {
  const db = env.DB;
  const today = now.toISOString().slice(0, 10);
  const hit = await cached(db, userId, today);
  if (hit) return hit;

  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString().slice(0, 10);
  const [logs, checkins, plan] = await Promise.all([
    workoutLogsSince(db, userId, since),
    dailyCheckinsSince(db, userId, since),
    getActivePlan(db, userId),
  ]);
  const signals = buildSignalState({ logs, checkins, today, calendarDeload: plan ? shouldDeload(plan, today) : false });
  const answers = Object.keys(signals.questions).length ? await clefAsk(env, signals.state, signals.questions) : null;

  const payload: TrainingSignalsPayload = { ...readSignals(answers, signals), computedAt: now.toISOString() };
  await setSetting(db, cacheKey(userId), JSON.stringify({ day: today, payload }));
  return payload;
}
