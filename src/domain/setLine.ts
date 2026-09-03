// Compact one-line set entry for the guided logger — replaces the sets→weight→reps
// question chain with a single message. Pure parsing, unit-tested.
//
// Accepted forms (weights in kg, units "kg/кг" and Cyrillic "х"/"×" tolerated):
//   "80 8"            → defaultSets uniform sets of 80×8
//   "80x8"            → same
//   "3x80x8"          → 3 uniform sets of 80×8
//   "80 8,7,6"        → 3 sets @80 kg with 8/7/6 reps
//   "80x8 80x7 75x10" → fully explicit per-set list (space or comma separated)
//   "12,10,8"         → bodyweight only: reps per set @0 kg
//   "12"              → bodyweight: defaultSets sets of 12 reps; weighted: weight-only →
//                       the caller falls back to asking reps (kind "weight")
import type { SetEntry } from "../types";

export interface SetLineOpts {
  defaultSets: number; // plan's set count, used when the line doesn't state one
  bodyweight?: boolean; // plan prescribes bodyweight → a bare number means reps
}

export type SetLineResult =
  | { kind: "sets"; sets: SetEntry[] }
  | { kind: "weight"; weight: number } // partial input — ask reps next
  | null;

const MAX_SETS = 20;

function okWeight(w: number): boolean {
  return Number.isFinite(w) && w >= 0 && w <= 1000;
}
function okReps(r: number): boolean {
  return Number.isInteger(r) && r >= 1 && r <= 1000;
}

/** Normalize separators: Cyrillic х/Х and × → x, strip units, commas keep, collapse spaces. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[х×*]/g, "x")
    .replace(/kg|кг/g, " ")
    .replace(/[;]/g, ",")
    .replace(/\s*,\s*/g, ",") // glue "25, 20, 12" / "25 , 20" → "25,20,12" so the reps-list forms match
    .replace(/rpe\s*|рпе\s*/g, "@") // canonicalize "rpe 8" / "рпе8" → "@8" so parseSetLine can strip it
    .replace(/\s*x\s*/g, "x") // "80 x 8" / "3x80 x8" (unit stripping leaves gaps) → glued
    .replace(/\s+/g, " ")
    .trim();
}

// 0.0 .. 10.0 sanity so "@11" or "@99" doesn't get treated as an RPE.
function okRpe(v: number): boolean {
  return Number.isFinite(v) && v > 0 && v <= 10;
}

// Peel any "@N" tokens out of a pair-list line and return them alongside the RPE-stripped body.
// Trailing shared "@N" (line-level) is separate; this only handles the per-pair form.
function stripPairRpes(tokens: string[]): { pairs: string[]; rpes: (number | undefined)[] } {
  const pairs: string[] = [];
  const rpes: (number | undefined)[] = [];
  for (const raw of tokens) {
    const m = /^(\d+(?:\.\d+)?x\d+)(?:@(\d{1,2}(?:\.\d)?))?$/.exec(raw);
    if (!m) return { pairs: tokens, rpes: [] };
    pairs.push(m[1]);
    const r = m[2] !== undefined ? parseFloat(m[2]) : undefined;
    rpes.push(r !== undefined && okRpe(r) ? r : undefined);
  }
  return { pairs, rpes };
}

export function parseSetLine(text: string, opts: SetLineOpts): SetLineResult {
  // Line-level RPE ("80x8 80x7 rpe 8") applies uniformly to every set unless a per-pair RPE
  // ("80x8@8 80x6@9") is given — the per-pair form wins.
  const rawNorm = normalize(text);
  let lineRpe: number | undefined;
  const lineRpeMatch = /(?:^|\s)@(\d{1,2}(?:\.\d)?)$/.exec(rawNorm);
  const withoutLineRpe = lineRpeMatch ? rawNorm.slice(0, lineRpeMatch.index).trim() : rawNorm;
  if (lineRpeMatch) {
    const v = parseFloat(lineRpeMatch[1]);
    if (okRpe(v)) lineRpe = v;
  }
  const s = withoutLineRpe;
  if (!s) return null;
  const defaultSets = Math.min(MAX_SETS, Math.max(1, opts.defaultSets || 3));

  // Explicit per-set pairs: "80x8 80x7 75x10" (or comma-separated), each optionally "@RPE".
  const pairTokens = s.split(/[\s,]+/).filter(Boolean);
  if (pairTokens.length >= 2 && pairTokens.every((p) => /^\d+(?:\.\d+)?x\d+(?:@\d{1,2}(?:\.\d)?)?$/.test(p))) {
    const { pairs, rpes } = stripPairRpes(pairTokens);
    const sets = pairs.map((p, i) => {
      const [w, r] = p.split("x").map(Number);
      const rpe = rpes[i] ?? lineRpe;
      return { weight: w, reps: Math.round(r), ...(rpe !== undefined ? { rpe } : {}) };
    });
    if (sets.length > MAX_SETS || !sets.every((x) => okWeight(x.weight) && okReps(x.reps))) return null;
    return { kind: "sets", sets };
  }

  // "NxWxR" — sets × weight × reps.
  let m = /^(\d{1,2})x(\d+(?:\.\d+)?)x(\d+)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const weight = Number(m[2]);
    const reps = Math.round(Number(m[3]));
    if (n < 1 || n > MAX_SETS || !okWeight(weight) || !okReps(reps)) return null;
    return { kind: "sets", sets: Array.from({ length: n }, () => ({ weight, reps, ...(lineRpe !== undefined ? { rpe: lineRpe } : {}) })) };
  }

  // "W R1,R2,R3" — one weight, per-set reps list (also "WxR1,R2,R3").
  m = /^(\d+(?:\.\d+)?)[x ]((?:\d+)(?:,\d+)+)$/.exec(s);
  if (m) {
    const weight = Number(m[1]);
    const reps = m[2].split(",").map((r) => Math.round(Number(r)));
    if (!okWeight(weight) || reps.length > MAX_SETS || !reps.every(okReps)) return null;
    return { kind: "sets", sets: reps.map((r) => ({ weight, reps: r, ...(lineRpe !== undefined ? { rpe: lineRpe } : {}) })) };
  }

  // "W R" / "WxR" — uniform defaultSets sets.
  m = /^(\d+(?:\.\d+)?)[x ](\d+)$/.exec(s);
  if (m) {
    const weight = Number(m[1]);
    const reps = Math.round(Number(m[2]));
    if (!okWeight(weight) || !okReps(reps)) return null;
    return { kind: "sets", sets: Array.from({ length: defaultSets }, () => ({ weight, reps, ...(lineRpe !== undefined ? { rpe: lineRpe } : {}) })) };
  }

  // Bodyweight reps list: "12,10,8".
  if (opts.bodyweight && /^\d+(?:,\d+)+$/.test(s)) {
    const reps = s.split(",").map((r) => Math.round(Number(r)));
    if (reps.length > MAX_SETS || !reps.every(okReps)) return null;
    return { kind: "sets", sets: reps.map((r) => ({ weight: 0, reps: r, ...(lineRpe !== undefined ? { rpe: lineRpe } : {}) })) };
  }

  // Bare number: bodyweight → reps; weighted → treat as weight, caller asks reps.
  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (opts.bodyweight) {
      const reps = Math.round(n);
      if (!okReps(reps)) return null;
      return { kind: "sets", sets: Array.from({ length: defaultSets }, () => ({ weight: 0, reps, ...(lineRpe !== undefined ? { rpe: lineRpe } : {}) })) };
    }
    if (!okWeight(n)) return null;
    return { kind: "weight", weight: n };
  }

  return null;
}

/** Parse a single-set correction: "7" → reps only; "75x7" / "75 7" → weight + reps;
 *  optional trailing "@N" attaches an RPE (also accepts "rpe N"). */
export function parseSetEdit(text: string): { weight?: number; reps: number; rpe?: number } | null {
  const raw = normalize(text);
  let rpe: number | undefined;
  const rpeMatch = /(?:^|\s)@(\d{1,2}(?:\.\d)?)$/.exec(raw);
  const s = rpeMatch ? raw.slice(0, rpeMatch.index).trim() : raw;
  if (rpeMatch) {
    const v = parseFloat(rpeMatch[1]);
    if (okRpe(v)) rpe = v;
  }
  let m = /^(\d+(?:\.\d+)?)[x ](\d+)$/.exec(s);
  if (m) {
    const weight = Number(m[1]);
    const reps = Math.round(Number(m[2]));
    return okWeight(weight) && okReps(reps) ? { weight, reps, ...(rpe !== undefined ? { rpe } : {}) } : null;
  }
  m = /^(\d+)$/.exec(s);
  if (m) {
    const reps = Math.round(Number(m[1]));
    return okReps(reps) ? { reps, ...(rpe !== undefined ? { rpe } : {}) } : null;
  }
  return null;
}
