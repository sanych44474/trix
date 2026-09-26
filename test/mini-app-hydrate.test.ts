// Re-opening an already-logged day rebuilds the logger from the server's saved log
// (apps/mini-app/src/logic/hydrate.ts). It used to match saved entries to the plan by name only,
// so a swapped exercise vanished and the plan's original came back empty -- the user saw
// "exercises I didn't do" and re-logged the whole session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hydrateSaved } from "../apps/mini-app/src/logic/hydrate";
import type { WorkoutToday } from "../apps/mini-app/src/types";

const plan = (names: string[]): WorkoutToday["exercises"] =>
  names.map((name, index) => ({ index, name, metric: "reps", sets: 3, reps: 10, restSec: 90 }));
const set = (w: number, r: number) => ({ w, r, sec: 0, m: 0 });

test("no saved log leaves the plan untouched", () => {
  const data: WorkoutToday = { date: "2026-09-25", weekday: 5, exercises: plan(["A", "B"]) };
  assert.equal(hydrateSaved(data), data);
});

test("a swapped exercise survives and replaces its plan slot", () => {
  const data: WorkoutToday = { date: "2026-09-25", weekday: 5, exercises: plan(["A", "B", "C"]), saved: [
    { name: "X", rpe: 8, sets: [set(20, 10), set(20, 9)] },
    { name: "B", sets: [set(30, 8)] },
  ] };
  const out = hydrateSaved(data).exercises;
  assert.deepEqual(out.map((e) => e.name), ["X", "B", "C"]);
  assert.deepEqual(out.map((e) => e.index), [0, 1, 2]);
  assert.equal(out[0].setsDone?.length, 2);
  assert.equal(out[0].rpe, 8);
  assert.equal(out[1].restSec, 90, "matched entries keep plan metadata");
  assert.equal(out[2].setsDone, undefined, "unlogged plan exercise stays open to continue");
});

test("a fully swapped session shows only what was done", () => {
  const data: WorkoutToday = { date: "2026-09-25", weekday: 5, exercises: plan(["A", "B"]), saved: [
    { name: "X", sets: [set(10, 10)] },
    { name: "Y", sets: [set(10, 10)] },
  ] };
  assert.deepEqual(hydrateSaved(data).exercises.map((e) => e.name), ["X", "Y"]);
});

test("metric is inferred for standalone entries", () => {
  const data: WorkoutToday = { date: "2026-09-25", weekday: 5, exercises: [], saved: [
    { name: "Plank", sets: [{ w: 0, r: 0, sec: 60, m: 0 }] },
    { name: "Row", sets: [{ w: 0, r: 0, sec: 0, m: 500 }] },
  ] };
  assert.deepEqual(hydrateSaved(data).exercises.map((e) => e.metric), ["time", "distance"]);
});
