import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStats } from "../src/domain/weekCard";
import type { WorkoutLogDoc } from "../src/types";

function log(date: string, completed: boolean, sets: { weight: number; reps: number }[][]): WorkoutLogDoc {
  return {
    userId: 1,
    date,
    weekday: 1,
    completed,
    exercises: sets.map((s, i) => ({ name: `ex${i}`, setsDone: s, skipped: false })),
    createdAt: new Date(`${date}T10:00:00Z`),
  };
}

test("weekStats: counts done/skipped, sets and weighted volume", () => {
  const s = weekStats([
    log("2026-06-29", true, [
      [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }],
      [{ weight: 0, reps: 12 }], // bodyweight set counts as a set, adds no volume
    ]),
    log("2026-06-30", false, [[{ weight: 60, reps: 8 }]]), // skipped → nothing counted
  ]);
  assert.equal(s.done, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.totalSets, 3);
  assert.equal(s.volumeKg, 800);
});

test("weekStats: skipped exercises inside a completed log are excluded", () => {
  const l = log("2026-07-01", true, [[{ weight: 100, reps: 3 }]]);
  l.exercises.push({ name: "skipped", setsDone: [{ weight: 50, reps: 10 }], skipped: true });
  const s = weekStats([l]);
  assert.equal(s.totalSets, 1);
  assert.equal(s.volumeKg, 300);
});

test("weekStats: empty input", () => {
  assert.deepEqual(weekStats([]), { done: 0, skipped: 0, totalSets: 0, volumeKg: 0 });
});
