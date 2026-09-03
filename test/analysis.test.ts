import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyVolume, projectWeight, stalledLifts, VOLUME_LANDMARKS } from "../src/domain/analysis";
import type { StrengthRecordDoc, WorkoutLogDoc } from "../src/types";

const wlog = (date: string, completed: boolean, exercises: { name: string; sets: number; skipped?: boolean }[]): WorkoutLogDoc => ({
  userId: 1,
  date,
  weekday: 1,
  completed,
  createdAt: new Date(0),
  exercises: exercises.map((e) => ({
    name: e.name,
    skipped: e.skipped ?? false,
    setsDone: Array.from({ length: e.sets }, () => ({ reps: 10, weight: 50 })),
  })),
});

test("weeklyVolume: sums sets per muscle group within the window", () => {
  const logs = [
    wlog("2026-06-20", true, [{ name: "Bench Press", sets: 4 }, { name: "Squat", sets: 5 }]),
    wlog("2026-06-22", true, [{ name: "Bench Press", sets: 3 }]),
    wlog("2026-06-10", true, [{ name: "Bench Press", sets: 9 }]), // before window → ignored
  ];
  const v = weeklyVolume(logs, "2026-06-17");
  const chest = v.find((x) => x.group === "chest")!;
  assert.equal(chest.sets, 7); // 4 + 3, not the older 9
  const legs = v.find((x) => x.group === "legs")!;
  assert.equal(legs.sets, 5);
});

test("weeklyVolume: skips incomplete sessions and skipped/unmapped exercises", () => {
  const logs = [
    wlog("2026-06-20", false, [{ name: "Bench Press", sets: 4 }]), // not completed
    wlog("2026-06-21", true, [{ name: "Bench Press", sets: 4, skipped: true }]), // skipped
    wlog("2026-06-21", true, [{ name: "Some Random Thing", sets: 4 }]), // unmapped
  ];
  const v = weeklyVolume(logs, "2026-06-17");
  assert.equal(v.find((x) => x.group === "chest")!.sets, 0);
});

test("weeklyVolume: classifies zones against landmarks", () => {
  const lm = VOLUME_LANDMARKS.chest; // mev 10 mav 22
  const below = weeklyVolume([wlog("2026-06-20", true, [{ name: "Bench Press", sets: lm.mev - 1 }])], "2026-06-17");
  assert.equal(below.find((x) => x.group === "chest")!.zone, "below");
  const optimal = weeklyVolume([wlog("2026-06-20", true, [{ name: "Bench Press", sets: lm.mev }])], "2026-06-17");
  assert.equal(optimal.find((x) => x.group === "chest")!.zone, "optimal");
  const above = weeklyVolume([wlog("2026-06-20", true, [{ name: "Bench Press", sets: lm.mav + 1 }])], "2026-06-17");
  assert.equal(above.find((x) => x.group === "chest")!.zone, "above");
});

test("projectWeight: estimates ETA on a losing trend toward a lower goal", () => {
  const weights = [
    { date: "2026-06-01", weight: 80 },
    { date: "2026-06-08", weight: 79 },
    { date: "2026-06-15", weight: 78 },
  ]; // -1 kg/week
  const p = projectWeight(weights, 75)!;
  assert.ok(p);
  assert.equal(p.slopePerWeek, -1);
  assert.equal(p.onTrack, true);
  assert.equal(p.reached, false);
  assert.equal(p.etaWeeks, 3); // 78 → 75 at 1/week
});

test("projectWeight: not on track when trend moves away from goal", () => {
  const weights = [
    { date: "2026-06-01", weight: 78 },
    { date: "2026-06-15", weight: 80 },
  ]; // gaining
  const p = projectWeight(weights, 75)!; // wants to lose
  assert.equal(p.onTrack, false);
  assert.equal(p.etaWeeks, undefined);
});

test("projectWeight: reached when already at goal", () => {
  const p = projectWeight([{ date: "2026-06-01", weight: 75 }, { date: "2026-06-15", weight: 75 }], 75)!;
  assert.equal(p.reached, true);
  assert.equal(p.onTrack, true);
});

test("projectWeight: null with insufficient data", () => {
  assert.equal(projectWeight([{ date: "2026-06-01", weight: 80 }], 75), null);
  assert.equal(projectWeight([], 75), null);
});

const srec = (exercise: string, history: { date: string; weight: number; reps: number }[], metric: "reps" | "time" = "reps"): StrengthRecordDoc => ({
  userId: 1,
  exercise,
  bestWeight: Math.max(0, ...history.map((h) => h.weight)),
  bestReps: history[0]?.reps ?? 0,
  bestSeconds: 0,
  bestMeters: 0,
  metric,
  history,
  updatedAt: new Date(0),
});

test("stalledLifts: flags a lift with no recent e1RM improvement", () => {
  const stalled = srec("Bench Press", [
    { date: "2026-06-04", weight: 100, reps: 5 }, // prior window (24d ago)
    { date: "2026-06-10", weight: 100, reps: 5 }, // prior window (18d ago)
    { date: "2026-06-22", weight: 100, reps: 5 }, // recent (6d ago) — no gain
    { date: "2026-06-26", weight: 100, reps: 5 }, // recent (2d ago) — no gain
  ]);
  assert.deepEqual(stalledLifts([stalled], "2026-06-28"), ["Bench Press"]);
});

test("stalledLifts: adding weight with a rep reset is progress, not a plateau", () => {
  // Classic double progression: 100×10 (e1RM ~133) → 105×6/7 (heavier top set, lower e1RM).
  // The estimated 1RM dips after the rep reset, but the working weight went UP — must NOT flag.
  const bumped = srec("Bench Press", [
    { date: "2026-06-02", weight: 100, reps: 10 }, // prior (26d)
    { date: "2026-06-05", weight: 100, reps: 10 }, // prior (23d)
    { date: "2026-06-20", weight: 105, reps: 6 }, // recent (8d) — heavier
    { date: "2026-06-26", weight: 105, reps: 7 }, // recent (2d) — heavier
  ]);
  assert.deepEqual(stalledLifts([bumped], "2026-06-28"), []);
});

test("stalledLifts: a lift that's still progressing is not flagged", () => {
  const progressing = srec("Squat", [
    { date: "2026-06-04", weight: 100, reps: 5 },
    { date: "2026-06-10", weight: 100, reps: 5 },
    { date: "2026-06-22", weight: 110, reps: 5 }, // recent PR
    { date: "2026-06-26", weight: 112, reps: 5 },
  ]);
  assert.deepEqual(stalledLifts([progressing], "2026-06-28"), []);
});

test("stalledLifts: ignores lifts with too few recent sessions and non-rep metrics", () => {
  const sparse = srec("Deadlift", [{ date: "2026-06-26", weight: 150, reps: 3 }]);
  assert.deepEqual(stalledLifts([sparse], "2026-06-28"), []);
  const timed = srec("Plank", [
    { date: "2026-06-10", weight: 0, reps: 0 },
    { date: "2026-06-22", weight: 0, reps: 0 },
    { date: "2026-06-26", weight: 0, reps: 0 },
  ], "time");
  assert.deepEqual(stalledLifts([timed], "2026-06-28"), []);
});
