// Maps the dashboard's weekly volume (6 coarse regions, src/domain/analysis.ts) onto the muscles
// of the body-map figure. Pure, so the mapping is unit-tested (test/mini-app-body-map.test.ts).
import type { Muscle } from "react-body-highlighter";

export type Region = "chest" | "back" | "legs" | "shoulders" | "arms" | "core";
export type Zone = "below" | "optimal" | "above";

export const REGION_MUSCLES: Record<Region, Muscle[]> = {
  chest: ["chest"],
  back: ["trapezius", "upper-back", "lower-back"],
  legs: ["quadriceps", "hamstring", "gluteal", "calves", "adductor", "abductors", "left-soleus", "right-soleus"],
  shoulders: ["front-deltoids", "back-deltoids"],
  arms: ["biceps", "triceps", "forearm"],
  core: ["abs", "obliques"],
};

// The figure colours a muscle by highlightedColors[frequency - 1]; one entry per region with a
// zone-derived "frequency" turns that into a zone colour.
export const ZONE_FREQUENCY: Record<Zone, number> = { below: 1, optimal: 2, above: 3 };

export function bodyMapData(volume: Array<{ group: string; sets: number; zone: string }>): Array<{ name: string; muscles: Muscle[]; frequency: number }> {
  return volume.flatMap((item) => {
    const muscles = REGION_MUSCLES[item.group as Region];
    const frequency = ZONE_FREQUENCY[item.zone as Zone];
    if (!muscles || !frequency || item.sets <= 0) return [];
    return [{ name: item.group, muscles, frequency }];
  });
}

export function regionOfMuscle(muscle: Muscle): Region | null {
  for (const [region, muscles] of Object.entries(REGION_MUSCLES) as Array<[Region, Muscle[]]>) {
    if (muscles.includes(muscle)) return region;
  }
  return null;
}
