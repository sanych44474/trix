// Per-muscle load from logged workouts and from a plan, on top of ./exerciseMuscles.ts: a set
// counts in full for the exercise's primary movers and as half a set for its helpers (the usual
// "fractional sets" convention). Feeds the body map's week / recovery modes and the plan-balance
// check (bot plan message + Mini App plan screen). Pure; test/muscle-load.test.ts.
import { musclesForExercise, type ExerciseMuscles, type Slug } from "./exerciseMuscles";

/** The muscles worth reporting on (the figure also has neck/tibialis, which nothing here trains). */
export const TRACKED_MUSCLES: Slug[] = [
  "chest", "upper-back", "trapezius", "lower-back", "deltoids", "biceps", "triceps", "forearm",
  "abs", "obliques", "quadriceps", "hamstring", "gluteal", "adductors", "calves",
];

/** Weekly working-set targets per muscle (fractional sets). MEV 0 = no minimum worth flagging. */
export const MUSCLE_LANDMARKS: Record<string, { mev: number; mav: number }> = {
  chest: { mev: 10, mav: 22 },
  "upper-back": { mev: 10, mav: 25 },
  deltoids: { mev: 8, mav: 22 },
  quadriceps: { mev: 8, mav: 18 },
  hamstring: { mev: 6, mav: 16 },
  gluteal: { mev: 4, mav: 16 },
  biceps: { mev: 6, mav: 20 },
  triceps: { mev: 6, mav: 18 },
  calves: { mev: 0, mav: 16 },
  abs: { mev: 0, mav: 16 },
  obliques: { mev: 0, mav: 12 },
  trapezius: { mev: 0, mav: 16 },
  forearm: { mev: 0, mav: 12 },
  "lower-back": { mev: 0, mav: 10 },
  adductors: { mev: 0, mav: 12 },
};

export type Lookup = (name: string) => ExerciseMuscles | null;

export interface LoggedDay { date: string; done: boolean; ex: Array<{ n: string; s: number }> }

export interface MuscleWeek {
  slug: Slug;
  sets: number; // fractional
  mev: number;
  mav: number;
  zone: "below" | "optimal" | "above" | "none";
  exercises: Array<{ name: string; sets: number; role: "primary" | "secondary" }>;
}

function zoneOf(sets: number, mev: number, mav: number): MuscleWeek["zone"] {
  if (sets <= 0) return mev > 0 ? "below" : "none";
  return sets < mev ? "below" : sets > mav ? "above" : "optimal";
}

/** Fractional working sets per muscle over the completed workouts on/after `since`. */
export function weeklyMuscleSets(logs: LoggedDay[], since: string, lookup: Lookup = musclesForExercise): MuscleWeek[] {
  const acc = new Map<Slug, { sets: number; exercises: Map<string, { name: string; sets: number; role: "primary" | "secondary" }> }>();
  const add = (slug: Slug, name: string, sets: number, role: "primary" | "secondary") => {
    const row = acc.get(slug) ?? { sets: 0, exercises: new Map() };
    row.sets += role === "primary" ? sets : sets / 2;
    const key = name.trim().toLowerCase();
    const ex = row.exercises.get(key) ?? { name: name.trim(), sets: 0, role };
    ex.sets += sets;
    if (role === "primary") ex.role = "primary";
    row.exercises.set(key, ex);
    acc.set(slug, row);
  };
  for (const log of logs) {
    if (!log.done || log.date < since) continue;
    for (const e of log.ex) {
      if (!(e.s > 0)) continue;
      const m = lookup(e.n);
      if (!m) continue;
      for (const slug of m.primary) add(slug, e.n, e.s, "primary");
      for (const slug of m.secondary) add(slug, e.n, e.s, "secondary");
    }
  }
  return TRACKED_MUSCLES.map((slug) => {
    const row = acc.get(slug);
    const sets = row ? Math.round(row.sets * 2) / 2 : 0;
    const { mev, mav } = MUSCLE_LANDMARKS[slug] ?? { mev: 0, mav: 16 };
    const exercises = row ? [...row.exercises.values()].sort((a, b) => (a.role === b.role ? b.sets - a.sets : a.role === "primary" ? -1 : 1)) : [];
    return { slug, sets, mev, mav, zone: zoneOf(sets, mev, mav), exercises };
  });
}

export type RecoveryStatus = "recovering" | "almost" | "ready";

export interface MuscleRecovery {
  slug: Slug;
  status: RecoveryStatus;
  daysAgo: number | null; // since the last workout that loaded it (null = not in the window)
  role: "primary" | "secondary" | null; // how that workout loaded it
  exercises: string[]; // what loaded it that day
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * How recovered each muscle is, from the calendar days since it was last trained: a primary mover
 * needs ~48–72 h, so today/yesterday = recovering, two days ago = almost, three or more = ready.
 * A muscle that only assisted recovers a day sooner. Any logged sets count, finished or not --
 * a half-done session still tired the muscle.
 */
export function muscleRecovery(logs: LoggedDay[], today: string, lookup: Lookup = musclesForExercise): MuscleRecovery[] {
  const sorted = [...logs].filter((l) => l.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1));
  return TRACKED_MUSCLES.map((slug) => {
    let primaryDay: { date: string; exercises: string[] } | null = null;
    let secondaryDay: { date: string; exercises: string[] } | null = null;
    for (const log of sorted) {
      for (const e of log.ex) {
        if (!(e.s > 0)) continue;
        const m = lookup(e.n);
        if (!m) continue;
        const target = m.primary.includes(slug) ? "primary" : m.secondary.includes(slug) ? "secondary" : null;
        if (target === "primary") {
          if (!primaryDay) primaryDay = { date: log.date, exercises: [] };
          if (primaryDay.date === log.date) primaryDay.exercises.push(e.n.trim());
        } else if (target === "secondary") {
          if (!secondaryDay) secondaryDay = { date: log.date, exercises: [] };
          if (secondaryDay.date === log.date) secondaryDay.exercises.push(e.n.trim());
        }
      }
      if (primaryDay && secondaryDay) break;
    }
    const statusOf = (days: number, role: "primary" | "secondary"): RecoveryStatus => {
      const d = role === "primary" ? days : days + 1;
      return d <= 1 ? "recovering" : d === 2 ? "almost" : "ready";
    };
    const rank: Record<RecoveryStatus, number> = { recovering: 0, almost: 1, ready: 2 };
    type Candidate = { role: "primary" | "secondary"; day: { date: string; exercises: string[] }; days: number; status: RecoveryStatus };
    const candidates: Candidate[] = [];
    for (const [role, day] of [["primary", primaryDay], ["secondary", secondaryDay]] as Array<["primary" | "secondary", { date: string; exercises: string[] } | null]>) {
      if (!day) continue;
      const days = daysBetween(day.date, today);
      candidates.push({ role, day, days, status: statusOf(days, role) });
    }
    // The most limiting load decides; on a tie, the more recent one explains it.
    candidates.sort((a, b) => rank[a.status] - rank[b.status] || a.days - b.days);
    const worst = candidates[0];
    if (!worst) return { slug, status: "ready", daysAgo: null, role: null, exercises: [] };
    return { slug, status: worst.status, daysAgo: worst.days, role: worst.role, exercises: [...new Set(worst.day.exercises)] };
  });
}

// ---- plan balance ----

/** Pairs that should be trained in proportion (antagonists / front vs back). */
const BALANCE_PAIRS: Array<[Slug, Slug]> = [
  ["chest", "upper-back"],
  ["quadriceps", "hamstring"],
  ["biceps", "triceps"],
];

/** Antagonist pairs where the weaker side gets under half the stronger's volume (and the stronger
 *  side has at least `minStrong` sets, so a light week isn't called lopsided). */
export function lopsidedPairs(sets: (slug: Slug) => number, minStrong = 6): Array<{ weak: Slug; weakSets: number; strong: Slug; strongSets: number }> {
  const out: Array<{ weak: Slug; weakSets: number; strong: Slug; strongSets: number }> = [];
  for (const [a, b] of BALANCE_PAIRS) {
    const [strong, weak] = sets(a) >= sets(b) ? [a, b] : [b, a];
    if (sets(strong) < minStrong || sets(weak) >= sets(strong) / 2) continue;
    out.push({ weak, weakSets: sets(weak), strong, strongSets: sets(strong) });
  }
  return out;
}

/** Muscles a general strength plan should reach at least once a week. */
export const KEY_MUSCLES: Slug[] = ["chest", "upper-back", "deltoids", "quadriceps", "hamstring", "gluteal", "biceps", "triceps", "abs"];

/** One well-known, equipment-light exercise per muscle, to suggest when it's missing. */
export const SUGGESTED_EXERCISE: Partial<Record<Slug, { uk: string; en: string }>> = {
  chest: { uk: "Віджимання", en: "Push-up" },
  "upper-back": { uk: "Тяга гантелі в нахилі", en: "Dumbbell row" },
  deltoids: { uk: "Махи гантелями в сторони", en: "Lateral raise" },
  quadriceps: { uk: "Гоблет-присідання", en: "Goblet squat" },
  hamstring: { uk: "Румунська тяга", en: "Romanian deadlift" },
  gluteal: { uk: "Ягідний місток", en: "Glute bridge" },
  biceps: { uk: "Згинання рук з гантелями", en: "Dumbbell curl" },
  triceps: { uk: "Зворотні віджимання від лави", en: "Bench dips" },
  abs: { uk: "Планка", en: "Plank" },
};

/** Which muscles naturally share a training day (the day a suggestion should go to). */
const DAY_FAMILY: Record<string, Slug[]> = {
  chest: ["chest", "triceps", "deltoids"],
  triceps: ["chest", "triceps", "deltoids"],
  deltoids: ["deltoids", "chest", "triceps", "upper-back"],
  "upper-back": ["upper-back", "biceps", "trapezius"],
  biceps: ["upper-back", "biceps", "forearm"],
  quadriceps: ["quadriceps", "gluteal", "hamstring", "calves"],
  hamstring: ["hamstring", "gluteal", "quadriceps", "lower-back"],
  gluteal: ["gluteal", "hamstring", "quadriceps"],
  abs: ["abs", "obliques"],
};

export interface PlanDayLike { weekday: number; exercises: Array<{ name: string; sets?: string }> }

export interface BalanceIssue {
  kind: "missing" | "imbalance";
  slug: Slug; // the under-trained muscle
  sets: number;
  other?: { slug: Slug; sets: number }; // for an imbalance: the muscle it lags behind
  suggestion?: { uk: string; en: string; weekday: number };
}

/** "4 × 8–10" → 4; anything unparseable counts as a typical 3 sets. */
export function planSetCount(sets: string | undefined): number {
  const n = parseInt((sets ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : 3;
}

function planMuscleSets(days: PlanDayLike[], lookup: Lookup): { total: Map<Slug, number>; perDay: Map<number, Map<Slug, number>>; mapped: number } {
  const total = new Map<Slug, number>();
  const perDay = new Map<number, Map<Slug, number>>();
  let mapped = 0;
  for (const day of days) {
    const dayMap = new Map<Slug, number>();
    for (const ex of day.exercises) {
      const m = lookup(ex.name);
      if (!m) continue;
      mapped++;
      const n = planSetCount(ex.sets);
      for (const slug of m.primary) dayMap.set(slug, (dayMap.get(slug) ?? 0) + n);
      for (const slug of m.secondary) dayMap.set(slug, (dayMap.get(slug) ?? 0) + n / 2);
    }
    perDay.set(day.weekday, dayMap);
    for (const [slug, n] of dayMap) total.set(slug, (total.get(slug) ?? 0) + n);
  }
  return { total, perDay, mapped };
}

/**
 * What a strength plan leaves out or lopsided: key muscles with under one effective set a week,
 * and antagonist pairs where one side gets under half the other's volume (only when the stronger
 * side has real volume). Each comes with one exercise to add and the day it fits best (the day
 * already training that muscle's neighbours; fewer exercises on a tie). Plans with barely any
 * mappable strength work (cardio, yoga, mobility) aren't judged at all.
 */
export function planBalance(days: PlanDayLike[], lookup: Lookup = musclesForExercise): BalanceIssue[] {
  const { total, perDay, mapped } = planMuscleSets(days, lookup);
  if (mapped < 4 || days.length === 0) return [];
  const sets = (slug: Slug) => Math.round((total.get(slug) ?? 0) * 2) / 2;
  const bestDay = (slug: Slug): number => {
    const family = DAY_FAMILY[slug] ?? [slug];
    const scored = days.map((d) => ({
      weekday: d.weekday,
      score: family.reduce((sum, s) => sum + (perDay.get(d.weekday)?.get(s) ?? 0), 0),
      size: d.exercises.length,
    }));
    scored.sort((a, b) => b.score - a.score || a.size - b.size || a.weekday - b.weekday);
    return scored[0]!.weekday;
  };
  const suggest = (slug: Slug) => {
    const s = SUGGESTED_EXERCISE[slug];
    return s ? { ...s, weekday: bestDay(slug) } : undefined;
  };
  const issues: BalanceIssue[] = [];
  for (const slug of KEY_MUSCLES) {
    if (sets(slug) < 1) issues.push({ kind: "missing", slug, sets: sets(slug), suggestion: suggest(slug) });
  }
  const flagged = new Set(issues.map((i) => i.slug));
  for (const pair of lopsidedPairs(sets)) {
    if (flagged.has(pair.weak)) continue;
    issues.push({ kind: "imbalance", slug: pair.weak, sets: pair.weakSets, other: { slug: pair.strong, sets: pair.strongSets }, suggestion: suggest(pair.weak) });
  }
  return issues;
}

/** Fractional sets per muscle for each of the last `weeks` 7-day windows ending `today` (oldest
 *  first) -- the Progress screen's per-muscle trend. Same counting as weeklyMuscleSets. */
export function weeklyMuscleSeries(logs: LoggedDay[], today: string, weeks = 12, lookup: Lookup = musclesForExercise): { weekEnds: string[]; series: Record<string, number[]> } {
  const dayMs = 86_400_000;
  const end = Date.parse(`${today}T00:00:00Z`);
  const weekEnds = Array.from({ length: weeks }, (_, i) => new Date(end - (weeks - 1 - i) * 7 * dayMs).toISOString().slice(0, 10));
  const series: Record<string, number[]> = Object.fromEntries(TRACKED_MUSCLES.map((s) => [s, new Array<number>(weeks).fill(0)]));
  for (const log of logs) {
    if (!log.done) continue;
    const age = Math.round((end - Date.parse(`${log.date}T00:00:00Z`)) / dayMs);
    if (age < 0) continue;
    const bucket = weeks - 1 - Math.floor(age / 7);
    if (bucket < 0) continue;
    for (const e of log.ex) {
      if (!(e.s > 0)) continue;
      const m = lookup(e.n);
      if (!m) continue;
      for (const slug of m.primary) if (series[slug]) series[slug]![bucket]! += e.s;
      for (const slug of m.secondary) if (series[slug]) series[slug]![bucket]! += e.s / 2;
    }
  }
  return { weekEnds, series };
}
