import type {
  BodyMeasurements,
  DailyCheckinDoc,
  ExerciseMetric,
  PlanDay,
  PlanDoc,
  PlanExercise,
  ProgressionRate,
  SetEntry,
  StrengthRecordDoc,
  Weekday,
  WorkoutLogDoc,
} from "../types";

export interface LocalParts {
  date: string; // YYYY-MM-DD
  weekday: Weekday; // 1=Mon … 7=Sun
  hour: number; // 0..23
  minute: number; // 0..59
}

/** Current local date/weekday/hour/minute for an IANA timezone (defaults to UTC). */
// Do-not-disturb window check. from/to are local hours (0..23); a window may wrap past midnight
// (e.g. 22→7). Undefined bounds = quiet hours off. `to` is exclusive.
export function inQuietHours(hour: number, from?: number, to?: number): boolean {
  if (from === undefined || to === undefined || from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export function localParts(timezone?: string, now: Date = new Date()): LocalParts {
  const tz = timezone || "UTC";
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
  }
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const minute = parseInt(get("minute"), 10) || 0;
  const wmap: Record<string, Weekday> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const weekday = wmap[get("weekday")] ?? 1;
  return { date, weekday, hour, minute };
}

export function getPlanDay(plan: PlanDoc, weekday: Weekday): PlanDay | undefined {
  return plan.split.find((d) => d.weekday === weekday);
}

/** Parse free-text workout log into (exercise, weight, reps) tuples.
 * Handles lines like: "Bench press 80x6, 80x5" / "Жим 80х6" / "Pull-ups bodyweight x10". */
export interface ParsedSet {
  exercise: string;
  weight: number; // 0 = bodyweight
  reps: number; // 0 for pure time/distance sets
  rpe?: number; // session RPE if the line carried one (e.g. "80x6 @8", "rpe 8")
  seconds?: number; // hold/work duration (plank, rowing-for-time)
  meters?: number; // distance (rowing, run)
}

// Pull an RPE value (0..10) out of a line: "@8", "@8.5", "rpe 8", "rpe8", "рпе8".
function parseRpe(line: string): number | undefined {
  const m = /(?:@|rpe\s*|рпе\s*)(\d{1,2}(?:[.,]\d)?)/i.exec(line);
  if (!m) return undefined;
  const v = parseFloat(m[1].replace(",", "."));
  return v > 0 && v <= 10 ? v : undefined;
}

/** Parse a single duration token to seconds: "1:30"→90, "90s"/"90 сек"→90, "2 min"/"2 хв"→120. */
export function parseDuration(token: string): number | undefined {
  const colon = /(\d{1,3}):([0-5]?\d)(?!\d)/.exec(token);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  const min = /(\d+(?:[.,]\d+)?)\s*(?:хвилин|хвил|хв|минут|мин|minutes?|mins?|min)(?![\p{L}])/iu.exec(token);
  if (min) return Math.round(parseFloat(min[1].replace(",", ".")) * 60);
  const sec = /(\d+(?:[.,]\d+)?)\s*(?:секунд\w*|секунд|сек|seconds?|secs?|sec|s|с)(?![\p{L}])/iu.exec(token);
  if (sec) return Math.round(parseFloat(sec[1].replace(",", ".")));
  return undefined;
}

/** Parse a single distance token to meters: "2000m"/"2000 м"→2000, "5 km"/"5км"→5000. */
export function parseDistance(token: string): number | undefined {
  const km = /(\d+(?:[.,]\d+)?)\s*(?:km|км)(?![\p{L}])/iu.exec(token);
  if (km) return Math.round(parseFloat(km[1].replace(",", ".")) * 1000);
  const m = /(\d+(?:[.,]\d+)?)\s*(?:m|м)(?![\p{L}])/iu.exec(token);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")));
  return undefined;
}

// Earliest position of the first measurement (a digit or bodyweight word) — splits name from data.
function splitNameBody(line: string): { name: string; body: string } {
  const m = /\d|bw\b|bodyweight|власна|своя/iu.exec(line);
  const idx = m ? m.index : line.length;
  const name = line.slice(0, idx).replace(/[,:–—-]\s*$/u, "").trim() || "exercise";
  return { name, body: line.slice(idx) };
}

// Weight×reps sets on a line, ignoring matches whose "reps" is actually a time/distance unit
// (so "3x45s" / "1x2000m" fall through to the time/distance parser instead).
function parseRepsSets(body: string): { weight: number; reps: number }[] {
  const out: { weight: number; reps: number }[] = [];
  const re = /(\d+(?:[.,]\d+)?|bw|bodyweight|власна|своя)\s*[xх×*]\s*(\d+)/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const after = body.slice(re.lastIndex);
    if (/^\s*(?:sec|сек|s|с|km|км|m|м)(?![\p{L}])/iu.test(after) || /^\s*:\d/.test(after)) continue;
    const wRaw = (m[1] ?? "").toLowerCase();
    const weight = /^\d/.test(wRaw) ? parseFloat(wRaw.replace(",", ".")) : 0;
    const reps = parseInt(m[2], 10);
    if (reps > 0 && reps < 1000) out.push({ weight, reps });
  }
  return out;
}

// Time/distance sets on a line. A leading "N ×" before a single value means N identical sets;
// comma-separated values are distinct sets. "2000m 8:00" → one set carrying both axes.
function parseTimeDistanceSets(body: string): { seconds?: number; meters?: number }[] {
  let count = 1;
  let rest = body;
  const mult = /^\s*(\d+)\s*[xх×*]\s*(?=\d)/iu.exec(body);
  if (mult) {
    count = parseInt(mult[1], 10);
    rest = body.slice(mult[0].length);
  }
  const parsed: { seconds?: number; meters?: number }[] = [];
  for (const seg of rest.split(",").map((s) => s.trim()).filter(Boolean)) {
    const seconds = parseDuration(seg);
    const meters = parseDistance(seg);
    if (seconds !== undefined || meters !== undefined) {
      parsed.push({ ...(seconds !== undefined ? { seconds } : {}), ...(meters !== undefined ? { meters } : {}) });
    }
  }
  if (!parsed.length) return [];
  if (count > 1 && parsed.length === 1) return Array.from({ length: count }, () => ({ ...parsed[0] }));
  return parsed;
}

/** Parse free-text workout log into sets. Handles weight×reps ("Bench 80x6, 80x5", "Жим 60х10"),
 * timed holds ("Plank 60s", "Планка 3х45с", "1:00") and cardio distance/time ("Rowing 2000m 8:00",
 * "Гребля 20 хв"). Time-only sets carry `seconds`; distance sets carry `meters` (+ optional time). */
export function parseWorkoutText(text: string): ParsedSet[] {
  const out: ParsedSet[] = [];
  for (const rawLine of text.split(/[\n;]+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const { name, body } = splitNameBody(line);
    const rpe = parseRpe(line);
    const reps = parseRepsSets(body);
    if (reps.length) {
      for (const r of reps) out.push({ exercise: name, weight: r.weight, reps: r.reps, ...(rpe ? { rpe } : {}) });
      continue;
    }
    for (const s of parseTimeDistanceSets(body)) {
      out.push({ exercise: name, weight: 0, reps: 0, ...s, ...(rpe ? { rpe } : {}) });
    }
  }
  return out;
}

// ---------- metric classification & display ----------

// Name signatures for exercises whose data isn't weight×reps — used as a fallback when neither
// an explicit `metric` nor a unit in `sets` is present (older plans, catalog-added exercises).
// Conservative: "row erg"/"rowing machine" (cardio) is matched, bare "row"/"тяга" (a back lift) is NOT.
const TIME_NAME_RE = /планк|вис(?![а-яії])|утриман|статичн|холлоу|\b(?:plank|dead ?hang|bar hang|hang|wall ?sit|hollow ?hold|l-?sit|iso(?:metric)? ?hold)\b/iu;
const DISTANCE_NAME_RE = /гребл|гребн|веслуванн|біг|пробіжк|доріж|велотренаж|велосипед|еліпт|еліпс|степер|плаванн|\b(?:rowing machine|row(?:ing)? erg|rower|ergometer|treadmill|running|run|jog(?:ging)?|cycling|spin bike|bike|elliptical|ski ?erg|stair ?(?:climber|master)|swimming|swim)\b/iu;

/** Classify how an exercise is measured: explicit `metric` → unit in `sets` → name signature → reps. */
export function exerciseMetric(ex: { metric?: ExerciseMetric; sets?: string; name?: string }): ExerciseMetric {
  if (ex.metric) return ex.metric;
  const s = (ex.sets || "").toLowerCase();
  if (/\d\s*(?:km|км|m|м)(?![\p{L}])/iu.test(s)) return "distance";
  if (/(?:\d\s*(?:s|с|sec|сек|min|хв|мин)(?![\p{L}])|\d:[0-5]\d)/iu.test(s)) return "time";
  const n = ex.name ?? "";
  if (DISTANCE_NAME_RE.test(n)) return "distance";
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

/** Parse a daily step count from free text: "8000", "8 000", "8,000", "пройшов 10000 кроків".
 * Takes the first run of digits (allowing space/comma/dot thousands separators). */
export function parseSteps(text: string): number | undefined {
  const m = /\d[\d\s.,]*/.exec(text);
  if (!m) return undefined;
  const n = parseInt(m[0].replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 && n <= 200_000 ? n : undefined;
}

const STOP_WORDS = new Set(["the", "a", "with", "in", "on", "of", "та", "на", "в", "з", "и", "с"]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

function titleCase(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Map a free-text exercise name to a canonical candidate (plan / existing records)
 * when there's strong token overlap, so progress tracking doesn't fragment. */
export function normalizeExercise(name: string, candidates: string[]): string {
  const nt = tokens(name);
  if (nt.size === 0) return titleCase(name);
  let best: string | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    const ct = tokens(c);
    if (ct.size === 0) continue;
    let inter = 0;
    for (const w of nt) if (ct.has(w)) inter++;
    const score = inter / Math.min(nt.size, ct.size);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.5 && best ? best : titleCase(name);
}

// Plausible human body metrics — reject typos / nonsense at onboarding and profile edit.
export const HEIGHT_CM = { min: 100, max: 250 };
export const WEIGHT_KG = { min: 30, max: 300 };
export const realisticHeightCm = (h: number): boolean =>
  Number.isFinite(h) && h >= HEIGHT_CM.min && h <= HEIGHT_CM.max;
export const realisticWeightKg = (w: number): boolean =>
  Number.isFinite(w) && w >= WEIGHT_KG.min && w <= WEIGHT_KG.max;

/** Parse "180 85" → { heightCm, weightKg }, enforcing realistic ranges. Auto-swaps when the
 * user typed weight first ("85 180"). Returns null when neither order is plausible (→ re-ask). */
export function parseHeightWeight(text: string): { heightCm: number; weightKg: number } | null {
  const nums = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => parseFloat(x.replace(",", ".")));
  if (nums.length < 2) return null;
  const [a, b] = nums;
  if (realisticHeightCm(a) && realisticWeightKg(b)) return { heightCm: a, weightKg: b };
  if (realisticHeightCm(b) && realisticWeightKg(a)) return { heightCm: b, weightKg: a }; // typed weight first
  return null;
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

/** Suggest the next double-progression target for a key lift.
 * RPE autoregulation (promt.txt R8): if the last set felt maximal (RPE ≥ 9.5) hold the load
 * to consolidate; if there was clearly gas left (RPE ≤ 7) take a bigger jump; otherwise the
 * standard double progression — add a rep until the top of the range, then add load. */
export function nextTarget(
  bestWeight: number,
  bestReps: number,
  isLowerBody: boolean,
  lastRpe?: number,
): string {
  const topOfRange = 12;
  const inc = isLowerBody ? 10 : 5;
  if (typeof lastRpe === "number" && lastRpe >= 9.5) {
    // Overshot — repeat the same target before progressing.
    return `${bestWeight || "BW"} × ${bestReps}`;
  }
  const easy = typeof lastRpe === "number" && lastRpe <= 7;
  if (bestReps < topOfRange) {
    return `${bestWeight || "BW"} × ${bestReps + (easy ? 2 : 1)}`;
  }
  return `${bestWeight + (easy ? inc * 2 : inc)} × 8`;
}

/** Deload is suggested if the user has been progressing ≥ 42 days on any key lift. */
export function deloadDue(records: StrengthRecordDoc[], today: string): boolean {
  const todayMs = Date.parse(today);
  return records.some((r) => {
    const first = r.history[0];
    if (!first) return false;
    const days = (todayMs - Date.parse(first.date)) / 86_400_000;
    return days >= 42;
  });
}

/** Deload autopilot: how many full weeks the plan has been running.
 * A deload week is due every 7th week (≈6–8 week mesocycle) since the plan was generated. */
export function weeksSincePlan(generatedAt: string, today: string): number {
  const days = (Date.parse(today) - Date.parse(generatedAt)) / 86_400_000;
  return days < 0 ? 0 : Math.floor(days / 7);
}

export function deloadWeekDue(generatedAt: string, today: string): boolean {
  const w = weeksSincePlan(generatedAt, today);
  return w > 0 && w % 7 === 0;
}

/** Automatic deload: true on every Nth full week since the plan started (default 4),
 * so volume drops without a manual /replan. Interval comes from the plan meta. */
export function shouldDeload(plan: PlanDoc, today: string): boolean {
  const interval = plan.deloadInterval && plan.deloadInterval > 0 ? plan.deloadInterval : 4;
  const w = weeksSincePlan(plan.generatedAt.toISOString(), today);
  return w > 0 && w % interval === 0;
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

/** Smallest sane plate jump: +5 kg lower body, +2.5 kg upper — ≤5% of a typical working load. */
function weightStep(isLower: boolean): number {
  return isLower ? 5 : 2.5;
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

function exerciseTokensEqual(a: string, b: string): boolean {
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
}

export interface ProgressionResult {
  changes: ExerciseChange[];
  plateau: string[]; // exercises grinding without reaching the top of the range — held, not pushed
  maxedBodyweight: string[]; // bodyweight lifts that hit the rep cap → need a harder variation/load
  heldForWellbeing: boolean; // poor recent check-ins → all increases skipped this week
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
): ProgressionResult {
  const result: ProgressionResult = { changes: [], plateau: [], maxedBodyweight: [], heldForWellbeing: false };
  if (logs.filter((l) => l.completed).length < 2) return result;

  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const energy = avg(checkins.map((c) => c.energy).filter((n) => n > 0));
  const sleep = avg(checkins.map((c) => c.sleep).filter((n) => n > 0));
  const stress = avg(checkins.map((c) => c.stress).filter((n) => n > 0));
  if ((energy > 0 && energy <= 2) || (sleep > 0 && sleep <= 2) || stress >= 4) {
    result.heldForWellbeing = true;
    return result;
  }

  for (const day of plan.split) {
    day.exercises.forEach((ex, index) => {
      const metric = exerciseMetric(ex);
      // Recent sessions where this exercise was actually trained (matched by name/canonical),
      // each reduced to its best set on the exercise's native axis.
      const sessions: { date: string; weight: number; reps: number; seconds: number; meters: number; rpe?: number }[] = [];
      for (const log of logs) {
        for (const le of log.exercises) {
          if (le.skipped || !le.setsDone?.length) continue;
          if (!exerciseTokensEqual(le.name, ex.name) && !(ex.canonicalName && exerciseTokensEqual(le.name, ex.canonicalName))) continue;
          const best = bestSetForMetric(le.setsDone, metric);
          if (best) sessions.push({ date: log.date, weight: best.weight, reps: best.reps, seconds: best.seconds ?? 0, meters: best.meters ?? 0, rpe: le.rpe });
          break;
        }
      }
      if (sessions.length < MIN_SESSIONS) return;
      sessions.sort((a, b) => (a.date < b.date ? 1 : -1)); // most recent first

      if (metric === "time" || metric === "distance") {
        progressTimedExercise(result, ex, day.weekday, index, metric, sessions);
        return;
      }

      const range = parseRepRange(ex.sets);
      const top = range?.high;
      const w = parsePlanWeight(ex.startWeight);

      const reachedTop = (s: { reps: number }) => top === undefined || s.reps >= top;
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
            if (to !== ex.sets) result.changes.push({ weekday: day.weekday, index, exercise: ex.name, field: "reps", from: ex.sets, to });
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
      const step = weightStep(isLowerBody(ex.name));
      const demonstrated = Math.max(...sessions.slice(0, 3).map((s) => s.weight));
      if (demonstrated <= 0) return;

      // Progress ABOVE demonstrated only when the last MIN_SESSIONS both topped the rep range and
      // weren't maximal — then add one step (two on an easy week). Capped at demonstrated + 2 steps.
      const ready = recent.length === MIN_SESSIONS && recent.every((s) => reachedTop(s) && notMaxed(s));
      let target = demonstrated;
      if (ready) {
        const rpes = recent.map((s) => s.rpe).filter((r): r is number => typeof r === "number");
        const easy = rpes.length ? rpes.every((r) => r <= 7) : top !== undefined && recent.every((s) => s.reps >= top + 2);
        target = demonstrated + step * (easy ? 2 : 1);
      }
      target = Math.min(target, demonstrated + step * 2);

      if (Math.abs(target - w.kg) >= 0.5) {
        const to = `${fmtNum(target)}${w.suffix || " kg"}`;
        if (to !== ex.startWeight) result.changes.push({ weekday: day.weekday, index, exercise: ex.name, field: "weight", from: ex.startWeight, to });
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

const LOWER_HINTS = ["leg", "squat", "ногами", "ноги", "присід", "deadlift", "становая", "станова"];
export function isLowerBody(exercise: string): boolean {
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

export function muscleGroupOf(name: string): MuscleGroup | null {
  const s = (name || "").toLowerCase();
  // Order is deliberate: more-specific patterns win before generic ones. Arms before back (triceps
  // pushdown has "блок"); shoulders & back before chest (lat pulldown "до грудей" must not read as chest).
  if (/присід|випад|ногам|стегн|привідн|згинання ніг|розгинання ніг|відведення ніг|приведення ніг|квадрицеп|сіднич|гак[\s-]?прис|жим ног|squat|lunge|leg press|leg extension|leg curl|hamstring|quadricep|\bquad\b|abductor|adductor|calf|литк|на носки|gluteus|glute|hip thrust|місток/.test(s)) return "legs";
  if (/станов|румун|deadlift|hip hinge|good morning/.test(s)) return "legs"; // hinge / posterior chain
  if (/біцепс|трицепс|згинання рук|розгинання рук|на біцепс|на трицепс|\bcurl\b|triceps|biceps|молот|hammer|скотт|preacher|skull|французьк/.test(s)) return "arms";
  if (/жим стоячи|над головою|армійськ|плеч|дельт|махи|розведення гантел|у сторони|lateral raise|overhead press|military|shoulder|шраг|shrug|upright row|face pull|тяга.*обличч|жим.*сидячи|перед собою|(розведення|зведення) рук назад/.test(s)) return "shoulders";
  if (/тяга|підтягуван|блок|\brow\b|pulldown|pull[\s-]?up|chin[\s-]?up|\blat\b|спин|широч/.test(s)) return "back";
  if (/жим лежач|лежачи|віджиман|груд|bench|chest|push[\s-]?up|зведення рук|кросовер|cable cross|\bfly\b|флай|пуловер|dip|брус|похил|incline/.test(s)) return "chest";
  if (/планк|\bвис\b|прес|скручуван|core|plank|crunch|\bab\b|sit[\s-]?up|hollow/.test(s)) return "core";
  return null;
}

const FIELD_WORDS: Record<keyof BodyMeasurements | "weight", string[]> = {
  weight: ["weight", "вага", "вес", "w"],
  waist: ["waist", "талія", "талия"],
  chest: ["chest", "груди", "грудь"],
  hips: ["hips", "hip", "стегна", "бедра", "бёдра"],
  arm: ["arm", "biceps", "рука", "біцепс", "бицепс"],
  thigh: ["thigh", "нога", "бедро"],
};

/** Parse "weight 73, waist 82, arm 38" (EN/UA/RU keywords) into weight + measurements. */
export function parseMeasurements(text: string): {
  weight?: number;
  measurements: BodyMeasurements;
} {
  const lower = text.toLowerCase();
  const measurements: BodyMeasurements = {};
  let weight: number | undefined;
  for (const [field, words] of Object.entries(FIELD_WORDS)) {
    for (const w of words) {
      const m = new RegExp(`${w}\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`, "i").exec(lower);
      if (m) {
        const v = parseFloat(m[1].replace(",", "."));
        if (field === "weight") weight = v;
        else measurements[field as keyof BodyMeasurements] = v;
        break;
      }
    }
  }
  return { weight, measurements };
}

// ---------- adherence-triggered deload ----------

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

// ---------- periodization (mesocycle phases) ----------

export type MesoPhase = "accumulation" | "intensification" | "peak" | "deload";

/** Map a 0-based plan week index to a 4-week mesocycle phase. The block runs
 * Accumulation → Intensification → Peak → Deload and repeats with auto-transitions. */
export function mesocyclePhase(weekIndex: number): { phase: MesoPhase; weekInBlock: number } {
  const w = Math.max(0, Math.floor(weekIndex)) % 4; // 0..3
  const phase = (["accumulation", "intensification", "peak", "deload"] as const)[w];
  return { phase, weekInBlock: w + 1 };
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
