// A per-100 g nutrition row is only worth keeping if it could be a real food. Values come from
// outside (Open Food Facts, FatSecret, an AI) and are remembered for the next search, so one bad
// row (a kJ number typed as kcal, a per-serving value read as per-100 g) would be offered to
// everyone. Nothing has more than 900 kcal per 100 g (pure fat is about 884), and nothing has more
// than 100 g of any one macro in 100 g.
export const MAX_KCAL_PER_100G = 900;
export const MAX_MACRO_G_PER_100G = 100;

interface Per100 { kcal: number; p: number; f: number; c: number }

const inRange = (v: number, max: number) => Number.isFinite(v) && v >= 0 && v <= max;

export function plausiblePer100(x: Per100): boolean {
  return Number.isFinite(x.kcal) && x.kcal > 0 && x.kcal <= MAX_KCAL_PER_100G
    && inRange(x.p, MAX_MACRO_G_PER_100G) && inRange(x.f, MAX_MACRO_G_PER_100G) && inRange(x.c, MAX_MACRO_G_PER_100G);
}
