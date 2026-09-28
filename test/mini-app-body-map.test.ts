import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyMapData, REGION_MUSCLES, regionOfMuscle } from "../apps/mini-app/src/logic/bodyMap";

test("body map: each trained region is coloured by its zone; untrained regions stay base", () => {
  const data = bodyMapData([
    { group: "chest", sets: 12, zone: "optimal" },
    { group: "legs", sets: 3, zone: "below" },
    { group: "arms", sets: 30, zone: "above" },
    { group: "core", sets: 0, zone: "below" },
    { group: "unknown", sets: 5, zone: "optimal" },
  ]);
  assert.deepEqual(data.map((d) => [d.name, d.frequency]), [["chest", 2], ["legs", 1], ["arms", 3]]);
});

test("body map: every muscle belongs to exactly one region, and tapping maps back", () => {
  const all = Object.values(REGION_MUSCLES).flat();
  assert.equal(new Set(all).size, all.length, "no muscle in two regions");
  assert.equal(regionOfMuscle("trapezius"), "back");
  assert.equal(regionOfMuscle("front-deltoids"), "shoulders");
  assert.equal(regionOfMuscle("head"), null);
});
