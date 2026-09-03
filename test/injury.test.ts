import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INJURY_AREAS,
  conflictScore,
  conflictingSlots,
  isSafeCandidate,
  checkAfterDate,
  restorable,
  safeMusclesFor,
} from "../src/domain/injury";

test("every area has a rule with a non-empty safe-muscle pool", () => {
  assert.equal(INJURY_AREAS.length, 8);
  for (const area of INJURY_AREAS) assert.ok(safeMusclesFor(area).length > 0);
});

test("conflictScore: representative direct / none matches", () => {
  assert.equal(conflictScore({ name: "Barbell Bench Press" }, "shoulder"), "direct");
  assert.equal(conflictScore({ name: "Back Squat" }, "knee"), "direct");
  assert.equal(conflictScore({ name: "Deadlift" }, "lower_back"), "direct");
  assert.equal(conflictScore({ name: "Bicep Curl" }, "knee"), "none");
  assert.equal(conflictScore({ name: "Leg Press" }, "shoulder"), "none");
});

test("conflictScore: matches on catalog muscle and movementPattern too", () => {
  assert.equal(conflictScore({ name: "Machine X", muscles: "quadriceps" }, "knee"), "direct");
  assert.equal(conflictScore({ name: "Machine Y", movementPattern: "hinge" }, "lower_back"), "direct");
});

test("conflictingSlots: mild = direct only; strong also swaps related", () => {
  const split = [
    { weekday: 1, exercises: [{ name: "Bench Press" }, { name: "Chest Fly" }, { name: "Leg Press" }] },
  ];
  // shoulder: Bench Press = direct; Chest Fly = related (fly); Leg Press = none
  assert.equal(conflictingSlots(split, "shoulder", "mild").length, 1);
  assert.equal(conflictingSlots(split, "shoulder", "strong").length, 2);
});

test("isSafeCandidate: right muscle pool, rejects area-loading names", () => {
  assert.equal(isSafeCandidate({ name: "Leg Extension", muscle: "quadriceps" }, "shoulder"), true);
  assert.equal(isSafeCandidate({ name: "Overhead Press", muscle: "chest" }, "shoulder"), false); // wrong pool
  assert.equal(isSafeCandidate({ name: "Barbell Squat", muscle: "quadriceps" }, "knee"), false); // in pool but loads knee
});

test("checkAfterDate: mild +7, strong +14", () => {
  assert.equal(checkAfterDate("2026-06-01", "mild"), "2026-06-08");
  assert.equal(checkAfterDate("2026-06-01", "strong"), "2026-06-15");
});

test("restorable: only when the slot still holds the replacement", () => {
  assert.equal(restorable("Leg Extension", "leg extension"), true);
  assert.equal(restorable("Something Else", "leg extension"), false);
  assert.equal(restorable(undefined, "leg extension"), false);
});
