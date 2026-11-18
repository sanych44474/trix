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

// ---- edges (found by mutation)

test("isSafeCandidate: a name that loads the area is rejected even in a safe muscle pool, by either list", () => {
  // knee: "squat" is a direct keyword, "hip thrust" only a related one; both pools are safe here
  assert.equal(isSafeCandidate({ name: "Barbell Squat", muscle: "chest" }, "knee"), false, "direct keyword only");
  assert.equal(isSafeCandidate({ name: "Hip Thrust", muscle: "abdominals" }, "knee"), false, "related keyword only");
  assert.equal(isSafeCandidate({ name: "Bench Press", muscle: "chest" }, "knee"), true);
  assert.equal(isSafeCandidate({ name: "BARBELL SQUAT", muscle: "chest" }, "knee"), false, "case does not matter");
  assert.equal(isSafeCandidate({ name: "", muscle: "chest" }, "knee"), true, "no name, safe pool");
  assert.equal(isSafeCandidate({ name: "Bench Press", muscle: "quadriceps" }, "knee"), false, "the pool decides first");
});

test("conflictingSlots: an exercise that does not touch the area is never swapped, at either severity", () => {
  const split = [
    { weekday: 1, exercises: [{ name: "Bench Press" }, { name: "Barbell Squat" }] },
    { weekday: 3, exercises: [{ name: "Leg Curl" }, { name: "Row" }] },
  ];
  const pick = (severity: "mild" | "strong") => conflictingSlots(split, "knee", severity).map((s) => `${s.weekday}:${s.index}:${s.exercise.name}`);
  assert.deepEqual(pick("mild"), ["1:1:Barbell Squat"], "direct only, with its day and position");
  assert.deepEqual(pick("strong"), ["1:1:Barbell Squat", "3:0:Leg Curl"], "plus related, still no bench or row");
  assert.deepEqual(conflictingSlots([], "knee", "strong"), []);
  assert.deepEqual(conflictingSlots([{ weekday: 1, exercises: [{ name: "Bench Press" }] }], "knee", "strong"), []);
});

test("checkAfterDate: a mild injury is checked after 7 days, a strong one after 14", () => {
  assert.equal(checkAfterDate("2026-06-01", "mild"), "2026-06-08");
  assert.equal(checkAfterDate("2026-06-01", "strong"), "2026-06-15");
  assert.equal(checkAfterDate("2026-12-28", "strong"), "2027-01-11", "across the year end");
});

test("restorable: only while the slot still holds the replacement, spelling and case aside", () => {
  assert.equal(restorable("Leg Extension", "leg extension"), true);
  assert.equal(restorable("  Leg Extension ", "Leg Extension"), true);
  assert.equal(restorable("Squat", "Leg Extension"), false);
  assert.equal(restorable(undefined, "Leg Extension"), false);
  assert.equal(restorable("", "Leg Extension"), false);
});
