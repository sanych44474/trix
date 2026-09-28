// Body-fat estimate from a tape measure: the U.S. Navy circumference method (Hodgdon & Beckett,
// 1984), metric form. Typical error is around ±3-4 percentage points against DEXA -- good for a
// trend line, not a lab number, and the UI says so. Pure and unit-tested (test/body-fat.test.ts).

export interface BodyFatInput {
  sex: "male" | "female";
  heightCm: number;
  waistCm: number;
  neckCm: number;
  hipsCm?: number; // required for women
}

/** Body fat in percent, rounded to 0.1, or null when the inputs can't give a meaningful answer
 *  (missing hips for a woman, implausible circumferences, a result outside 2-60%). */
export function navyBodyFat(input: BodyFatInput): number | null {
  const { sex, heightCm, waistCm, neckCm, hipsCm } = input;
  const plausible = (v: number | undefined, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (!plausible(heightCm, 120, 230) || !plausible(waistCm, 40, 200) || !plausible(neckCm, 20, 70)) return null;
  let pct: number;
  if (sex === "male") {
    if (waistCm - neckCm <= 0) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  } else {
    if (!plausible(hipsCm, 50, 200)) return null;
    const girth = waistCm + (hipsCm as number) - neckCm;
    if (girth <= 0) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(girth) + 0.221 * Math.log10(heightCm)) - 450;
  }
  if (!Number.isFinite(pct) || pct < 2 || pct > 60) return null;
  return Math.round(pct * 10) / 10;
}

/** Newest estimate from a series of dated body logs: each measurement taken from its latest
 *  entry on or before that log, so waist today + neck last week still combine. */
export function latestBodyFat(
  logs: { date: string; measurements?: { waist?: number; neck?: number; hips?: number } }[],
  profile: { sex?: "male" | "female"; heightCm?: number },
): { date: string; pct: number } | null {
  if (!profile.sex || !profile.heightCm) return null;
  const latest: { waist?: number; neck?: number; hips?: number } = {};
  let date = "";
  for (const log of [...logs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const m = log.measurements;
    if (!m) continue;
    for (const key of ["waist", "neck", "hips"] as const) {
      const v = m[key];
      if (typeof v === "number" && v > 0) { latest[key] = v; date = log.date; }
    }
  }
  if (!latest.waist || !latest.neck) return null;
  const pct = navyBodyFat({ sex: profile.sex, heightCm: profile.heightCm, waistCm: latest.waist, neckCm: latest.neck, hipsCm: latest.hips });
  return pct === null ? null : { date, pct };
}
