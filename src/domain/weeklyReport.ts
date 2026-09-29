// The Sunday digest's muscle part: how balanced the week was (a 0–100 score), what lagged, one
// thing to focus on next week, the badges it earns, and the per-muscle zones the digest's body
// map picture is drawn from (src/render/bodyMapPng.ts via the signed /weekmap.png link).
// Pure; test/weekly-report.test.ts.
import { musclesForExercise, type Slug } from "./exerciseMuscles";
import { KEY_MUSCLES, SUGGESTED_EXERCISE, TRACKED_MUSCLES, weeklyMuscleSets, type LoggedDay, type Lookup } from "./muscleLoad";

export type Zone = "n" | "b" | "o" | "a"; // none, below MEV, optimal, above MAV

export const ZONE_COLORS: Record<Exclude<Zone, "n">, string> = { b: "#7d879b", o: "#ff5f3d", a: "#ffb020" };

export interface WeeklyReport {
  balance: number; // 0–100: each key muscle's share of its minimum, averaged (abs: trained or not)
  fullBody: boolean; // every key muscle got at least one set
  allInRange: boolean; // every key muscle with a minimum got at least that minimum (MEV); going over MAV
  // is common for glutes/delts from compound lifts and isn't held against the week
  lagging: Array<{ slug: Slug; sets: number; mev: number }>; // furthest below the minimum first, ≤ 2
  focus?: { slug: Slug; exercise: { uk: string; en: string } }; // the one to fix next week
  zones: string; // one Zone char per TRACKED_MUSCLES entry, for the picture
  trainedSets: number; // fractional sets across all muscles (0 = nothing logged)
}

export function weeklyReport(logs: LoggedDay[], since: string, lookup: Lookup = musclesForExercise): WeeklyReport {
  const week = weeklyMuscleSets(logs, since, lookup);
  const get = (slug: Slug) => week.find((m) => m.slug === slug)!;
  const keys = KEY_MUSCLES.map(get);
  const credit = keys.map((m) => (m.mev > 0 ? Math.min(1, m.sets / m.mev) : m.sets >= 1 ? 1 : 0));
  const balance = Math.round((credit.reduce((a, b) => a + b, 0) / keys.length) * 100);
  const withMin = keys.filter((m) => m.mev > 0);
  const lagging = withMin
    .filter((m) => m.sets < m.mev)
    .sort((a, b) => a.sets / a.mev - b.sets / b.mev)
    .slice(0, 2)
    .map((m) => ({ slug: m.slug, sets: m.sets, mev: m.mev }));
  const focusSlug = lagging[0]?.slug;
  const exercise = focusSlug ? SUGGESTED_EXERCISE[focusSlug] : undefined;
  const zoneOf = (sets: number, zone: string): Zone => (sets <= 0 ? "n" : zone === "below" ? "b" : zone === "above" ? "a" : "o");
  return {
    balance,
    fullBody: keys.every((m) => m.sets >= 1),
    allInRange: withMin.every((m) => m.sets >= m.mev),
    lagging,
    ...(focusSlug && exercise ? { focus: { slug: focusSlug, exercise } } : {}),
    zones: TRACKED_MUSCLES.map((s) => { const m = get(s); return zoneOf(m.sets, m.zone); }).join(""),
    trainedSets: week.reduce((a, m) => a + m.sets, 0),
  };
}

/** The picture's colours back from the zone string (what the signed image link carries). */
export function zonesToColors(zones: string): Record<string, string> {
  const out: Record<string, string> = {};
  TRACKED_MUSCLES.forEach((slug, i) => {
    const z = zones[i] as Zone | undefined;
    if (z && z !== "n" && ZONE_COLORS[z]) out[slug] = ZONE_COLORS[z];
  });
  return out;
}

/** Consecutive balanced weeks after this one (reset on any unbalanced week). */
export function nextBalanceStreak(previous: number | undefined, allInRange: boolean): number {
  return allInRange ? (previous ?? 0) + 1 : 0;
}
