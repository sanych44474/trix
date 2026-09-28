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

/** A whole training day on the figure: a muscle is primary if any exercise drives it, secondary if
 *  it only assists. Names with no muscle data are returned so the UI can say what it left out. */
export function dayMuscles(names: string[], lookup: (name: string) => ExerciseMuscles | null): ExerciseMuscles & { unknown: string[] } {
  const primary: Slug[] = [];
  const secondary: Slug[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const m = lookup(name);
    if (!m) { unknown.push(name); continue; }
    for (const slug of m.primary) if (!primary.includes(slug)) primary.push(slug);
    for (const slug of m.secondary) if (!secondary.includes(slug)) secondary.push(slug);
  }
  return { primary, secondary: secondary.filter((slug) => !primary.includes(slug)), unknown };
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

export interface PickerGroup {
  weekday: number | null; // ISO 1..7 for a plan day; null for "recent, not in the plan"
  title: string; // the plan day's name / muscle group, empty for the recent group
  names: string[]; // exercises not already listed under an earlier day
  dayNames: string[]; // every exercise of the plan day (for "whole day"); empty for the recent group
}

/** The body map's exercise dropdown: the plan's exercises grouped by training day (Mon..Sun),
 *  then anything logged recently that the plan doesn't contain. Each name appears once. */
export function pickerGroups(
  days: Array<{ weekday: number; name?: string; muscleGroup?: string; exercises: Array<{ name: string }> }>,
  recent: string[],
): PickerGroup[] {
  const seen = new Set<string>();
  const take = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const groups: PickerGroup[] = [...days]
    .sort((a, b) => a.weekday - b.weekday)
    .map((day) => {
      const dayNames = [...new Set(day.exercises.map((e) => e.name.trim()).filter(Boolean))];
      return { weekday: day.weekday, title: day.muscleGroup || day.name || "", names: dayNames.filter(take), dayNames };
    })
    .filter((group) => group.dayNames.length > 0);
  const extra = recent.filter(take);
  if (extra.length) groups.push({ weekday: null, title: "", names: extra, dayNames: [] });
  return groups;
}
