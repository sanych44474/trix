// Advisory training signals for Progress and Today: a per-lift progression status and a "lighter
// week" hint. The questions go to the Clef decision model (src/ai/clef.ts) by the feature layer;
// this file only builds the state and the questions, and reads the answers back. Nothing here
// changes the plan: the deterministic rules (progression.ts, deload.ts, plateau.ts) stay the source
// of truth, and these numbers only decide whether a hint is shown.
import type { DailyCheckinDoc, WorkoutLogDoc } from "../types";

const DAY = 86_400_000;
const LIFT_WINDOW_DAYS = 42;
const LIFT_MIN_SESSIONS = 3;
const LIFT_SESSIONS_KEPT = 6;
const MAX_LIFTS = 12;
const DELOAD_WINDOW_DAYS = 21;
const DELOAD_MIN_SESSIONS = 3;

export const SIGNAL_MIN_CONFIDENCE = 0.6;
export const DELOAD_MIN_PROBABILITY = 0.7;

export type LiftStatus = "progressing" | "stalled" | "regressing";
const LIFT_STATUSES: readonly LiftStatus[] = ["progressing", "stalled", "regressing"];

/** Structurally the same as the Clef question type in src/ai/clef.ts (domain may not import ai/). */
export type SignalQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

/** The subset of a Clef answer this module reads. */
export type SignalAnswers = Record<string, { type: string; choice?: string; confidence?: number; noul?: number }> | null;

export interface TrainingSignals {
  exercises: Array<{ name: string; status: LiftStatus; confidence: number }>;
  deload: { probability: number; suggested: boolean } | null;
}

export interface SignalPlan {
  state: unknown;
  questions: Record<string, SignalQuestion>;
  lifts: Array<{ id: string; name: string }>;
  hasDeloadQuestion: boolean;
}

interface SessionPoint {
  date: string;
  top: number; // heaviest working weight (kg)
  reps: number; // reps done at that weight
  rpe?: number; // highest logged RPE in the session
}

const ageDays = (today: string, date: string) => (Date.parse(today) - Date.parse(date)) / DAY;

const usableSets = (ex: WorkoutLogDoc["exercises"][number]) =>
  ex.skipped ? [] : ex.setsDone.filter((s) => s.weight > 0 && s.reps > 0 && !s.seconds && !s.meters);

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function liftSession(ex: WorkoutLogDoc["exercises"][number], date: string): SessionPoint | null {
  const sets = usableSets(ex);
  if (!sets.length) return null;
  const top = Math.max(...sets.map((s) => s.weight));
  const atTop = sets.filter((s) => s.weight === top);
  const rpes = sets.map((s) => s.rpe).filter((r): r is number => typeof r === "number");
  const point: SessionPoint = { date, top, reps: atTop.reduce((a, s) => a + s.reps, 0) };
  if (rpes.length) point.rpe = Math.max(...rpes);
  return point;
}

function liftsOf(logs: WorkoutLogDoc[], today: string): Array<{ name: string; sessions: SessionPoint[] }> {
  const byName = new Map<string, SessionPoint[]>();
  for (const log of logs) {
    if (!log.completed) continue;
    const age = ageDays(today, log.date);
    if (age < 0 || age > LIFT_WINDOW_DAYS) continue;
    const seen = new Set<string>();
    for (const ex of log.exercises) {
      if (seen.has(ex.name)) continue;
      seen.add(ex.name);
      const point = liftSession(ex, log.date);
      if (!point) continue;
      byName.set(ex.name, [...(byName.get(ex.name) ?? []), point]);
    }
  }
  return [...byName.entries()]
    .filter(([, sessions]) => sessions.length >= LIFT_MIN_SESSIONS)
    .map(([name, sessions]) => ({ name, sessions: sessions.sort((a, b) => a.date.localeCompare(b.date)) }))
    // Most-trained first; ties go to the lift trained most recently, then by name.
    .sort((a, b) => b.sessions.length - a.sessions.length
      || b.sessions[b.sessions.length - 1].date.localeCompare(a.sessions[a.sessions.length - 1].date)
      || a.name.localeCompare(b.name))
    .slice(0, MAX_LIFTS);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Three weeks, newest first: sessions, working sets, volume, RPE, and the average rep drop-off
 * within an exercise (first set vs last set, 0 = no drop). */
function weeklyState(logs: WorkoutLogDoc[], today: string) {
  const weeks = [0, 1, 2].map(() => ({ sessions: 0, sets: 0, volume: 0, rpes: [] as number[], drops: [] as number[] }));
  for (const log of logs) {
    if (!log.completed) continue;
    const age = ageDays(today, log.date);
    if (age < 0 || age >= DELOAD_WINDOW_DAYS) continue;
    const w = weeks[Math.floor(age / 7)];
    w.sessions += 1;
    for (const ex of log.exercises) {
      const sets = usableSets(ex);
      if (!sets.length) continue;
      w.sets += sets.length;
      w.volume += sets.reduce((a, s) => a + s.weight * s.reps, 0);
      w.rpes.push(...sets.map((s) => s.rpe).filter((r): r is number => typeof r === "number"));
      if (sets.length >= 2) w.drops.push(1 - sets[sets.length - 1].reps / sets[0].reps);
    }
  }
  return weeks.map((w) => ({
    sessions: w.sessions,
    sets: w.sets,
    volume: w.volume,
    avgRpe: avg(w.rpes) === null ? null : round3(avg(w.rpes)!),
    repDrop: avg(w.drops) === null ? null : round3(avg(w.drops)!),
  }));
}

function checkinState(checkins: DailyCheckinDoc[], today: string) {
  const recent = checkins.filter((c) => {
    const age = ageDays(today, c.date);
    return age >= 0 && age < DELOAD_WINDOW_DAYS;
  });
  const pick = (f: (c: DailyCheckinDoc) => number) => {
    const v = avg(recent.map(f).filter((n) => n > 0));
    return v === null ? null : round3(v);
  };
  return { n: recent.length, energy: pick((c) => c.energy), sleep: pick((c) => c.sleep), stress: pick((c) => c.stress) };
}

const LIFT_QUESTION: SignalQuestion = {
  type: "choice",
  instructions:
    "state.lifts[id] is one lift's recent sessions, oldest first: date, top weight (kg), reps done at that weight, and RPE when logged. "
    + "Is this lift progressing, stalled, or regressing?",
  criteria: {
    progressing: "the top weight or the reps at it went up over these sessions",
    stalled: "neither the weight nor the reps moved meaningfully",
    regressing: "the top weight or the reps at it went down, or RPE climbed at the same load",
  },
};

const DELOAD_QUESTION: SignalQuestion = {
  type: "noul",
  instructions:
    "state.deload: the last three weeks of training (weeks[0] is the most recent) and recent check-ins (energy, sleep, stress, 1-5). "
    + "Does this athlete need a lighter week now? Answer yes only when performance is falling or effort is rising at the same loads, "
    + "reps are dropping off within sessions, or recovery signals are poor.",
};

/** The Clef state and questions for one user today. Lifts come first (lift_0, lift_1, ...); the
 * deload question (id "deload") is left out when the calendar deload is already active, or when
 * there are fewer than three completed sessions in the last three weeks. */
export function buildSignalState(input: { logs: WorkoutLogDoc[]; checkins: DailyCheckinDoc[]; today: string; calendarDeload: boolean }): SignalPlan {
  const lifts = liftsOf(input.logs, input.today);
  const liftRefs = lifts.map((l, i) => ({ id: `lift_${i}`, name: l.name }));
  const completedRecently = input.logs.filter((l) => {
    const age = ageDays(input.today, l.date);
    return l.completed && age >= 0 && age < DELOAD_WINDOW_DAYS;
  }).length;
  const hasDeloadQuestion = !input.calendarDeload && completedRecently >= DELOAD_MIN_SESSIONS;

  const questions: Record<string, SignalQuestion> = {};
  liftRefs.forEach((ref) => {
    questions[ref.id] = LIFT_QUESTION;
  });
  if (hasDeloadQuestion) questions.deload = DELOAD_QUESTION;

  return {
    state: {
      lifts: lifts.map((l, i) => ({ id: `lift_${i}`, name: l.name, sessions: l.sessions.slice(-LIFT_SESSIONS_KEPT) })),
      deload: {
        weeks: weeklyState(input.logs, input.today),
        checkins: checkinState(input.checkins, input.today),
        calendarDeloadActive: input.calendarDeload,
      },
    },
    questions,
    lifts: liftRefs,
    hasDeloadQuestion,
  };
}

/** The advisory signals from Clef answers. Low-confidence lift answers and unknown choices are
 * dropped; the deload hint is `suggested` only at DELOAD_MIN_PROBABILITY. null answers give nothing. */
export function readSignals(answers: SignalAnswers, plan: SignalPlan): TrainingSignals {
  const exercises: TrainingSignals["exercises"] = [];
  for (const lift of plan.lifts) {
    const a = answers?.[lift.id];
    if (a?.type !== "choice" || typeof a.choice !== "string" || typeof a.confidence !== "number") continue;
    if (!(LIFT_STATUSES as readonly string[]).includes(a.choice)) continue;
    if (a.confidence < SIGNAL_MIN_CONFIDENCE) continue;
    exercises.push({ name: lift.name, status: a.choice as LiftStatus, confidence: a.confidence });
  }
  const d = answers?.deload;
  const deload = plan.hasDeloadQuestion && d?.type === "noul" && typeof d.noul === "number"
    ? { probability: d.noul, suggested: d.noul >= DELOAD_MIN_PROBABILITY }
    : null;
  return { exercises, deload };
}
