// Body-map data: the dashboard's weekly volume (six coarse regions, src/domain/analysis.ts) and a
// single exercise's muscles (./exerciseMuscles.ts), both turned into coloured parts for the figure
// (react-muscle-highlighter). Pure, so the mapping is unit-tested (test/mini-app-body-map.test.ts).
import type { ExerciseMuscles, Slug } from "./exerciseMuscles";

export type Region = "chest" | "back" | "legs" | "shoulders" | "arms" | "core";
export type Zone = "below" | "optimal" | "above";

export const REGION_MUSCLES: Record<Region, Slug[]> = {
  chest: ["chest"],
  back: ["upper-back", "trapezius", "lower-back"],
  legs: ["quadriceps", "hamstring", "gluteal", "calves", "adductors", "tibialis"],
  shoulders: ["deltoids"],
  arms: ["biceps", "triceps", "forearm"],
  core: ["abs", "obliques"],
};

export const ZONE_COLORS: Record<Zone, string> = { below: "#7d879b", optimal: "#ff5f3d", above: "#ffb020" };
export const PRIMARY_COLOR = "#ff5f3d";
export const SECONDARY_COLOR = "#ffb4a1";

export interface Part { slug: Slug; color: string }

export function weekParts(volume: Array<{ group: string; sets: number; zone: string }>): Part[] {
  return volume.flatMap((item) => {
    const slugs = REGION_MUSCLES[item.group as Region];
    const color = ZONE_COLORS[item.zone as Zone];
    if (!slugs || !color || item.sets <= 0) return [];
    return slugs.map((slug) => ({ slug, color }));
  });
}

export function exerciseParts(muscles: ExerciseMuscles): Part[] {
  return [
    ...muscles.primary.map((slug) => ({ slug, color: PRIMARY_COLOR })),
    ...muscles.secondary.map((slug) => ({ slug, color: SECONDARY_COLOR })),
  ];
}

export function regionOfMuscle(slug: string): Region | null {
  for (const [region, slugs] of Object.entries(REGION_MUSCLES) as Array<[Region, Slug[]]>) {
    if (slugs.includes(slug as Slug)) return region;
  }
  return null;
}

/** Distinct exercise names from the calendar's logged days, newest first. */
export function recentExerciseNames(logs: Array<{ date: string; ex: Array<{ n: string }> }>, limit = 16): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const log of [...logs].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    for (const e of log.ex) {
      const key = e.n.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(e.n.trim());
      if (out.length >= limit) return out;
    }
  }
  return out;
}
