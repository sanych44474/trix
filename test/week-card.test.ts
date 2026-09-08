import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStats } from "../src/domain/weekCard";
import { buildWeekCard, computeWeekCardStats, formatWeekCardText } from "../src/bot/weekCard";
import { newDb } from "./harness";
import { getOrCreateUser, upsertWorkoutLog } from "../src/db/repos";
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

// Regression coverage for the computeWeekCardStats/formatWeekCardText split (Phase 5 item 6,
// week-card PNG export) — buildWeekCard must still produce the same shape it always did, built
// on top of the two new pieces instead of one monolithic function.
test("computeWeekCardStats: null when the week has no activity", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal(await computeWeekCardStats(db, 1, "UTC"), null);
});

test("buildWeekCard + computeWeekCardStats/formatWeekCardText agree on the same numbers", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const today = new Date().toISOString().slice(0, 10);
  await upsertWorkoutLog(db, 1, today, 2, [{ name: "Squat", setsDone: [{ weight: 100, reps: 5 }], skipped: false }], true);

  const stats = await computeWeekCardStats(db, 1, "UTC");
  assert.ok(stats);
  assert.equal(stats?.done, 1);
  assert.equal(stats?.volumeKg, 500);

  const text = formatWeekCardText(stats!, "Ann", "en");
  const full = await buildWeekCard(db, 1, "UTC", "Ann", "en");
  assert.equal(full, text); // same computation, same formatting, no drift between the two paths
  assert.match(text, /500/);
});
