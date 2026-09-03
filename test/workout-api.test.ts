import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleWorkoutCopy, assembleWorkoutHistory, assembleWorkoutToday, buildRawText, validateSaveBody } from "../src/webapp/workout";
import type { PlanDoc, WorkoutLogDoc } from "../src/types";

const TODAY = "2026-07-10";

function planWith(exercises: PlanDoc["split"][number]["exercises"]): PlanDoc {
  return {
    id: 1,
    userId: 1,
    active: true,
    split: [{ weekday: 5, muscleGroup: "Push", exercises }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [],
    methodology: "",
    generatedAt: TODAY,
  } as unknown as PlanDoc;
}

const BENCH = { name: "Bench Press", sets: "4 × 8–10", startWeight: "50 kg", technique: "" };
const PLANK = { name: "Plank", sets: "3 × 40s", startWeight: "Bodyweight", technique: "", metric: "time" as const };

test("assembleWorkoutToday: rest day when no plan or no day", () => {
  const p = assembleWorkoutToday(null, TODAY, 5, null);
  assert.equal(p.restDay, true);
  assert.equal(p.alreadyLogged, false);
  assert.deepEqual(p.exercises, []);
  // Plan exists but today (weekday 3) has no day entry.
  const p2 = assembleWorkoutToday(planWith([BENCH]), TODAY, 3, null);
  assert.equal(p2.restDay, true);
});

test("assembleWorkoutToday: prefills sets/reps/weight from the plan strings", () => {
  const p = assembleWorkoutToday(planWith([BENCH, PLANK]), TODAY, 5, null);
  assert.equal(p.restDay, false);
  assert.equal(p.muscleGroup, "Push");
  const b = p.exercises[0];
  assert.equal(b.name, "Bench Press");
  assert.equal(b.metric, "reps");
  assert.equal(b.sets, 4);
  assert.equal(b.reps, 9); // mid of 8–10
  assert.equal(b.weightKg, 50);
  assert.equal(b.planSets, "4 × 8–10");
  assert.equal(p.exercises[1].metric, "time");
  assert.equal(p.exercises[1].weightKg, 0);
});

test("assembleWorkoutToday: technique and video ride into the payload when available", () => {
  const withTech = { ...BENCH, technique: "Keep the bar over mid-foot." };
  const videos = new Map([
    ["bench press", { normalizedName: "bench press", exerciseName: "Bench Press", videoId: "x", url: "https://w/v?u=abc", title: "Bench 101", channelName: null, thumbnailUrl: null, locked: false }],
  ]);
  const p = assembleWorkoutToday(planWith([withTech]), TODAY, 5, null, videos);
  assert.equal(p.exercises[0].technique, "Keep the bar over mid-foot.");
  assert.equal(p.exercises[0].videoUrl, "https://w/v?u=abc");
  assert.equal(p.exercises[0].videoTitle, "Bench 101");
  // No videos map → fields absent.
  const p2 = assembleWorkoutToday(planWith([BENCH]), TODAY, 5, null);
  assert.equal(p2.exercises[0].videoUrl, undefined);
});

test("assembleWorkoutToday: alreadyLogged only for a completed log, not a skip placeholder", () => {
  const done = { completed: true } as WorkoutLogDoc;
  const skip = { completed: false } as WorkoutLogDoc;
  assert.equal(assembleWorkoutToday(planWith([BENCH]), TODAY, 5, done).alreadyLogged, true);
  assert.equal(assembleWorkoutToday(planWith([BENCH]), TODAY, 5, skip).alreadyLogged, false);
});

test("validateSaveBody: normalizes a valid body", () => {
  const v = validateSaveBody({
    entries: [
      { name: "  Bench Press  ", rpe: 8.5, sets: [{ reps: 8, weight: 50 }, { reps: 8, weight: 50, rpe: 9 }] },
    ],
  });
  assert.ok(!("error" in v));
  if ("error" in v) return;
  assert.equal(v.entries.length, 1);
  assert.equal(v.entries[0].name, "Bench Press");
  assert.equal(v.entries[0].rpe, 8.5);
  assert.equal(v.entries[0].sets.length, 2);
  assert.equal(v.entries[0].sets[1].rpe, 9);
});

test("validateSaveBody: drops untouched rows and set-less exercises", () => {
  const v = validateSaveBody({
    entries: [
      { name: "Bench", sets: [{ reps: 0, weight: 0 }, { reps: 8, weight: 40 }] },
      { name: "Squat", sets: [{ reps: 0, weight: 0 }] },
    ],
  });
  assert.ok(!("error" in v));
  if ("error" in v) return;
  assert.equal(v.entries.length, 1);
  assert.equal(v.entries[0].sets.length, 1);
});

test("validateSaveBody: rejects bad shapes and bounds", () => {
  assert.ok("error" in validateSaveBody(null));
  assert.ok("error" in validateSaveBody({}));
  assert.ok("error" in validateSaveBody({ entries: [] }));
  assert.ok("error" in validateSaveBody({ entries: [{ name: "", sets: [{ reps: 5, weight: 20 }] }] }));
  assert.ok("error" in validateSaveBody({ entries: [{ name: "X", sets: [{ reps: 5000, weight: 20 }] }] }));
  assert.ok("error" in validateSaveBody({ entries: [{ name: "X", sets: [{ reps: 5, weight: 2000 }] }] }));
  // All rows empty → nothing to save.
  assert.ok("error" in validateSaveBody({ entries: [{ name: "X", sets: [{ reps: 0, weight: 0 }] }] }));
});

test("validateSaveBody: strips out-of-range optional rpe instead of failing", () => {
  const v = validateSaveBody({ entries: [{ name: "X", rpe: 11, sets: [{ reps: 5, weight: 20, rpe: -1 }] }] });
  assert.ok(!("error" in v));
  if ("error" in v) return;
  assert.equal(v.entries[0].rpe, undefined);
  assert.equal(v.entries[0].sets[0].rpe, undefined);
});

test("buildRawText matches the bot's logFinish line format", () => {
  const v = validateSaveBody({
    entries: [
      { name: "Bench", sets: [{ reps: 8, weight: 50 }, { reps: 8, weight: 50, rpe: 8 }] },
      { name: "Plank", sets: [{ reps: 0, weight: 0, seconds: 45 }] },
    ],
  });
  assert.ok(!("error" in v));
  if ("error" in v) return;
  assert.equal(buildRawText(v.entries), "Bench 50x8, 50x8@8\nPlank 45s");
});

// ---- copy-a-past-workout helpers ----

function logDoc(date: string, completed: boolean, exercises: WorkoutLogDoc["exercises"]): WorkoutLogDoc {
  return { userId: 1, date, weekday: 5, exercises, completed, createdAt: new Date(TODAY) } as unknown as WorkoutLogDoc;
}

test("assembleWorkoutHistory: lists completed past logs, skips today/empty/skipped", () => {
  const logs = [
    logDoc(TODAY, true, [{ name: "Bench", setsDone: [{ reps: 8, weight: 50 }], skipped: false }]), // today → excluded
    logDoc("2026-07-08", true, [
      { name: "Squat", setsDone: [{ reps: 5, weight: 80 }], skipped: false },
      { name: "Curl", setsDone: [], skipped: false }, // no sets → not counted
      { name: "Row", setsDone: [{ reps: 10, weight: 40 }], skipped: false },
    ]),
    logDoc("2026-07-06", false, [{ name: "Bench", setsDone: [{ reps: 8, weight: 50 }], skipped: false }]), // not completed → excluded
    logDoc("2026-07-05", true, [{ name: "Bench", setsDone: [{ reps: 8, weight: 50 }], skipped: true }]), // all skipped → excluded
  ] as unknown as WorkoutLogDoc[];
  const hist = assembleWorkoutHistory(logs, TODAY);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].date, "2026-07-08");
  assert.equal(hist[0].n, 2); // Squat + Row (Curl has no sets)
  assert.equal(hist[0].title, "Squat, Row");
});

test("assembleWorkoutCopy: maps sets to logger shape and infers metric", () => {
  const log = logDoc("2026-07-08", true, [
    { name: "Bench", setsDone: [{ reps: 8, weight: 50 }, { reps: 8, weight: 52.5, rpe: 9 }], skipped: false, rpe: 8.5 },
    { name: "Plank", setsDone: [{ reps: 0, weight: 0, seconds: 45 }], skipped: false },
    { name: "Row erg", setsDone: [{ reps: 0, weight: 0, meters: 1000, seconds: 240 }], skipped: false },
    { name: "Skipped", setsDone: [{ reps: 8, weight: 20 }], skipped: true }, // excluded
  ] as unknown as WorkoutLogDoc["exercises"]);
  const copy = assembleWorkoutCopy(log);
  assert.equal(copy.length, 3);
  assert.equal(copy[0].metric, "reps");
  assert.equal(copy[0].rpe, 8.5);
  assert.deepEqual(copy[0].sets, [{ w: 50, r: 8, sec: 0, m: 0 }, { w: 52.5, r: 8, sec: 0, m: 0 }]);
  assert.equal(copy[1].metric, "time");
  assert.equal(copy[1].sets[0].sec, 45);
  assert.equal(copy[2].metric, "distance");
  assert.equal(copy[2].sets[0].m, 1000);
});
