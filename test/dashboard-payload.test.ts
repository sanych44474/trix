import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblePayload, isoDaysBefore, isoWeekdayOf } from "../src/webapp/dashboard";
import type { BodyLogDoc, NutritionLogDoc, StrengthRecordDoc, UserDoc, WorkoutLogDoc } from "../src/types";

// 2026-07-01 is a Wednesday (ISO weekday 3).
const TODAY = "2026-07-01";

const user = (over: Partial<UserDoc["profile"]> = {}): UserDoc =>
  ({
    _id: 1,
    chatId: 1,
    lang: "en",
    onboarded: true,
    role: "solo",
    profile: { trainingWeekdays: [1, 3], timezone: "UTC", ...over },
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 230 },
    session: { mode: "idle" },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }) as UserDoc;

const wlog = (date: string, completed = true, name = "Bench Press", sets = 4): WorkoutLogDoc => ({
  userId: 1,
  date,
  weekday: isoWeekdayOf(date),
  completed,
  createdAt: new Date(0),
  exercises: [{ name, skipped: false, setsDone: Array.from({ length: sets }, () => ({ reps: 8, weight: 60 })) }],
});

const nlog = (date: string, kcal: number, protein: number): NutritionLogDoc => ({
  userId: 1,
  date,
  meals: [
    { desc: "a", kcal: kcal / 2, protein: protein / 2, fats: 10, carbs: 30 },
    { desc: "b", kcal: kcal / 2, protein: protein / 2, fats: 10, carbs: 30 },
  ],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const strength = (exercise: string, hist: [string, number, number][]): StrengthRecordDoc => ({
  userId: 1,
  exercise,
  bestWeight: Math.max(...hist.map((h) => h[1])),
  bestReps: 5,
  bestSeconds: 0,
  bestMeters: 0,
  metric: "reps",
  history: hist.map(([date, weight, reps]) => ({ date, weight, reps })),
  updatedAt: new Date(0),
});

const body = (date: string, weight: number): BodyLogDoc => ({ userId: 1, date, weight, createdAt: new Date(0) });

const empty = { bodyLogs: [], workouts: [], records: [], nutrition: [], plan: null };

test("isoDaysBefore / isoWeekdayOf: date math", () => {
  assert.equal(isoDaysBefore(TODAY, 1), "2026-06-30");
  assert.equal(isoDaysBefore(TODAY, 31), "2026-05-31");
  assert.equal(isoWeekdayOf(TODAY), 3); // Wed
  assert.equal(isoWeekdayOf("2026-06-28"), 7); // Sun
});

test("calendar: done / missed / rest classification", () => {
  const p = assemblePayload(user(), TODAY, { ...empty, workouts: [wlog("2026-06-29")] });
  const byDate = new Map(p.calendar.days.map((d) => [d.date, d.s]));
  assert.equal(p.calendar.days.length, 84);
  assert.equal(byDate.get("2026-06-29"), "done"); // Mon, logged
  assert.equal(byDate.get("2026-06-24"), "missed"); // past Wed, planned, no log
  assert.equal(byDate.get("2026-06-28"), "rest"); // Sun, not planned
  assert.equal(byDate.get(TODAY), "rest"); // today never counts as missed
});

test("volume: only the last 7 days feed the weekly sets", () => {
  const p = assemblePayload(user(), TODAY, {
    ...empty,
    workouts: [wlog("2026-06-29", true, "Bench Press", 4), wlog("2026-06-10", true, "Bench Press", 9)],
  });
  const chest = p.volume.find((v) => v.group === "chest")!;
  assert.equal(chest.sets, 4);
});

test("exercises: reps-metric only, e1RM computed, needs 2+ points", () => {
  const p = assemblePayload(user(), TODAY, {
    ...empty,
    records: [
      strength("Squat", [["2026-06-01", 100, 5], ["2026-06-15", 105, 5]]),
      strength("One-shot", [["2026-06-01", 50, 5]]), // 1 point → dropped
    ],
  });
  assert.equal(p.exercises.length, 1);
  assert.equal(p.exercises[0].name, "Squat");
  assert.equal(p.exercises[0].points[0].e1rm, 116.7); // 100*(1+5/30)
});

test("macros: 7 day sums with training flags and targets passthrough", () => {
  const p = assemblePayload(user(), TODAY, { ...empty, nutrition: [nlog("2026-06-30", 1800, 120)] });
  assert.equal(p.macros.days.length, 7);
  const tue = p.macros.days.find((d) => d.date === "2026-06-30")!;
  assert.equal(tue.kcal, 1800);
  assert.equal(tue.p, 120);
  assert.equal(tue.training, false); // Tue not in [Mon, Wed]
  assert.equal(p.macros.days.find((d) => d.date === TODAY)!.training, true); // Wed
  assert.equal(p.macros.targets?.calories, 2200);
});

test("weight: points + goal projection passthrough", () => {
  const p = assemblePayload(user({ goalWeight: 78 }), TODAY, {
    ...empty,
    bodyLogs: [body("2026-06-01", 84), body("2026-06-15", 83), body("2026-06-29", 82)],
  });
  assert.equal(p.weight.points.length, 3);
  assert.equal(p.weight.goal, 78);
  assert.ok(p.weight.projection);
  assert.ok(p.weight.projection!.onTrack);
  assert.ok(p.weight.projection!.slopePerWeek < 0);
});
