import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientSnapshot, snapshotPromptLines, SNAPSHOT_RECENT } from "../src/domain/clientSnapshot";
import type { QuestProgress } from "../src/domain/quests";
import type { LoggedExercise, Weekday } from "../src/types";

const ex = (name: string, sets: Array<[number, number]>, extra: Partial<LoggedExercise> = {}): LoggedExercise => ({
  name,
  setsDone: sets.map(([weight, reps]) => ({ weight, reps })),
  skipped: false,
  ...extra,
});

const log = (date: string, weekday: number, exercises: LoggedExercise[], extra: { completed?: boolean; durationSec?: number } = {}) => ({
  date,
  weekday: weekday as Weekday,
  exercises,
  completed: extra.completed ?? true,
  ...(extra.durationSec ? { durationSec: extra.durationSec } : {}),
});

const split = [
  { weekday: 1, muscleGroup: "Груди/Трицепс", exercises: [1, 2, 3, 4, 5] },
  { weekday: 3, muscleGroup: "Ноги", exercises: [1, 2, 3, 4] },
];

const quests: QuestProgress[] = [
  { code: "workouts", kind: "workouts", target: 3, current: 2, done: false },
  { code: "muscle_sets:hamstring", kind: "muscle_sets", muscle: "hamstring", target: 6, current: 9, done: true },
  { code: "water_days", kind: "water_days", target: 4, current: 1, done: false },
];

// Wednesday 2026-11-04; the week started Monday 2026-11-02.
const base = { today: "2026-11-04", weekStart: "2026-11-02", split, plannedDays: 2, quests };

test("snapshot: week progress counts completed workouts dated this week against planned days", () => {
  const s = buildClientSnapshot({
    ...base,
    workouts: [
      log("2026-10-30", 5, [ex("Squat", [[100, 5]])]), // last week: not this week's count
      log("2026-11-02", 1, [ex("Bench Press", [[80, 8]])]),
      log("2026-11-04", 3, [ex("Squat", [[100, 5]])], { completed: false }), // unfinished: not counted
    ],
  });
  assert.equal(s.weekDone, 1);
  assert.equal(s.weekPlanned, 2);
  assert.equal(s.daysSinceLast, 0);
});

test("snapshot: a recent workout carries the plan day's label, done/planned, duration, RPE and best sets", () => {
  const s = buildClientSnapshot({
    ...base,
    workouts: [log("2026-11-02", 1, [
      ex("Bench Press", [[70, 10], [80, 8], [80, 6]], { rpe: 8 }),
      ex("Dips", [[0, 12]]),
      ex("Cable Fly", [[20, 15]], { rpe: 9 }),
      ex("Skull Crusher", [], { skipped: true }),
    ], { durationSec: 3130 })],
  });
  assert.deepEqual(s.recent[0], {
    date: "2026-11-02",
    weekday: 1,
    label: "Груди/Трицепс",
    completed: true,
    done: 3,
    planned: 5,
    durationMin: 52,
    rpe: 9,
    top: ["Bench Press 80x8", "Dips BWx12"],
  });
});

test("snapshot: empty logs and logs outside the 14-day window are left out; newest first, capped", () => {
  const s = buildClientSnapshot({
    ...base,
    workouts: [
      log("2026-10-20", 2, [ex("Row", [[60, 10]])]), // 15 days back
      log("2026-10-26", 1, [ex("Bench Press", [[75, 8]])]),
      log("2026-10-28", 3, [ex("Squat", [[95, 5]])]),
      log("2026-10-30", 5, [ex("Deadlift", [[140, 3]])]),
      log("2026-11-01", 7, [ex("Curl", [], { skipped: true })]), // opened, nothing logged
    ],
  });
  assert.equal(s.recent.length, SNAPSHOT_RECENT);
  assert.deepEqual(s.recent.map((w) => w.date), ["2026-10-30", "2026-10-28", "2026-10-26"]);
  assert.equal(s.recent[0].planned, null, "Friday is not a plan day");
  assert.equal(s.daysSinceLast, 5);
});

test("snapshot: quests are summarised with progress capped at the target", () => {
  const s = buildClientSnapshot({ ...base, workouts: [] });
  assert.equal(s.questsDone, 1);
  assert.deepEqual(s.quests.map((q) => `${q.code}:${q.current}/${q.target}:${q.done}`), [
    "workouts:2/3:false",
    "muscle_sets:hamstring:6/6:true",
    "water_days:1/4:false",
  ]);
  assert.equal(s.daysSinceLast, null);
  assert.deepEqual(s.recent, []);
});

test("snapshot prompt lines: the AI draft gets the week, each recent workout and a long gap", () => {
  const s = buildClientSnapshot({
    ...base,
    today: "2026-11-08",
    workouts: [log("2026-11-02", 1, [ex("Bench Press", [[80, 8]])], { durationSec: 2700 })],
  });
  const text = snapshotPromptLines(s);
  assert.match(text, /This week: 1 of 2 planned workouts done; weekly quests 1\/3 done\./);
  assert.match(text, /- 2026-11-02 \(Груди\/Трицепс\): completed, 1\/5 exercises, 45 min, best sets: Bench Press 80x8/);
  assert.match(text, /Last workout was 6 days ago\./);
  assert.match(snapshotPromptLines(buildClientSnapshot({ ...base, workouts: [] })), /No workouts logged in the last 14 days\./);
});
