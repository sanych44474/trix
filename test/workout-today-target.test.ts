import { test } from "node:test";
import assert from "node:assert/strict";
import { todayTarget } from "../src/webapp/workout";

const le = (sets: Array<[number, number]>, rpe?: number) => ({ name: "Bench Press", skipped: false, setsDone: sets.map(([weight, reps]) => ({ weight, reps })), ...(rpe ? { rpe } : {}) });

test("todayTarget: add a rep below the top, the worst working set counts", () => {
  assert.deepEqual(todayTarget({ name: "Bench Press", metric: "reps", planSets: "3 × 8–12" }, le([[60, 12], [60, 11], [60, 10]])), { w: 60, r: 11, lastW: 60, lastR: 10, step: "reps" });
});

test("todayTarget: every set at the top → add load, back to the bottom of the range", () => {
  assert.deepEqual(todayTarget({ name: "Bench Press", metric: "reps", planSets: "3 × 8–12" }, le([[60, 12], [60, 12], [60, 12]])), { w: 62.5, r: 8, lastW: 60, lastR: 12, step: "load" });
});

test("todayTarget: a grind holds; time/distance exercises get none", () => {
  assert.equal(todayTarget({ name: "Bench Press", metric: "reps", planSets: "3 × 8–12" }, le([[60, 9], [60, 8]], 10))!.step, "hold");
  assert.equal(todayTarget({ name: "Plank", metric: "time", planSets: "3 × 30s" }, le([[0, 1]])), undefined);
});
