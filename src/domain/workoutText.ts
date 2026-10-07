// Parsing what people type: workout lines ("Bench 80x6, 80x5"), steps, height/weight,
// body measurements, and matching an exercise name to the catalog. Split out of
// progression.ts. Pure.
import type { BodyMeasurements } from "../types";

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
export function parseRpe(line: string): number | undefined {
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
export function splitNameBody(line: string): { name: string; body: string } {
  const m = /\d|bw\b|bodyweight|власна|своя/iu.exec(line);
  const idx = m ? m.index : line.length;
  const name = line.slice(0, idx).replace(/[,:–—-]\s*$/u, "").trim() || "exercise";
  return { name, body: line.slice(idx) };
}

// Weight×reps sets on a line, ignoring matches whose "reps" is actually a time/distance unit
// (so "3x45s" / "1x2000m" fall through to the time/distance parser instead).
export function parseRepsSets(body: string): { weight: number; reps: number }[] {
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
export function parseTimeDistanceSets(body: string): { seconds?: number; meters?: number }[] {
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

/** Parse a daily step count from free text: "8000", "8 000", "8,000", "пройшов 10000 кроків".
 * Takes the first run of digits (allowing space/comma/dot thousands separators). */
export function parseSteps(text: string): number | undefined {
  const m = /\d[\d\s.,]*/.exec(text);
  if (!m) return undefined;
  const n = parseInt(m[0].replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 && n <= 200_000 ? n : undefined;
}

export const STOP_WORDS = new Set(["the", "a", "with", "in", "on", "of", "та", "на", "в", "з", "и", "с"]);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

export function titleCase(s: string): string {
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

export const FIELD_WORDS: Record<keyof BodyMeasurements | "weight", string[]> = {
  weight: ["weight", "вага", "вес", "w"],
  waist: ["waist", "талія", "талия"],
  chest: ["chest", "груди", "грудь"],
  hips: ["hips", "hip", "стегна", "бедра", "бёдра"],
  arm: ["arm", "biceps", "рука", "біцепс", "бицепс"],
  thigh: ["thigh", "нога", "бедро"],
  neck: ["neck", "шия", "шея"],
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

// Drop implausible AI-provided body metrics so the interview re-asks instead of saving nonsense.
export function sanitizeBodyMetrics<T extends { heightCm?: number; weightKg?: number }>(p: T): T {
  const out = { ...p };
  if (out.heightCm !== undefined && !realisticHeightCm(out.heightCm)) out.heightCm = undefined;
  if (out.weightKg !== undefined && !realisticWeightKg(out.weightKg)) out.weightKg = undefined;
  return out;
}
