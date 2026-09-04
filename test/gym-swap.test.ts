import { test } from "node:test";
import assert from "node:assert/strict";
import { fitsEquipmentPreset, pickGymSwaps } from "../src/domain/gymSwap";

test("fitsEquipmentPreset: no equipment fits every preset", () => {
  assert.equal(fitsEquipmentPreset([], "bodyweight"), true);
  assert.equal(fitsEquipmentPreset([], "dumbbells"), true);
  assert.equal(fitsEquipmentPreset([], "band"), true);
});

test("fitsEquipmentPreset: trivial props (mat/wall/bench) don't disqualify bodyweight", () => {
  assert.equal(fitsEquipmentPreset(["Exercise Mat", "wall"], "bodyweight"), true);
  assert.equal(fitsEquipmentPreset(["Flat Bench"], "bodyweight"), true);
});

test("fitsEquipmentPreset: real equipment fails bodyweight-only", () => {
  assert.equal(fitsEquipmentPreset(["Barbell"], "bodyweight"), false);
  assert.equal(fitsEquipmentPreset(["dumbbell"], "bodyweight"), false);
});

test("fitsEquipmentPreset: dumbbell-tagged exercise fits the dumbbells preset, messy case included", () => {
  assert.equal(fitsEquipmentPreset(["Dumbbells"], "dumbbells"), true);
  assert.equal(fitsEquipmentPreset(["dumbbell", "flat bench"], "dumbbells"), true); // bench is trivial
  assert.equal(fitsEquipmentPreset(["Barbell"], "dumbbells"), false);
});

test("fitsEquipmentPreset: an exercise needing BOTH a band and a barbell fails the band preset", () => {
  assert.equal(fitsEquipmentPreset(["resistance band", "barbell"], "band"), false);
  assert.equal(fitsEquipmentPreset(["loop resistance band"], "band"), true);
});

function cand(id: string, muscle: string, name: string, equipments: string[]) {
  return { id, name, equipments, muscle };
}

test("pickGymSwaps: picks one fitting candidate per slot, by muscle", () => {
  const byMuscle = new Map([
    ["chest", [cand("c1", "chest", "Barbell Bench Press", ["barbell"]), cand("c2", "chest", "Push-Up", [])]],
    ["back", [cand("b1", "back", "Pull-Up", ["pull-up bar"]), cand("b2", "back", "Inverted Row", [])]],
  ]);
  const slots = [
    { index: 0, exerciseId: "orig-chest", muscle: "chest" },
    { index: 1, exerciseId: "orig-back", muscle: "back" },
  ];
  const out = pickGymSwaps(slots, byMuscle, "bodyweight");
  assert.equal(out.get(0)?.name, "Push-Up");
  assert.equal(out.get(1)?.name, "Inverted Row");
});

test("pickGymSwaps: a slot with no fitting candidate is omitted, not force-filled", () => {
  const byMuscle = new Map([["chest", [cand("c1", "chest", "Barbell Bench Press", ["barbell"])]]]);
  const out = pickGymSwaps([{ index: 0, muscle: "chest" }], byMuscle, "bodyweight");
  assert.equal(out.has(0), false);
});

test("pickGymSwaps: never picks the same replacement twice across slots", () => {
  const byMuscle = new Map([
    ["legs", [cand("l1", "legs", "Bodyweight Squat", [])]],
  ]);
  const slots = [
    { index: 0, muscle: "legs" },
    { index: 1, muscle: "legs" },
  ];
  const out = pickGymSwaps(slots, byMuscle, "bodyweight");
  assert.equal(out.size, 1); // only one candidate existed, so only one slot gets it
  assert.equal(out.get(0)?.name, "Bodyweight Squat");
});

test("pickGymSwaps: the original exercise is never offered as its own replacement", () => {
  const byMuscle = new Map([["chest", [cand("orig", "chest", "Original Exercise", [])]]]);
  const out = pickGymSwaps([{ index: 0, exerciseId: "orig", muscle: "chest" }], byMuscle, "bodyweight");
  assert.equal(out.has(0), false);
});

test("pickGymSwaps: carries canonicalName through when the candidate has one", () => {
  const byMuscle = new Map([["chest", [{ id: "c1", name: "Push-Up", canonicalName: "Push-Up", equipments: [], muscle: "chest" }]]]);
  const out = pickGymSwaps([{ index: 0, muscle: "chest" }], byMuscle, "bodyweight");
  assert.equal(out.get(0)?.canonicalName, "Push-Up");
});
