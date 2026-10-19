// Plateau analysis from the full workout logs, not from one best set per session.
//
// The old check compared only the single best set of each session, so a
// lift that gained a set, more reps across sets or more total volume at the same top weight read as
// "stuck for weeks" -- a machine accessory moved up by reps looked identical to one that never
// moved. Here a lift counts as stalled only when NOTHING moved over ~6 weeks: not the top weight,
// not the estimated 1RM, not the reps done at the top weight, not the session volume, and not the
// trend inside the recent weeks. Each finding carries the numbers behind it and a concrete next
// step, so the message can say what was seen and what to try instead of a bare verdict.
import { e1rm } from "./records";
import type { PlanDoc, WorkoutLogDoc } from "../types";

const DAY = 86_400_000;
const WINDOW_DAYS = 42;
const RECENT_DAYS = 21;

interface Session {
  age: number;
  top: number; // heaviest working weight
  repsAtTop: number; // reps summed over the sets done at that weight
  setsAtTop: number;
  bestReps: number; // most reps in one set at the top weight
  e1: number;
  volume: number; // Σ weight × reps
}

export type PlateauKind = "flat" | "regress";

export interface PlateauFinding {
  exercise: string;
  kind: PlateauKind;
  weeks: number; // span of the analysed sessions
  sessions: number;
  weight: number; // the recent top weight
  reps: number; // best set at that weight
  sets: number;
  priorWeight: number;
  priorReps: number;
  /** The suggested next step. */
  advice:
    | { kind: "add_weight"; weight: number; reps: number } // top of the rep range reached: load up, restart low
    | { kind: "add_reps"; weight: number; target: number; sets: number } // keep the weight, earn the reps
    | { kind: "deload"; weight: number }; // performance is falling: one lighter week, then back
}

function sessionOf(ex: WorkoutLogDoc["exercises"][number], age: number): Session | null {
  if (ex.skipped) return null;
  const sets = ex.setsDone.filter((s) => s.weight > 0 && s.reps > 0 && !s.seconds && !s.meters);
  if (!sets.length) return null;
  const top = Math.max(...sets.map((s) => s.weight));
  const atTop = sets.filter((s) => s.weight === top);
  return {
    age,
    top,
    repsAtTop: atTop.reduce((a, s) => a + s.reps, 0),
    setsAtTop: atTop.length,
    bestReps: Math.max(...atTop.map((s) => s.reps)),
    e1: Math.max(...sets.map((s) => e1rm(s.weight, s.reps))),
    volume: sets.reduce((a, s) => a + s.weight * s.reps, 0),
  };
}

/** "4 × 8–12" → [8, 12]; "3×10" → [10, 10]; anything else → null. */
export function repRange(sets: string | undefined): [number, number] | null {
  const m = /[×x*]\s*(\d+)(?:\s*[–\-—]\s*(\d+))?/i.exec(sets ?? "");
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return lo > 0 && hi >= lo ? [lo, hi] : null;
}

/** Smallest sensible load step: 2.5 kg on heavier lifts, 1 kg on light dumbbells/machines. */
const step = (w: number) => (w >= 20 ? 2.5 : 1);
const round = (w: number) => Math.round(w * 2) / 2;

function planRange(plan: PlanDoc | null | undefined, name: string): [number, number] | null {
  const lower = name.toLowerCase();
  for (const day of plan?.split ?? []) {
    for (const ex of day.exercises ?? []) {
      if (ex.name.toLowerCase() === lower || ex.canonicalName?.toLowerCase() === lower) return repRange(ex.sets);
    }
  }
  return null;
}

/**
 * Weighted lifts with no progress on any axis over the last 6 weeks (≥4 sessions, ≥2 of them in
 * the last 3 weeks, the first and last ≥3 weeks apart). Sorted with falling performance first.
 */
export function plateauReport(logs: WorkoutLogDoc[], today: string, plan?: PlanDoc | null): PlateauFinding[] {
  const now = Date.parse(today);
  if (Number.isNaN(now)) return [];
  const byName = new Map<string, Session[]>();
  for (const log of logs) {
    if (!log.completed) continue;
    const age = (now - Date.parse(log.date)) / DAY;
    if (age < 0 || age > WINDOW_DAYS) continue;
    for (const ex of log.exercises) {
      const s = sessionOf(ex, age);
      if (!s) continue;
      const list = byName.get(ex.name) ?? [];
      list.push(s);
      byName.set(ex.name, list);
    }
  }

  const out: PlateauFinding[] = [];
  for (const [exercise, all] of byName) {
    const sessions = [...all].sort((a, b) => b.age - a.age); // oldest first
    if (sessions.length < 4) continue;
    const span = sessions[0].age - sessions[sessions.length - 1].age;
    if (span < RECENT_DAYS) continue; // "for weeks" needs weeks of data
    const recent = sessions.filter((s) => s.age <= RECENT_DAYS);
    const prior = sessions.filter((s) => s.age > RECENT_DAYS);
    if (recent.length < 2 || !prior.length) continue;

    const max = (a: Session[], f: (s: Session) => number) => Math.max(...a.map(f));
    const priorTop = max(prior, (s) => s.top);
    const recentTop = max(recent, (s) => s.top);
    const atTop = (a: Session[], w: number) => a.filter((s) => s.top === w);
    const moved =
      recentTop > priorTop
      || max(recent, (s) => s.e1) > max(prior, (s) => s.e1) * 1.01
      || max(recent, (s) => s.volume) > max(prior, (s) => s.volume) * 1.05
      // same top weight, more reps or more sets at it
      || (recentTop === priorTop && atTop(recent, recentTop).length > 0 && atTop(prior, priorTop).length > 0
        && max(atTop(recent, recentTop), (s) => s.repsAtTop) > max(atTop(prior, priorTop), (s) => s.repsAtTop))
      // still climbing inside the recent weeks
      || recent[recent.length - 1].e1 > recent[0].e1 * 1.01
      || recent[recent.length - 1].repsAtTop > recent[0].repsAtTop && recent[recent.length - 1].top >= recent[0].top;
    if (moved) continue;

    const last = recent[recent.length - 1];
    const bestPrior = prior.reduce((a, s) => (s.e1 > a.e1 ? s : a));
    const regress = max(recent, (s) => s.e1) < bestPrior.e1 * 0.95;
    const range = planRange(plan, exercise) ?? [8, 12];
    const advice: PlateauFinding["advice"] = regress
      ? { kind: "deload", weight: round(last.top * 0.9) }
      : last.bestReps >= range[1]
        ? { kind: "add_weight", weight: round(last.top + step(last.top)), reps: range[0] }
        : { kind: "add_reps", weight: last.top, target: range[1], sets: Math.max(last.setsAtTop, 1) };
    out.push({
      exercise,
      kind: regress ? "regress" : "flat",
      weeks: Math.max(3, Math.round(span / 7)),
      sessions: sessions.length,
      weight: last.top,
      reps: last.bestReps,
      sets: last.setsAtTop,
      priorWeight: bestPrior.top,
      priorReps: bestPrior.bestReps,
      advice,
    });
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.weeks - a.weeks : a.kind === "regress" ? -1 : 1));
}
