// What a logged exercise measures (reps, time or distance), how its sets are shown, and which
// set is the best one. Split out of progression.ts. Pure.
import type { ExerciseMetric, SetEntry } from "../types";

// Name signatures for exercises whose data isn't weight×reps — used as a fallback when neither
// an explicit `metric` nor a unit in `sets` is present (older plans, catalog-added exercises).
// Conservative: "row erg"/"rowing machine" (cardio) is matched, bare "row"/"тяга" (a back lift) is NOT.
export const TIME_NAME_RE = /планк|вис(?![а-яії])|утриман|статичн|холлоу|\b(?:plank|dead ?hang|bar hang|hang|wall ?sit|hollow ?hold|l-?sit|iso(?:metric)? ?hold)\b/iu;

export const DISTANCE_NAME_RE = /гребл|гребн|веслуванн|біг|пробіжк|доріж|велотренаж|велосипед|еліпт|еліпс|степер|плаванн|\b(?:rowing machine|row(?:ing)? erg|rower|ergometer|treadmill|running|run|jog(?:ging)?|cycling|spin bike|bike|elliptical|ski ?erg|stair ?(?:climber|master)|swimming|swim)\b/iu;

// Whole-name cardio that the word patterns above must not match inside longer names: the bot's own
// cardio menu logs "Rowing"/"Walking" (and Strava imports "Hiking"), but "Barbell Rowing" is a
// back lift and "Farmer's walk" a loaded carry. Without this, English-language cardio from the
// menu never counted as conditioning load.
export const CARDIO_EXACT_NAME_RE = /^\s*(?:rowing|walking|walk|hiking|hike|ходьба|прогулянка|похід)\s*$/iu;

/** Classify how an exercise is measured: explicit `metric` → unit in `sets` → name signature → reps. */
export function exerciseMetric(ex: { metric?: ExerciseMetric; sets?: string; name?: string }): ExerciseMetric {
  if (ex.metric) return ex.metric;
  const s = (ex.sets || "").toLowerCase();
  if (/\d\s*(?:km|км|m|м)(?![\p{L}])/iu.test(s)) return "distance";
  if (/(?:\d\s*(?:s|с|sec|сек|min|хв|мин)(?![\p{L}])|\d:[0-5]\d)/iu.test(s)) return "time";
  const n = ex.name ?? "";
  if (DISTANCE_NAME_RE.test(n) || CARDIO_EXACT_NAME_RE.test(n)) return "distance";
  if (TIME_NAME_RE.test(n)) return "time";
  return "reps";
}

/** Infer a logged exercise's metric from the shape of its recorded sets. */
export function metricOfSets(sets: SetEntry[]): ExerciseMetric {
  if (sets.some((s) => typeof s.meters === "number" && s.meters > 0)) return "distance";
  if (sets.some((s) => typeof s.seconds === "number" && s.seconds > 0)) return "time";
  return "reps";
}

/** Format a duration: <60s → "45s"; whole minutes → "3 min"; otherwise "mm:ss". */
export function fmtDuration(sec: number): string {
  if (sec <= 0) return "0s";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, "0")}` : `${m} min`;
}

/** Format a distance: ≥1000 m → "2 km" / "2.5 km"; otherwise "800 m". */
export function fmtDistance(m: number): string {
  if (m >= 1000) {
    const km = m / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${m} m`;
}

/** Human-readable, re-parseable rendering of one set, picking the axis that carries data.
 *  If the set carries an explicit RPE (from text log "@8" or the tap UI), append it — so
 *  a re-parse round-trips and the user sees effort per set, not just the exercise-level max. */
export function formatSetEntry(s: SetEntry): string {
  const rpe = typeof s.rpe === "number" && s.rpe > 0 && s.rpe <= 10 ? `@${s.rpe}` : "";
  if (typeof s.meters === "number" && s.meters > 0) {
    const dist = typeof s.seconds === "number" && s.seconds > 0
      ? `${fmtDistance(s.meters)} ${fmtDuration(s.seconds)}`
      : fmtDistance(s.meters);
    return `${dist}${rpe}`;
  }
  if (typeof s.seconds === "number" && s.seconds > 0) return `${fmtDuration(s.seconds)}${rpe}`;
  return `${s.weight}x${s.reps}${rpe}`;
}

/** Format a personal-record's best value on its native axis (compact, "120kg×5" / "1:15" / "2 km"). */
export function formatRecordBest(r: {
  metric: ExerciseMetric;
  bestWeight: number;
  bestReps: number;
  bestSeconds: number;
  bestMeters: number;
}): string {
  if (r.metric === "time") return fmtDuration(r.bestSeconds);
  if (r.metric === "distance") return fmtDistance(r.bestMeters);
  return `${r.bestWeight || "BW"}x${r.bestReps}`;
}

/** Best set on the metric's native axis: heaviest (reps), longest hold (time), farthest (distance). */
export function bestSetForMetric(sets: SetEntry[], metric: ExerciseMetric): SetEntry | undefined {
  if (!sets.length) return undefined;
  if (metric === "time") return sets.reduce((a, b) => ((b.seconds ?? 0) > (a.seconds ?? 0) ? b : a));
  if (metric === "distance") {
    return sets.reduce((a, b) => ((b.meters ?? 0) > (a.meters ?? 0) ? b : a));
  }
  return sets.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.reps > a.reps) ? b : a));
}
