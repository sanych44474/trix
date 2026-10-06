import { regionOf } from "./muscleRegions";
import { trainingWeek } from "./mesocycle";
import type { DailyCheckinDoc, LoggedExercise, PlanDay, PlanDoc, PlanExercise, ProgressionRate, SetEntry, StrengthRecordDoc, Weekday, WorkoutLogDoc } from "../types";
import { exerciseMetric, metricOfSets, bestSetForMetric } from "./setFormat";
import { tokens } from "./workoutText";
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

/** Deload is suggested if the user has been progressing ≥ 42 days on any key lift. */
export function deloadDue(records: StrengthRecordDoc[], today: string): boolean {
  const todayMs = Date.parse(today);
  return records.some((r) => {
    const first = r.history[0];
    const last = r.history[r.history.length - 1];
    if (!first || !last) return false;
    const days = (todayMs - Date.parse(first.date)) / 86_400_000;
    // A 6-week SPAN is not the same as 6 weeks of training: without this, one lift logged once
    // 42+ days ago and never touched since was enough to tell the user "you've been progressing
    // for 6-8 weeks, consider a deload" — asserting a training block that never happened. The
    // lift also has to be genuinely active (touched within the last two weeks) and to have real
    // history behind it, not a single ancient data point.
    const staleDays = (todayMs - Date.parse(last.date)) / 86_400_000;
    return days >= 42 && staleDays <= 14 && r.history.length >= 3;
  });
}

/** How many full weeks the plan has been running. */
export function weeksSincePlan(generatedAt: string, today: string): number {
  const days = (Date.parse(today) - Date.parse(generatedAt)) / 86_400_000;
  return days < 0 ? 0 : Math.floor(days / 7);
}

/** Automatic deload week for this plan (see domain/mesocycle trainingWeek, the single source). */
export function shouldDeload(plan: PlanDoc, today: string): boolean {
  return trainingWeek(plan, today).deload;
}

/** Drop an exercise's set count by ~40% for a deload week, keeping the rep range.
 * "4 × 8-10" → "2 × 8-10". Leaves set strings that don't start with "N ×" untouched. */
export function deloadSets(sets: string): string {
  return sets.replace(/^\s*(\d+)\s*([x×])/i, (_m, n: string, sep: string) => {
    const reduced = Math.max(1, Math.round(Number(n) * 0.6));
    return `${reduced} ${sep}`;
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

/** Low energy, poor sleep, or high stress across the given check-ins. The single definition of
 * "not a day/week to push", shared by the weekly progression hold below and the same-day
 * readiness advice (readinessAdvice) — two different thresholds for the same idea would let the
 * bot tell you to back off today while still ratcheting the plan up for the week. */
export function poorWellbeing(checkins: DailyCheckinDoc[]): boolean {
  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const energy = avg(checkins.map((c) => c.energy).filter((n) => n > 0));
  const sleep = avg(checkins.map((c) => c.sleep).filter((n) => n > 0));
  const stress = avg(checkins.map((c) => c.stress).filter((n) => n > 0));
  return (energy > 0 && energy <= 2) || (sleep > 0 && sleep <= 2) || stress >= 4;
}

export type Readiness = "ok" | "easy" | "light";

/** How hard to go TODAY, from today's check-in alone. `light` (≈-15% or drop a set) needs two
 * bad signals or a rock-bottom one; `easy` (≈-10%) is the single-bad-signal case, which is also
 * exactly what poorWellbeing() holds the weekly progression for. No check-in → "ok": absence of
 * data is not evidence of a bad day, and nagging someone who simply didn't log would train them
 * to ignore the line. */
export function readinessAdvice(checkin: DailyCheckinDoc | null | undefined): Readiness {
  if (!checkin) return "ok";
  const { energy, sleep, stress } = checkin;
  const bad = [energy > 0 && energy <= 2, sleep > 0 && sleep <= 2, stress >= 4].filter(Boolean).length;
  const rockBottom = energy === 1 || sleep === 1 || stress === 5;
  if (bad >= 2 || (bad >= 1 && rockBottom)) return "light";
  if (bad >= 1) return "easy";
  return "ok";
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

/** The next experience level up, or null at the top. */
export function nextLevel(level: ProgressionLevel): ProgressionLevel | null {
  if (level === "beginner") return "intermediate";
  if (level === "intermediate") return "advanced";
  return null;
}
type ProgressionLevel = "beginner" | "intermediate" | "advanced";

/** Ready to graduate to a harder plan when the trainee has clearly outgrown the current one:
 * training pace is "fast" AND progression fired in ≥ `minWeeks` of the recent weeks, and a
 * higher level exists. The caller offers a button — it is never auto-applied. */
export function shouldLevelUp(
  level: ProgressionLevel,
  rate: ProgressionRate,
  progressionWeeks: number,
  minWeeks = 4,
): boolean {
  return nextLevel(level) !== null && rate === "fast" && progressionWeeks >= minWeeks;
}

const FATLOSS_GOAL_RE = /(fat|схуд|похуд|loss|cut|lean|обезжир)/i;
const GAIN_GOAL_RE = /(muscle|mass|gain|bulk|набір|набор|мас|муск|гіпертроф|hypertroph)/i;

/** Shared: bodyweight moved `minDelta` kg in `dir` over ≥`minSpanDays`, then plateaued — the
 * last 3 weigh-ins (spanning ≥2 weeks) vary < 0.8 kg. */
function bodyweightSettled(weights: { date: string; weight: number }[], dir: "down" | "up", minDelta: number, minSpanDays: number): boolean {
  const pts = weights.filter((w) => w.weight > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (pts.length < 4) return false;
  const span = (Date.parse(pts[pts.length - 1].date) - Date.parse(pts[0].date)) / 86_400_000;
  const delta = dir === "down" ? pts[0].weight - pts[pts.length - 1].weight : pts[pts.length - 1].weight - pts[0].weight;
  if (span < minSpanDays || delta < minDelta) return false;
  const recent = pts.slice(-3);
  const recentSpan = (Date.parse(recent[2].date) - Date.parse(recent[0].date)) / 86_400_000;
  if (recentSpan < 14) return false;
  return Math.max(...recent.map((r) => r.weight)) - Math.min(...recent.map((r) => r.weight)) < 0.8;
}

/** A cut is "done" — fat-loss goal, lost ≥2 kg over ≥4 weeks, now plateaued. */
export function fatLossGoalReached(goal: string | undefined, weights: { date: string; weight: number }[]): boolean {
  return FATLOSS_GOAL_RE.test(goal ?? "") && bodyweightSettled(weights, "down", 2, 28);
}

/** A bulk is "done" — muscle-gain goal, gained ≥3 kg over ≥6 weeks, now plateaued. */
export function gainGoalReached(goal: string | undefined, weights: { date: string; weight: number }[]): boolean {
  return GAIN_GOAL_RE.test(goal ?? "") && bodyweightSettled(weights, "up", 3, 42);
}

// API Ninjas muscle enums, ordered major/compound first so a candidate cap keeps the useful
// ones. Used to pull a broad real-exercise candidate set for plan generation (single-pass).
export const API_MUSCLES = [
  "chest", "lats", "quadriceps", "hamstrings", "glutes", "middle_back", "triceps", "biceps",
  "abdominals", "traps", "calves", "lower_back", "forearms", "abductors", "adductors", "neck",
] as const;

const LOWER_HINTS = ["leg", "squat", "ногами", "ноги", "ніг", "присід", "присед", "deadlift", "становая", "станова", "lunge", "випад", "выпад", "hip thrust", "glute", "сідни", "ягодич", "calf", "ікр", "икр", "step-up", "step up", "good morning"];
/** Lower-body lift (bigger load step). The body map's region rules first, then name hints for
 *  what they file elsewhere (a deadlift counts as back there, but loads like a leg lift). */
export function isLowerBody(exercise: string): boolean {
  if (regionOf(exercise) === "legs") return true;
  const e = exercise.toLowerCase();
  return LOWER_HINTS.some((h) => e.includes(h));
}

export type MuscleGroup = "legs" | "back" | "chest" | "shoulders" | "arms" | "core";

/** Classify an exercise (UA or EN name) into a major training region, for the relative-strength
 * balance chart. Ordered so the specific patterns win before the generic "row/тяга" → back. */
export type WeightMode = "total" | "perSide" | "perHand";

// Resolve how a logged weight should be read: explicit tag wins; otherwise inferred from the
// name. "perSide" = one limb at a time (one-arm row, single-leg); "perHand" = one dumbbell in a
// two-dumbbell movement. The number itself is never transformed — this only labels/contextualizes.
export function resolveWeightMode(name: string, explicit?: "perSide" | "perHand"): WeightMode {
  if (explicit) return explicit;
  const s = (name || "").toLowerCase();
  // Unilateral: one arm / one leg at a time.
  if (/одн[іио][єe]ю рукою|одн[іио][єe]ю ногою|на одну руку|на одну ногу|поперем[іи]нн|поочеред|one[\s-]?arm|single[\s-]?arm|single[\s-]?leg|one[\s-]?leg|unilateral|\balternating\b/.test(s)) {
    return "perSide";
  }
  // Two dumbbells: the entered weight is per dumbbell (unless the name says otherwise).
  if (/гантел|dumbbell|\bdb\b/.test(s)) return "perHand";
  return "total";
}

/** The training region an exercise belongs to. Kept as the long-standing name; the rules are
 *  the body map's (muscleRegions.ts), so a region here always agrees with the map. */
export function muscleGroupOf(name: string): MuscleGroup | null {
  return regionOf(name);
}

/** True when recent logged sessions show poor adherence (lots of skips/grinding) — a sign the
 * trainee needs a lighter week even before the calendar deload is due. Looks at logged sessions
 * only: needs at least `minSessions` rows and a completed-ratio below `threshold`. */
export function adherenceDeloadDue(
  logs: WorkoutLogDoc[],
  opts: { minSessions?: number; threshold?: number } = {},
): boolean {
  const minSessions = opts.minSessions ?? 4;
  const threshold = opts.threshold ?? 0.5;
  if (logs.length < minSessions) return false;
  const completed = logs.filter((l) => l.completed).length;
  return completed / logs.length < threshold;
}

// ---------- compliance (trainer view) ----------

/** Weekly compliance: % of scheduled workouts completed and % of days with a food log.
 * `scheduledWorkouts` = training days that fell in the window; `windowDays` = nutrition denom. */
export function complianceScore(args: {
  completedWorkouts: number;
  scheduledWorkouts: number;
  nutritionDays: number;
  windowDays: number;
}): { workoutPct: number; nutritionPct: number } {
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);
  return {
    workoutPct: pct(args.completedWorkouts, args.scheduledWorkouts),
    nutritionPct: pct(args.nutritionDays, args.windowDays),
  };
}

// ---------- activity grid (streak calendar) ----------

export interface ActivityCell {
  date: string;
  workout: boolean;
  nutrition: boolean;
}

/** Build the last `days` calendar cells ending at `today` (oldest first), each flagged with
 * whether a workout was completed and/or food was logged that day. Pure — drives /progress. */
export function buildActivityCells(
  today: string,
  workoutDates: Set<string>,
  nutritionDates: Set<string>,
  days = 28,
): ActivityCell[] {
  const end = Date.parse(today);
  const cells: ActivityCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    cells.push({ date, workout: workoutDates.has(date), nutrition: nutritionDates.has(date) });
  }
  return cells;
}

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
