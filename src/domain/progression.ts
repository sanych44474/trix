import type { DailyCheckinDoc, LoggedExercise, PlanDay, PlanDoc, PlanExercise, ProgressionRate, SetEntry, Weekday, WorkoutLogDoc } from "../types";
import { exerciseMetric, metricOfSets, bestSetForMetric } from "./setFormat";
import { tokens } from "./workoutText";
import { isLowerBody } from "./exerciseClass";
import { poorWellbeing } from "./deload";
export * from "./activity";
export * from "./levelGoals";
export * from "./deload";
export * from "./exerciseClass";
export type { MuscleGroup } from "./muscleRegions";
export * from "./workoutText";
export * from "./setFormat";
export * from "./localTime";

export function getPlanDay(plan: PlanDoc, weekday: Weekday): PlanDay | undefined {
  return plan.split.find((d) => d.weekday === weekday);
}

/** A catalog candidate as offered to the plan generator: stable id + canonical English name. */
export interface CatalogCandidate {
  id: string;
  name: string;
}

/** Validate the AI's catalog grounding for one exercise.
 *
 * The plan prompt requires the model to copy a candidate's English name verbatim into
 * BOTH "name" and "exerciseId"/"canonicalName". A persistent failure mode is the model
 * describing one movement correctly (name/technique/muscles all "lateral raise") but
 * linking it to an UNRELATED but valid id (e.g. a shrug). The id passes the
 * `candidateIds.has(id)` check, so the wrong video + wrong catalog info get attached.
 *
 * This re-anchors the grounding by name: if the chosen id's catalog name has weak token
 * overlap with the AI name, switch to the candidate that best matches the AI name; if
 * nothing matches well, drop the grounding entirely (ungrounded is safer than mislinked).
 * Returns the id+name to use, or undefined to leave the exercise ungrounded. */
export function reconcileGrounding(
  aiName: string,
  chosenId: string | undefined,
  candidates: CatalogCandidate[],
): CatalogCandidate | undefined {
  if (!chosenId) return undefined;
  const chosen = candidates.find((c) => c.id === chosenId);
  if (!chosen) return undefined; // hallucinated id — caller already drops these
  const nt = tokens(aiName);
  if (nt.size === 0) return chosen; // nothing to compare against — trust the id
  const score = (name: string): number => {
    const ct = tokens(name);
    if (ct.size === 0) return 0;
    let inter = 0;
    for (const w of nt) if (ct.has(w)) inter++;
    return inter / Math.min(nt.size, ct.size);
  };
  const chosenScore = score(chosen.name);
  if (chosenScore >= 0.5) return chosen; // name matches the linked id — grounding is fine
  // Mismatch: find the candidate whose name best matches the AI name.
  let best: CatalogCandidate | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    const s = score(c.name);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  // Re-anchor only on a confident, clearly-better match; otherwise drop the grounding.
  if (best && bestScore >= 0.6 && bestScore > chosenScore) return best;
  return undefined;
}

/** Suggest the next double-progression target for a lift — the same rules as the weekly plan
 * progression, so the records screen, the post-workout recap and the plan never disagree:
 * add a rep until the top of the plan's rep range (default 8–12), then add the load step for
 * this exercise (loadStep) and go back to the bottom of the range. RPE autoregulation: a maximal
 * last session (RPE ≥ 9.5) holds the target; clearly easy (RPE ≤ 7) takes a double step.
 * Bodyweight lifts just add reps. */
export function nextTarget(
  bestWeight: number,
  bestReps: number,
  exercise: string,
  lastRpe?: number,
  range?: { low: number; high: number },
): string {
  const n = nextTargetSet(bestWeight, bestReps, exercise, lastRpe, range);
  return `${n.weight > 0 ? fmtNum(n.weight) : "BW"} × ${n.reps}`;
}

export type TargetStep = "hold" | "reps" | "load";

/** nextTarget as numbers, plus which move it is (hold the load / add reps / add load). */
export function nextTargetSet(
  bestWeight: number,
  bestReps: number,
  exercise: string,
  lastRpe?: number,
  range?: { low: number; high: number },
): { weight: number; reps: number; step: TargetStep } {
  const low = range?.low ?? 8;
  const high = Math.max(low, range?.high ?? 12);
  if (typeof lastRpe === "number" && lastRpe >= GRIND_RPE) return { weight: bestWeight, reps: bestReps, step: "hold" };
  const easy = typeof lastRpe === "number" && lastRpe <= 7;
  if (!(bestWeight > 0)) return { weight: 0, reps: bestReps + (easy ? 2 : 1), step: "reps" };
  if (bestReps < high) return { weight: bestWeight, reps: Math.min(high, bestReps + (easy ? 2 : 1)), step: "reps" };
  return { weight: bestWeight + loadJump(exercise, bestWeight, easy), reps: low, step: "load" };
}

export interface NextTargetGuidance {
  name: string;
  target: string;
  /** RPE ≥ 9.5 on the logged set — nextTarget already holds the load for this reason internally
   * (see its own doc comment); this just gives the caller the "why" to display, since nextTarget
   * itself only returns the target string, not the reasoning. */
  overload: boolean;
}

/** Per-exercise "what to do next time" for the post-workout coach recap (roadmap item 6) —
 * wraps nextTarget (already RPE-autoregulated, previously surfaced only on the standalone
 * /records screen) with the selection logic a recap needs: skip non-weight metrics (time/
 * distance aren't tracked by nextTarget), skip anything with no completed sets, and cap the
 * list so the recap stays a short card, not a wall of text — PRs first (that's the exercise
 * someone just cares most about), then the rest in logged order. */
export function nextTargetGuidance(
  exercises: LoggedExercise[],
  prExerciseNames: string[],
  max = 3,
  plan?: PlanDoc | null,
): NextTargetGuidance[] {
  const prSet = new Set(prExerciseNames);
  const candidates = exercises.filter((e) => !e.skipped && e.setsDone.length && metricOfSets(e.setsDone) === "reps");
  const ordered = [...candidates].sort((a, b) => Number(prSet.has(b.name)) - Number(prSet.has(a.name)));
  return ordered.slice(0, max).map((e) => {
    const best = bestSetForMetric(e.setsDone, "reps")!;
    const overload = typeof e.rpe === "number" && e.rpe >= 9.5;
    return {
      name: e.name,
      target: nextTarget(best.weight, best.reps, e.name, e.rpe, plan ? planRepRange(plan, e.planName ?? e.name) : undefined),
      overload,
    };
  });
}

/** Training pace from recent logs: ratio of successful (non-grinding) sets over ~3 weeks.
 * A logged exercise counts as failed when its session RPE ≥ 9.5 or it was skipped; with no
 * RPE we give the benefit of the doubt. <50% → slow, >80% → fast, otherwise normal. */
export function evaluateProgressionRate(logs: WorkoutLogDoc[]): ProgressionRate {
  let total = 0;
  let ok = 0;
  for (const log of logs) {
    for (const ex of log.exercises) {
      const sets = ex.setsDone?.length ?? 0;
      if (sets === 0) continue;
      total += sets;
      const failed = ex.skipped || (typeof ex.rpe === "number" && ex.rpe >= 9.5);
      if (!failed) ok += sets;
    }
  }
  if (total === 0) return "normal";
  const ratio = ok / total;
  if (ratio < 0.5) return "slow";
  if (ratio > 0.8) return "fast";
  return "normal";
}

// ---------- weekly dynamic progression (silent, deterministic double progression) ----------

/** Parse a plan's startWeight string into kg + the original unit suffix, or flag bodyweight.
 * "50 kg" → {kg:50, suffix:" kg"}; "60" → {kg:60, suffix:""}; "Bodyweight"/"BW"/"власна" → bodyweight. */
function parsePlanWeight(s: string): { kg: number; bodyweight: boolean; suffix: string } {
  const lower = s.toLowerCase();
  // "pick a weight" (domain/startWeights.ts): loaded, just not chosen yet — the logged weight
  // becomes the plan weight, it must not fall into the bodyweight rep-progression branch.
  if (/підбер|подбер|pick a weight|choose a weight/.test(lower)) return { kg: 0, bodyweight: false, suffix: " kg" };
  if (/body|^bw\b|власн|собствен|свое/.test(lower)) return { kg: 0, bodyweight: true, suffix: "" };
  const m = /(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(s.trim());
  if (!m) return { kg: 0, bodyweight: true, suffix: "" };
  return { kg: parseFloat(m[1].replace(",", ".")), bodyweight: false, suffix: m[2] ? " " + m[2].trim() : "" };
}

/** Parse "4 × 8–10" / "3 x 8" / "4×8-12" → sets count + rep range (low==high for a fixed target). */
function parseRepRange(s: string): { setsCount: number; low: number; high: number } | undefined {
  const m = /(\d+)\s*[x×х*]\s*(\d+)\s*(?:[–\-—]\s*(\d+))?/i.exec(s);
  if (!m) return undefined;
  const setsCount = parseInt(m[1], 10);
  const low = parseInt(m[2], 10);
  return { setsCount, low, high: m[3] ? parseInt(m[3], 10) : low };
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The next load jump for an exercise at this weight: ~5% of the load, rounded to what the gym
 *  actually offers (1 kg dumbbells under 10 kg, 2 kg above; 2.5 kg plates/stacks otherwise) and
 *  never more than the classic +2.5 kg upper / +5 kg lower body. A flat +2.5 kg was +40% on a
 *  6 kg lateral raise. Pure; test/progression-math.test.ts. */
export function loadStep(exercise: string, kg: number): number {
  const cap = isLowerBody(exercise) ? 5 : 2.5;
  const dumbbell = /гантел|dumbbell|\bdb\b|kettlebell|гир[яі]/i.test(exercise);
  const inc = dumbbell ? (kg < 10 ? 1 : 2) : 2.5;
  return Math.min(cap, Math.max(inc, Math.round((kg * 0.05) / inc) * inc));
}

/** The load to add: one step, or two after a clearly easy session — but the double step only
 *  while it stays within 10% of the load. On light weights one step is already a big share
 *  (6 kg → 8 kg would be +33%), so there an easy session still gets a single step. */
export function loadJump(exercise: string, kg: number, easy: boolean): number {
  const step = loadStep(exercise, kg);
  return easy && step * 2 <= kg * 0.1 + 1e-9 ? step * 2 : step;
}

/** The plan's rep range for a logged exercise (matched by name or canonical name), if any. */
export function planRepRange(plan: PlanDoc, name: string): { low: number; high: number } | undefined {
  for (const d of plan.split) {
    for (const e of d.exercises) {
      if (exerciseTokensEqual(e.name, name) || (e.canonicalName && exerciseTokensEqual(e.canonicalName, name))) {
        const r = parseRepRange(e.sets);
        return r ? { low: r.low, high: r.high } : undefined;
      }
    }
  }
  return undefined;
}

/** One logged session of a rep-based exercise, read the way double progression needs it:
 *  the working weight is the heaviest load done for at least the bottom of the rep range (a
 *  one-off heavy triple doesn't count as "what you lift for 8–12"); `reps` is the WORST set at
 *  that weight, so "top of the range" means every working set got there, not just the first. */
export function workingSets(sets: SetEntry[], low = 1): { weight: number; reps: number; count: number } | undefined {
  const reps = sets.filter((x) => x.reps > 0);
  if (!reps.length) return undefined;
  const qualifying = reps.filter((x) => x.reps >= low);
  const weight = Math.max(...(qualifying.length ? qualifying : reps).map((x) => x.weight));
  const work = reps.filter((x) => Math.abs(x.weight - weight) < 1e-6);
  return { weight, reps: Math.min(...work.map((x) => x.reps)), count: work.length };
}

/** Bump a rep target by `inc` reps (top of a range, or the single fixed target). */
function bumpReps(range: { setsCount: number; low: number; high: number }, inc = 1): string {
  return range.low === range.high
    ? `${range.setsCount} × ${range.high + inc}`
    : `${range.setsCount} × ${range.low + inc}–${range.high + inc}`;
}

// ---------- time/distance plan specs (planks, cardio) ----------

interface MetricRange {
  setsCount: number;
  low: number; // in native units (seconds for time, meters for distance)
  high: number;
  unit: string; // unit literal as written in the plan ("s" / "сек" / "min" / "m" / "km" …)
  perUnit: number; // seconds-per-unit (60 for minutes) or meters-per-unit (1000 for km), else 1
}

/** Parse a time-based plan spec: "3 × 30-45s", "3 × 45 сек", "20 min" → seconds range. */
function parsePlanDuration(s: string): MetricRange | undefined {
  const m = /(?:(\d+)\s*[xх×*]\s*)?(\d+)(?:\s*[–\-—]\s*(\d+))?\s*(хвилин\w*|хв|минут\w*|мин|minutes?|mins?|min|секунд\w*|сек|seconds?|secs?|sec|s|с)/iu.exec(s);
  if (!m) return undefined;
  const isMin = /^(?:хв|мин|min|минут|хвилин)/i.test(m[4]);
  return {
    setsCount: m[1] ? parseInt(m[1], 10) : 1,
    low: parseInt(m[2], 10),
    high: m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10),
    unit: m[4],
    perUnit: isMin ? 60 : 1,
  };
}

/** Parse a distance-based plan spec: "1 × 2000m", "2000 м", "5 km" → meters range. */
function parsePlanDistance(s: string): MetricRange | undefined {
  const m = /(?:(\d+)\s*[xх×*]\s*)?(\d+(?:[.,]\d+)?)(?:\s*[–\-—]\s*(\d+(?:[.,]\d+)?))?\s*(km|км|m|м)/iu.exec(s);
  if (!m) return undefined;
  const isKm = /^(?:km|км)/i.test(m[4]);
  const num = (x: string) => parseFloat(x.replace(",", "."));
  return {
    setsCount: m[1] ? parseInt(m[1], 10) : 1,
    low: num(m[2]),
    high: m[3] ? num(m[3]) : num(m[2]),
    unit: m[4],
    perUnit: isKm ? 1000 : 1,
  };
}

function fmtMetricNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Re-emit a metric range, preserving its unit literal: "3 × 35-50s", "2200 m". */
function emitMetricRange(r: MetricRange, low: number, high: number): string {
  const glue = r.unit.length <= 1 ? "" : " ";
  const range = low === high ? `${fmtMetricNum(low)}` : `${fmtMetricNum(low)}–${fmtMetricNum(high)}`;
  const head = r.setsCount > 1 ? `${r.setsCount} × ` : "";
  return `${head}${range}${glue}${r.unit}`;
}

export function exerciseTokensEqual(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size) >= 0.6;
}

export interface ExerciseChange {
  weekday: Weekday;
  index: number; // index in that day's exercises
  exercise: string;
  field: "weight" | "reps";
  from: string;
  to: string;
  reason?: string; // plain-language "why" -- shown verbatim by /planchanges (bot/plan.ts)
}

export interface ProgressionResult {
  changes: ExerciseChange[];
  plateau: string[]; // exercises grinding without reaching the top of the range — held, not pushed
  maxedBodyweight: string[]; // bodyweight lifts that hit the rep cap → need a harder variation/load
  heldForWellbeing: boolean; // poor recent check-ins → all increases skipped this week
  heldForConditioning: boolean; // a very high cardio week → don't stack strength increases on top
  heldForDeload?: boolean; // a deload week, or the week right after one → its light logs say nothing
}

// A bodyweight lift this many reps deep is "too easy" — switch to a harder variation / add load
// instead of chasing ever-higher rep counts.
const BODYWEIGHT_REP_CAP = 20;

const MIN_SESSIONS = 2; // need this many recent logged sessions of an exercise before progressing
const GRIND_RPE = 9.5; // session at/above this felt maximal — hold, don't add load

/** Native-unit increment for a timed/cardio progression step (doubled on an "easy" week). */
function timedIncrement(metric: "time" | "distance", range: MetricRange, easy: boolean): number {
  const mul = easy ? 2 : 1;
  if (metric === "time") return (range.perUnit === 60 ? 1 : 5) * mul; // +1 min or +5 s
  if (range.perUnit === 1000) return 0.5 * mul; // +0.5 km
  return Math.max(50, Math.round((range.high * 0.1) / 50) * 50) * mul; // ~10% of distance, ≥50 m
}

/** Progress a time-based (plank, hold) or distance/duration (rowing, run) exercise: extend the
 * target once the last sessions reach the top of the planned range without grinding; otherwise
 * flag a plateau. Mirrors the double-progression guardrails on the seconds/meters axis. */
function progressTimedExercise(
  result: ProgressionResult,
  ex: PlanExercise,
  weekday: Weekday,
  index: number,
  metric: "time" | "distance",
  sessions: { date: string; seconds: number; meters: number; rpe?: number }[],
): void {
  const range = metric === "time" ? parsePlanDuration(ex.sets) : parsePlanDistance(ex.sets);
  if (!range) return;
  const value = (s: { seconds: number; meters: number }) => (metric === "time" ? s.seconds : s.meters);
  const topValue = range.high * range.perUnit; // seconds or meters
  const reachedTop = (s: { seconds: number; meters: number }) => value(s) >= topValue;
  const notMaxed = (s: { rpe?: number }) => typeof s.rpe !== "number" || s.rpe < GRIND_RPE;

  const recent = sessions.slice(0, MIN_SESSIONS);
  const ready = recent.length === MIN_SESSIONS && recent.every((s) => reachedTop(s) && notMaxed(s));
  if (ready) {
    const rpes = recent.map((s) => s.rpe).filter((r): r is number => typeof r === "number");
    const easy = rpes.length
      ? rpes.every((r) => r <= 7)
      : recent.every((s) => value(s) >= topValue + (metric === "time" ? 10 : 100));
    const inc = timedIncrement(metric, range, easy);
    const to = emitMetricRange(range, range.low + inc, range.high + inc);
    if (to !== ex.sets) result.changes.push({ weekday, index, exercise: ex.name, field: "reps", from: ex.sets, to });
    return;
  }
  // Plateau: 3+ recent sessions short of the target while grinding → hold.
  const last3 = sessions.slice(0, 3);
  if (
    last3.length >= 3 &&
    last3.every((s) => value(s) < topValue) &&
    last3.some((s) => typeof s.rpe === "number" && s.rpe >= GRIND_RPE)
  ) {
    result.plateau.push(ex.name);
  }
}

/** Decide the week's silent micro-progression for an active plan from recent training data.
 * Pure: returns the proposed changes; the caller clones+applies via {@link applyProgression}.
 *
 * Double progression with autoregulation guardrails:
 *  - need ≥2 completed sessions overall, else nothing to analyse;
 *  - poor wellbeing (low energy/sleep or high stress) holds ALL increases that week;
 *  - per exercise: progress only if the last 2 logged sessions both hit the top of the rep
 *    range at ≥ planned load and weren't maximal (RPE < 9.5). Bodyweight → +1 rep; loaded →
 *    +smallest plate. Grinding for 3+ sessions without reaching the top flags a plateau (hold). */
export function computePlanProgression(
  plan: PlanDoc,
  logs: WorkoutLogDoc[],
  checkins: DailyCheckinDoc[],
  opts: { conditioningOverload?: boolean; deloadHold?: boolean } = {},
): ProgressionResult {
  const result: ProgressionResult = {
    changes: [], plateau: [], maxedBodyweight: [], heldForWellbeing: false, heldForConditioning: false,
  };
  if (logs.filter((l) => l.completed).length < 2) return result;

  // A deload week's logs are deliberately light (fewer sets, ~60–70% loads): reading them as
  // "what you actually lift" would pull every plan weight down to the deload numbers.
  if (opts.deloadHold) {
    result.heldForDeload = true;
    return result;
  }
  if (poorWellbeing(checkins)) {
    result.heldForWellbeing = true;
    return result;
  }
  // Conditioning is training load too. Computed by the caller (domain/conditioning.ts, which
  // imports from this file) and passed in rather than imported here, to keep the dependency
  // one-way. A week deep past the aerobic high landmark is already a full recovery cost — adding
  // weight on top of it is how the "why am I not progressing anymore" spiral starts.
  if (opts.conditioningOverload) {
    result.heldForConditioning = true;
    return result;
  }

  for (const day of plan.split) {
    day.exercises.forEach((ex, index) => {
      const metric = exerciseMetric(ex);
      // Recent sessions where this exercise was actually trained (matched by name/canonical),
      // each reduced to its best set on the exercise's native axis.
      const range = parseRepRange(ex.sets);
      const sessions: { date: string; weight: number; reps: number; seconds: number; meters: number; rpe?: number; count: number; total: number }[] = [];
      for (const log of logs) {
        for (const le of log.exercises) {
          if (le.skipped || !le.setsDone?.length) continue;
          if (!exerciseTokensEqual(le.name, ex.name) && !(ex.canonicalName && exerciseTokensEqual(le.name, ex.canonicalName))) continue;
          if (metric === "reps") {
            const ws = workingSets(le.setsDone, range?.low ?? 1);
            if (ws) sessions.push({ date: log.date, weight: ws.weight, reps: ws.reps, seconds: 0, meters: 0, rpe: le.rpe, count: ws.count, total: le.setsDone.length });
          } else {
            const best = bestSetForMetric(le.setsDone, metric);
            if (best) sessions.push({ date: log.date, weight: best.weight, reps: best.reps, seconds: best.seconds ?? 0, meters: best.meters ?? 0, rpe: le.rpe, count: 1, total: 1 });
          }
          break;
        }
      }
      if (sessions.length < MIN_SESSIONS) return;
      sessions.sort((a, b) => (a.date < b.date ? 1 : -1)); // most recent first

      if (metric === "time" || metric === "distance") {
        progressTimedExercise(result, ex, day.weekday, index, metric, sessions);
        return;
      }

      const top = range?.high;
      const w = parsePlanWeight(ex.startWeight);

      // Every working set at the top of the range (reps is the worst one), and not fewer working
      // sets than planned less one — a session that dropped the weight after two sets didn't
      // "own" it yet. A single logged set is taken at face value (quick text logs).
      const enoughSets = (s: { count: number; total: number }) => s.total <= 1 || !range || s.count >= Math.max(1, range.setsCount - 1);
      const reachedTop = (s: { reps: number; count: number; total: number }) => (top === undefined || s.reps >= top) && enoughSets(s);
      const notMaxed = (s: { rpe?: number }) => typeof s.rpe !== "number" || s.rpe < GRIND_RPE;
      const recent = sessions.slice(0, MIN_SESSIONS);

      // ---- Bodyweight: rep-based double progression (unchanged) ----
      if (w.bodyweight) {
        const ready = recent.length === MIN_SESSIONS && recent.every((s) => reachedTop(s) && notMaxed(s));
        if (ready && range) {
          const rpes = recent.map((s) => s.rpe).filter((r): r is number => typeof r === "number");
          const easy = rpes.length ? rpes.every((r) => r <= 7) : top !== undefined && recent.every((s) => s.reps >= top + 2);
          if (range.high < BODYWEIGHT_REP_CAP) {
            const to = bumpReps(range, easy ? 2 : 1);
            if (to !== ex.sets) {
              const reason = easy
                ? "topped the rep range comfortably (RPE ≤ 7) two sessions running — added a bigger jump"
                : "hit the top of the rep range without maxing out — added a rep";
              result.changes.push({ weekday: day.weekday, index, exercise: ex.name, field: "reps", from: ex.sets, to, reason });
            }
          } else {
            result.maxedBodyweight.push(ex.name); // rep cap → needs a harder variation / load
          }
        } else {
          const last3 = sessions.slice(0, 3);
          if (top !== undefined && last3.length >= 3 && last3.every((s) => s.reps < top) && last3.some((s) => typeof s.rpe === "number" && s.rpe >= GRIND_RPE)) {
            result.plateau.push(ex.name);
          }
        }
        return;
      }

      // ---- Loaded: keep the plan's startWeight anchored to what the athlete ACTUALLY lifts ----
      // "Demonstrated" weight = the heaviest working weight across recent sessions. Using the max
      // (not the last set) ignores a one-off deload/pump day, and it means the plan can never
      // prescribe a weight the athlete hasn't shown — a bump the log later walked back (e.g. a
      // jump to 85 after one 80×8, then 80×6) is corrected back down to reality.
      const demonstrated = Math.max(...sessions.slice(0, 3).map((s) => s.weight));
      const step = loadStep(ex.name, demonstrated);
      if (demonstrated <= 0) return;

      // Progress ABOVE demonstrated only when the last MIN_SESSIONS both topped the rep range and
      // weren't maximal — then add one step (two on an easy week). Capped at demonstrated + 2 steps.
      const ready = recent.length === MIN_SESSIONS && recent.every((s) => reachedTop(s) && notMaxed(s));
      let target = demonstrated;
      if (ready) {
        const rpes = recent.map((s) => s.rpe).filter((r): r is number => typeof r === "number");
        const easy = rpes.length ? rpes.every((r) => r <= 7) : top !== undefined && recent.every((s) => s.reps >= top + 2);
        target = demonstrated + loadJump(ex.name, demonstrated, easy);
      }
      target = Math.min(target, demonstrated + step * 2);

      if (Math.abs(target - w.kg) >= 0.5) {
        const to = `${fmtNum(target)}${w.suffix || " kg"}`;
        if (to !== ex.startWeight) {
          const reason = ready
            ? (target - demonstrated) >= step * 2
              ? "topped the rep range comfortably (RPE ≤ 7) two sessions running — added a bigger jump"
              : "hit the top of the rep range without maxing out — added the smallest plate"
            : "the logged weight moved since the plan was last set — kept the plan matching what you actually lifted";
          result.changes.push({ weekday: day.weekday, index, exercise: ex.name, field: "weight", from: ex.startWeight, to, reason });
        }
      } else if (!ready && top !== undefined) {
        // Weight already matches reality but reps keep falling short while grinding → plateau
        // (the scheduler then offers a fresh same-muscle variation).
        const last3 = sessions.slice(0, 3);
        if (last3.length >= 3 && last3.every((s) => s.reps < top) && last3.some((s) => typeof s.rpe === "number" && s.rpe >= GRIND_RPE)) {
          result.plateau.push(ex.name);
        }
      }
    });
  }
  return result;
}

/** Apply progression changes to a deep-cloned plan (does not mutate the input). */
export function applyProgression(plan: PlanDoc, changes: ExerciseChange[]): PlanDoc {
  const split = plan.split.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) }));
  for (const c of changes) {
    const ex = split.find((d) => d.weekday === c.weekday)?.exercises[c.index];
    if (!ex || ex.name !== c.exercise) continue;
    if (c.field === "weight") ex.startWeight = c.to;
    else ex.sets = c.to;
  }
  return { ...plan, split };
}

// ---------- level-up & goal-reached transitions ----------

/** The progression engine's next targets for the plan's rep-based lifts, from recent logs —
 *  what the coach prompt quotes instead of doing its own arithmetic (bot/coach.ts). Newest
 *  session per exercise; at most `max` lines. Pure; test/progression-math.test.ts. */
export function planNextTargets(plan: PlanDoc, logs: WorkoutLogDoc[], max = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const newestFirst = [...logs].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const day of plan.split) {
    for (const ex of day.exercises) {
      if (out.length >= max || seen.has(ex.name) || exerciseMetric(ex) !== "reps") continue;
      seen.add(ex.name);
      const range = parseRepRange(ex.sets);
      for (const log of newestFirst) {
        const le = log.exercises.find((e) => !e.skipped && e.setsDone?.length && (exerciseTokensEqual(e.name, ex.name) || (!!ex.canonicalName && exerciseTokensEqual(e.name, ex.canonicalName))));
        if (!le) continue;
        const ws = workingSets(le.setsDone, range?.low ?? 1);
        if (ws) out.push(`${ex.name}: last ${ws.weight || "BW"}×${ws.reps}${le.rpe ? `@${le.rpe}` : ""} → next ${nextTarget(ws.weight, ws.reps, ex.name, le.rpe, range ? { low: range.low, high: range.high } : undefined)}`);
        break;
      }
    }
  }
  return out;
}
