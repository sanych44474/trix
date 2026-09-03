import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProgression,
  computePlanProgression,
  deloadSets,
  deloadWeekDue,
  evaluateProgressionRate,
  inQuietHours,
  localParts,
  nextTarget,
  normalizeExercise,
  muscleGroupOf,
  resolveWeightMode,
  parseHeightWeight,
  parseMeasurements,
  parseSteps,
  parseWorkoutText,
  parseDuration,
  parseDistance,
  exerciseMetric,
  metricOfSets,
  formatSetEntry,
  formatRecordBest,
  fmtDuration,
  fmtDistance,
  reconcileGrounding,
  shouldDeload,
  weeksSincePlan,
} from "../src/domain/progression";
import type { DailyCheckinDoc, PlanDoc, PlanExercise, WorkoutLogDoc } from "../src/types";
import { computeTargets, splitMeals, solvePortions, isPlausiblePer100g } from "../src/domain/mealplan";
import { curatedPer100g } from "../src/ai/nutritionDb";
import { cleanAi, t } from "../src/locales/i18n";
import { chunkReport } from "../src/render";

test("parseWorkoutText: name + multiple sets", () => {
  const r = parseWorkoutText("Bench press 80x6, 80x5");
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { exercise: "Bench press", weight: 80, reps: 6 });
  assert.equal(r[1].reps, 5);
});

test("parseWorkoutText: cyrillic 'х' separator and multiple lines", () => {
  const r = parseWorkoutText("Жим 60х10\nТяга 70x8");
  assert.equal(r.length, 2);
  assert.equal(r[0].weight, 60);
  assert.equal(r[1].exercise, "Тяга");
});

test("parseWorkoutText: '*' separator, multi-word names, comma sets", () => {
  const r = parseWorkoutText("жим лежачи вузьким хватом 40*20, 40*20, 40*20");
  assert.equal(r.length, 3);
  assert.equal(r[0].exercise, "жим лежачи вузьким хватом");
  assert.equal(r[0].weight, 40);
  assert.equal(r[0].reps, 20);
});

test("parseMeasurements: weight + circumferences (EN)", () => {
  const r = parseMeasurements("weight 73, waist 82, arm 38");
  assert.equal(r.weight, 73);
  assert.equal(r.measurements.waist, 82);
  assert.equal(r.measurements.arm, 38);
});

test("parseMeasurements: ukrainian keywords", () => {
  const r = parseMeasurements("вага 74.5, талія 80");
  assert.equal(r.weight, 74.5);
  assert.equal(r.measurements.waist, 80);
});

test("normalizeExercise: maps synonym to canonical", () => {
  assert.equal(normalizeExercise("bench", ["Bench Press", "Squat"]), "Bench Press");
});

test("normalizeExercise: no match -> title-cased input", () => {
  assert.equal(normalizeExercise("rows", ["Bench Press"]), "Rows");
});

test("parseHeightWeight: realistic input, swap, and rejection", () => {
  assert.deepEqual(parseHeightWeight("180 85"), { heightCm: 180, weightKg: 85 });
  assert.deepEqual(parseHeightWeight("зріст 175, вага 70.5"), { heightCm: 175, weightKg: 70.5 });
  // Weight typed first → auto-swap to the plausible order.
  assert.deepEqual(parseHeightWeight("85 180"), { heightCm: 180, weightKg: 85 });
  // Nonsense / typos → null (caller re-asks).
  assert.equal(parseHeightWeight("180 850"), null); // 850 kg implausible, 180 not a weight
  assert.equal(parseHeightWeight("17 7"), null); // both too small
  assert.equal(parseHeightWeight("180"), null); // only one number
  assert.equal(parseHeightWeight("hello"), null);
});

test("reconcileGrounding: keeps id when name matches", () => {
  const cands = [
    { id: "aaa", name: "Dumbbell Lateral Raise" },
    { id: "bbb", name: "Standing Dumbbell Shrug - Gethin Variation" },
  ];
  assert.deepEqual(reconcileGrounding("Dumbbell Lateral Raise", "aaa", cands), cands[0]);
});

test("reconcileGrounding: re-anchors a lateral raise mislinked to a shrug id", () => {
  const cands = [
    { id: "aaa", name: "Dumbbell Lateral Raise" },
    { id: "bbb", name: "Standing Dumbbell Shrug - Gethin Variation" },
  ];
  // AI described a lateral raise but grounded it to the shrug id (the Саня bug).
  assert.deepEqual(reconcileGrounding("Dumbbell Lateral Raise", "bbb", cands), cands[0]);
});

test("reconcileGrounding: drops grounding when nothing matches the AI name", () => {
  const cands = [{ id: "bbb", name: "Standing Dumbbell Shrug - Gethin Variation" }];
  assert.equal(reconcileGrounding("Dumbbell Lateral Raise", "bbb", cands), undefined);
});

test("reconcileGrounding: undefined id stays ungrounded", () => {
  assert.equal(reconcileGrounding("Pull-Up", undefined, [{ id: "x", name: "Pull-Up" }]), undefined);
});

test("nextTarget: add reps below top of range", () => {
  assert.equal(nextTarget(80, 6, false), "80 × 7");
});

test("nextTarget: add weight at top of range", () => {
  assert.equal(nextTarget(80, 12, false), "85 × 8");
  assert.equal(nextTarget(100, 12, true), "110 × 8");
});

test("parseWorkoutText: parses RPE token (@8 / rpe)", () => {
  const r = parseWorkoutText("Bench press 80x6, 80x5 @8");
  assert.equal(r.length, 2);
  assert.equal(r[0].rpe, 8);
  assert.equal(r[1].rpe, 8);
  const r2 = parseWorkoutText("Squat 100x5 rpe 9.5");
  assert.equal(r2[0].rpe, 9.5);
  // No RPE token → field is absent, not 0.
  assert.equal(parseWorkoutText("Deadlift 120x3")[0].rpe, undefined);
});

test("parseWorkoutText: cardio time and/or distance (rowing, bike, run)", () => {
  // Rowing with both axes on one line → a single set carrying seconds + meters.
  const row = parseWorkoutText("Веслування 20 хв 5 км");
  assert.equal(row.length, 1);
  assert.equal(row[0].exercise, "Веслування");
  assert.equal(row[0].weight, 0);
  assert.equal(row[0].reps, 0);
  assert.equal(row[0].seconds, 1200);
  assert.equal(row[0].meters, 5000);
  // Time only (cycling for 30 min).
  const bike = parseWorkoutText("Велотренажер 30 хв");
  assert.equal(bike[0].seconds, 1800);
  assert.equal(bike[0].meters, undefined);
  // Distance + mm:ss pace (rowing 2000 m in 8:00), English units.
  const erg = parseWorkoutText("Rowing 2000m 8:00");
  assert.equal(erg[0].meters, 2000);
  assert.equal(erg[0].seconds, 480);
  // Distance only (5 km run).
  const run = parseWorkoutText("Біг 5 км");
  assert.equal(run[0].meters, 5000);
});

test("nextTarget: RPE autoregulation", () => {
  // Overshoot (RPE ≥ 9.5) → hold the same target.
  assert.equal(nextTarget(80, 8, false, 10), "80 × 8");
  // Easy (RPE ≤ 7) below top of range → jump two reps.
  assert.equal(nextTarget(80, 6, false, 6), "80 × 8");
  // Easy at top of range → double the load increment.
  assert.equal(nextTarget(80, 12, false, 7), "90 × 8");
  // Normal RPE (8) → standard double progression.
  assert.equal(nextTarget(80, 6, false, 8), "80 × 7");
});

test("parseSteps: plain, separators, and embedded", () => {
  assert.equal(parseSteps("8000"), 8000);
  assert.equal(parseSteps("8 000"), 8000);
  assert.equal(parseSteps("8,000"), 8000);
  assert.equal(parseSteps("пройшов 10000 кроків"), 10000);
  assert.equal(parseSteps("nope"), undefined);
  assert.equal(parseSteps("0"), undefined);
});

test("weeksSincePlan + deloadWeekDue: every 7th week", () => {
  assert.equal(weeksSincePlan("2026-01-01", "2026-01-01"), 0);
  assert.equal(weeksSincePlan("2026-01-01", "2026-02-19"), 7); // 49 days
  assert.equal(deloadWeekDue("2026-01-01", "2026-01-01"), false);
  assert.equal(deloadWeekDue("2026-01-01", "2026-02-19"), true); // week 7
  assert.equal(deloadWeekDue("2026-01-01", "2026-02-12"), false); // week 6
});

test("deloadSets: drops set count ~40%, keeps rep range", () => {
  assert.equal(deloadSets("4 × 8-10"), "2 × 8-10");
  assert.equal(deloadSets("3 x 12"), "2 x 12");
  assert.equal(deloadSets("5×5"), "3 ×5");
  assert.equal(deloadSets("AMRAP"), "AMRAP"); // non "N ×" strings untouched
});

test("shouldDeload: every Nth week, interval from plan meta", () => {
  const plan = (genIso: string, interval?: number) =>
    ({ generatedAt: new Date(genIso), deloadInterval: interval } as PlanDoc);
  // default interval 4
  assert.equal(shouldDeload(plan("2026-01-01"), "2026-01-01"), false); // week 0
  assert.equal(shouldDeload(plan("2026-01-01"), "2026-01-29"), true); // week 4 (28 days)
  assert.equal(shouldDeload(plan("2026-01-01"), "2026-01-22"), false); // week 3
  // custom interval 6
  assert.equal(shouldDeload(plan("2026-01-01", 6), "2026-02-12"), true); // week 6 (42 days)
  assert.equal(shouldDeload(plan("2026-01-01", 6), "2026-01-29"), false); // week 4
});

test("evaluateProgressionRate: ratio of successful sets", () => {
  const log = (exs: WorkoutLogDoc["exercises"]): WorkoutLogDoc =>
    ({ userId: 1, date: "2026-01-01", weekday: 1, exercises: exs, completed: true, createdAt: new Date() });
  const ex = (sets: number, opts: { skipped?: boolean; rpe?: number } = {}) => ({
    name: "x",
    setsDone: Array.from({ length: sets }, () => ({ reps: 8, weight: 50 })),
    skipped: opts.skipped ?? false,
    ...(opts.rpe !== undefined ? { rpe: opts.rpe } : {}),
  });
  assert.equal(evaluateProgressionRate([]), "normal"); // no data
  assert.equal(evaluateProgressionRate([log([ex(3), ex(3)])]), "fast"); // 100% ok
  assert.equal(evaluateProgressionRate([log([ex(3, { rpe: 10 }), ex(3)])]), "normal"); // 50% ok
  assert.equal(evaluateProgressionRate([log([ex(3, { skipped: true }), ex(1)])]), "slow"); // 25% ok
});

// --- weekly dynamic progression ---

const planWith = (ex: Partial<PlanExercise>): PlanDoc => ({
  userId: 1,
  active: true,
  status: "active",
  split: [{ weekday: 1, muscleGroup: "Test", exercises: [{ name: "Bench Press", sets: "4 × 8–10", startWeight: "50 kg", technique: "", ...ex }] }],
  nutrition: { calories: 0, protein: 0, fats: 0, carbs: 0 },
  supplements: [],
  methodology: "",
  generatedAt: new Date("2026-01-01"),
});

const progLog = (date: string, name: string, reps: number, weight: number, rpe?: number): WorkoutLogDoc => ({
  userId: 1,
  date,
  weekday: 1,
  exercises: [{ name, setsDone: [{ reps, weight }], skipped: false, ...(rpe !== undefined ? { rpe } : {}) }],
  completed: true,
  createdAt: new Date(),
});

const checkin = (date: string, energy: number, sleep: number, stress: number): DailyCheckinDoc =>
  ({ userId: 1, date, energy, sleep, stress, createdAt: new Date() });

test("computePlanProgression: top of range hit twice → +2.5kg upper-body weight bump", () => {
  const plan = planWith({ name: "Bench Press", sets: "4 × 8–10", startWeight: "50 kg" });
  const logs = [progLog("2026-02-10", "Bench Press", 10, 50, 8), progLog("2026-02-12", "Bench Press", 10, 50, 8)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].field, "weight");
  assert.equal(r.changes[0].to, "52.5 kg");
});

test("computePlanProgression: lower-body lift gets +5kg", () => {
  const plan = planWith({ name: "Back Squat", sets: "4 × 6–8", startWeight: "100 kg" });
  const logs = [progLog("2026-02-10", "Back Squat", 8, 100, 8), progLog("2026-02-12", "Back Squat", 8, 100, 7)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes[0].to, "105 kg");
});

test("computePlanProgression: bodyweight exercise bumps reps, not weight", () => {
  const plan = planWith({ name: "Pull-ups", sets: "4 × 8–10", startWeight: "Bodyweight" });
  const logs = [progLog("2026-02-10", "Pull-ups", 10, 0), progLog("2026-02-12", "Pull-ups", 10, 0)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes[0].field, "reps");
  assert.equal(r.changes[0].to, "4 × 9–11");
});

test("computePlanProgression: not reaching top of range → no change, no plateau", () => {
  const plan = planWith({ sets: "4 × 8–10", startWeight: "50 kg" });
  const logs = [progLog("2026-02-10", "Bench Press", 8, 50), progLog("2026-02-12", "Bench Press", 8, 50)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes.length, 0);
  assert.equal(r.plateau.length, 0);
});

test("computePlanProgression: maximal RPE blocks the weight bump", () => {
  const plan = planWith({ sets: "4 × 8–10", startWeight: "50 kg" });
  const logs = [progLog("2026-02-10", "Bench Press", 10, 50, 9.5), progLog("2026-02-12", "Bench Press", 10, 50, 9.5)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes.length, 0);
});

test("computePlanProgression: poor wellbeing holds all increases", () => {
  const plan = planWith({ sets: "4 × 8–10", startWeight: "50 kg" });
  const logs = [progLog("2026-02-10", "Bench Press", 10, 50, 8), progLog("2026-02-12", "Bench Press", 10, 50, 8)];
  const r = computePlanProgression(plan, logs, [checkin("2026-02-11", 2, 4, 2)]);
  assert.equal(r.heldForWellbeing, true);
  assert.equal(r.changes.length, 0);
});

test("computePlanProgression: grinding below top for 3 sessions flags a plateau (held)", () => {
  const plan = planWith({ sets: "4 × 8–10", startWeight: "50 kg" });
  const logs = [
    progLog("2026-02-08", "Bench Press", 8, 50, 10),
    progLog("2026-02-10", "Bench Press", 8, 50, 10),
    progLog("2026-02-12", "Bench Press", 8, 50, 10),
  ];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes.length, 0);
  assert.deepEqual(r.plateau, ["Bench Press"]);
});

test("computePlanProgression: needs ≥2 completed sessions overall", () => {
  const plan = planWith({ sets: "4 × 8–10", startWeight: "50 kg" });
  const r = computePlanProgression(plan, [progLog("2026-02-12", "Bench Press", 10, 50, 8)], []);
  assert.equal(r.changes.length, 0);
});

test("applyProgression: clones and applies, leaving the input untouched", () => {
  const plan = planWith({ name: "Bench Press", sets: "4 × 8–10", startWeight: "50 kg" });
  const updated = applyProgression(plan, [{ weekday: 1, index: 0, exercise: "Bench Press", field: "weight", from: "50 kg", to: "52.5 kg" }]);
  assert.equal(updated.split[0].exercises[0].startWeight, "52.5 kg");
  assert.equal(plan.split[0].exercises[0].startWeight, "50 kg"); // original unchanged
});

// --- time- & distance-based exercises (planks, rowing machine) ---

test("parseDuration: seconds, minutes, mm:ss (EN + UA)", () => {
  assert.equal(parseDuration("45s"), 45);
  assert.equal(parseDuration("45 сек"), 45);
  assert.equal(parseDuration("60с"), 60);
  assert.equal(parseDuration("2 min"), 120);
  assert.equal(parseDuration("2 хв"), 120);
  assert.equal(parseDuration("1:30"), 90);
  assert.equal(parseDuration("80"), undefined); // bare number is not a duration
});

test("parseDistance: meters and km, excludes 'min'", () => {
  assert.equal(parseDistance("2000m"), 2000);
  assert.equal(parseDistance("2000 м"), 2000);
  assert.equal(parseDistance("5 km"), 5000);
  assert.equal(parseDistance("2.5км"), 2500);
  assert.equal(parseDistance("20 min"), undefined); // "min" is not metres
});

test("parseWorkoutText: timed hold — single and multiplier", () => {
  assert.deepEqual(parseWorkoutText("Plank 60s"), [{ exercise: "Plank", weight: 0, reps: 0, seconds: 60 }]);
  const r = parseWorkoutText("Планка 3х45с");
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { exercise: "Планка", weight: 0, reps: 0, seconds: 45 });
  assert.deepEqual(parseWorkoutText("Plank 1:00"), [{ exercise: "Plank", weight: 0, reps: 0, seconds: 60 }]);
});

test("parseWorkoutText: rowing distance + optional time", () => {
  assert.deepEqual(parseWorkoutText("Rowing 2000m"), [{ exercise: "Rowing", weight: 0, reps: 0, meters: 2000 }]);
  assert.deepEqual(parseWorkoutText("Rowing 2000m 8:00"), [
    { exercise: "Rowing", weight: 0, reps: 0, seconds: 480, meters: 2000 },
  ]);
  assert.deepEqual(parseWorkoutText("Гребля 20 хв"), [{ exercise: "Гребля", weight: 0, reps: 0, seconds: 1200 }]);
});

test("parseWorkoutText: weight×reps still parses, time suffix not mistaken for reps", () => {
  const r = parseWorkoutText("Bench press 80x6, 80x5");
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { exercise: "Bench press", weight: 80, reps: 6 });
  // "3x45s" must NOT become weight 3 × reps 45 — it's three 45-second holds.
  const t2 = parseWorkoutText("Plank 3x45s");
  assert.equal(t2.length, 3);
  assert.equal(t2[0].seconds, 45);
});

test("exerciseMetric: explicit field wins, else inferred from sets", () => {
  assert.equal(exerciseMetric({ sets: "4 × 8-12" }), "reps");
  assert.equal(exerciseMetric({ sets: "3 × 30-45s" }), "time");
  assert.equal(exerciseMetric({ sets: "20 min" }), "time");
  assert.equal(exerciseMetric({ sets: "2000 m" }), "distance");
  assert.equal(exerciseMetric({ sets: "5 km" }), "distance");
  assert.equal(exerciseMetric({ metric: "time", sets: "4 × 8-12" }), "time"); // explicit overrides
});

test("exerciseMetric: name-based fallback for unit-less / untagged plans", () => {
  // The reported bug: a plank with a rep-format sets string and no metric tag.
  assert.equal(exerciseMetric({ name: "Планка на ліктях", sets: "3 × 30-45" }), "time");
  assert.equal(exerciseMetric({ name: "Plank", sets: "3 × 12" }), "time");
  assert.equal(exerciseMetric({ name: "Вис на перекладині", sets: "3 × 10" }), "time");
  assert.equal(exerciseMetric({ name: "Гребний тренажер", sets: "4 × 12" }), "distance");
  assert.equal(exerciseMetric({ name: "Біг на доріжці", sets: "1 × 20" }), "distance");
  assert.equal(exerciseMetric({ name: "Rowing machine", sets: "1 × 500" }), "distance");
  // Must NOT misfire on weight×reps lifts whose names merely contain "row"/"тяга".
  assert.equal(exerciseMetric({ name: "Bent-over row", sets: "4 × 8-10" }), "reps");
  assert.equal(exerciseMetric({ name: "Тяга штанги в нахилі", sets: "4 × 8" }), "reps");
  assert.equal(exerciseMetric({ name: "Back Squat", sets: "5 × 5" }), "reps");
  // Explicit metric/sets-unit still win over the name heuristic.
  assert.equal(exerciseMetric({ name: "Plank", metric: "reps", sets: "3 × 12" }), "reps");
});

test("chunkReport: splits on section boundaries, keeps <pre> blocks whole, under limit", () => {
  const pre = "<pre>" + Array.from({ length: 40 }, (_, i) => `row ${i} ................................`).join("\n") + "</pre>";
  const text = ["§A header\nline\nline", pre, "§B\nx\ny", "§C\nz"].join("\n\n");
  const chunks = chunkReport(text, 1500);
  assert.ok(chunks.length >= 2, "should split into multiple chunks");
  for (const c of chunks) assert.ok(c.length <= 1500 || c.includes("<pre>"), "chunk within limit unless a single oversized section");
  // The <pre> block must stay intact within one chunk (balanced tags).
  const withPre = chunks.find((c) => c.includes("<pre>"));
  assert.ok(withPre && withPre.includes("</pre>"), "<pre> kept whole in its chunk");
});

test("muscleGroupOf: classifies UA exercise names by region", () => {
  assert.equal(muscleGroupOf("Присідання зі штангою"), "legs");
  assert.equal(muscleGroupOf("Станова тяга"), "legs"); // hinge → posterior, beats generic "тяга"→back
  assert.equal(muscleGroupOf("Жим лежачи"), "chest");
  assert.equal(muscleGroupOf("Тяга верхнього блоку до грудей"), "back");
  assert.equal(muscleGroupOf("Згинання рук зі штангою"), "arms");
  assert.equal(muscleGroupOf("Жим гантелей сидячи для плечей"), "shoulders");
  assert.equal(muscleGroupOf("Планка на ліктях"), "core");
});

test("muscleGroupOf: UA leg-machine names classify as legs (not null/arms)", () => {
  assert.equal(muscleGroupOf("Жим ногами в тренажері"), "legs");
  assert.equal(muscleGroupOf("Згинання ніг у тренажері"), "legs"); // leg curl, not arms (рук)
  assert.equal(muscleGroupOf("Розгинання ніг у тренажері"), "legs"); // leg extension
  assert.equal(muscleGroupOf("Відведення ніг у тренажері сидячи"), "legs"); // abduction
  assert.equal(muscleGroupOf("Привідні м'язи стегна в тренажері"), "legs"); // adduction
  assert.equal(muscleGroupOf("Біцепс стегна лежачи"), "legs"); // hamstring, beats "біцепс"→arms
});

test("metricOfSets + formatters", () => {
  assert.equal(metricOfSets([{ reps: 0, weight: 0, seconds: 60 }]), "time");
  assert.equal(metricOfSets([{ reps: 0, weight: 0, meters: 2000 }]), "distance");
  assert.equal(metricOfSets([{ reps: 8, weight: 50 }]), "reps");
  assert.equal(fmtDuration(45), "45s");
  assert.equal(fmtDuration(90), "1:30");
  assert.equal(fmtDuration(120), "2 min");
  assert.equal(fmtDistance(800), "800 m");
  assert.equal(fmtDistance(2000), "2 km");
  assert.equal(fmtDistance(2500), "2.5 km");
  assert.equal(formatSetEntry({ reps: 0, weight: 0, seconds: 60 }), "1 min");
  assert.equal(formatSetEntry({ reps: 0, weight: 0, meters: 2000, seconds: 480 }), "2 km 8 min");
  assert.equal(formatSetEntry({ reps: 6, weight: 80 }), "80x6");
});

test("formatRecordBest: per-metric", () => {
  assert.equal(formatRecordBest({ metric: "time", bestWeight: 0, bestReps: 0, bestSeconds: 75, bestMeters: 0 }), "1:15");
  assert.equal(formatRecordBest({ metric: "distance", bestWeight: 0, bestReps: 0, bestSeconds: 0, bestMeters: 2000 }), "2 km");
  assert.equal(formatRecordBest({ metric: "reps", bestWeight: 100, bestReps: 5, bestSeconds: 0, bestMeters: 0 }), "100x5");
});

const timedLog = (date: string, name: string, seconds: number, rpe?: number): WorkoutLogDoc => ({
  userId: 1, date, weekday: 1,
  exercises: [{ name, setsDone: [{ reps: 0, weight: 0, seconds }], skipped: false, ...(rpe !== undefined ? { rpe } : {}) }],
  completed: true, createdAt: new Date(),
});

const distLog = (date: string, name: string, meters: number, rpe?: number): WorkoutLogDoc => ({
  userId: 1, date, weekday: 1,
  exercises: [{ name, setsDone: [{ reps: 0, weight: 0, meters }], skipped: false, ...(rpe !== undefined ? { rpe } : {}) }],
  completed: true, createdAt: new Date(),
});

test("computePlanProgression: timed hold reaching top extends the duration", () => {
  const plan = planWith({ name: "Plank", sets: "3 × 30-45s", startWeight: "Bodyweight", metric: "time" });
  const logs = [timedLog("2026-02-10", "Plank", 45), timedLog("2026-02-12", "Plank", 48)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].to, "3 × 35–50s");
});

test("computePlanProgression: timed hold below target → no change", () => {
  const plan = planWith({ name: "Plank", sets: "3 × 30-45s", startWeight: "Bodyweight", metric: "time" });
  const logs = [timedLog("2026-02-10", "Plank", 35), timedLog("2026-02-12", "Plank", 38)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes.length, 0);
});

test("computePlanProgression: rowing distance extends by ~10%", () => {
  const plan = planWith({ name: "Rowing Machine", sets: "1 × 2000m", startWeight: "Bodyweight", metric: "distance" });
  const logs = [distLog("2026-02-10", "Rowing Machine", 2000), distLog("2026-02-12", "Rowing Machine", 2050)];
  const r = computePlanProgression(plan, logs, []);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].to, "2200m");
});

test("computeTargets: prefers plan nutrition, else Mifflin", () => {
  const fromPlan = computeTargets({ weightKg: 80 } as never, { calories: 2200, protein: 180, fats: 70, carbs: 200 });
  assert.equal(fromPlan.calories, 2200);
  const derived = computeTargets({ weightKg: 85, heightCm: 180, age: 32, sex: "male", daysPerWeek: 3, goal: "схуднення" } as never);
  assert.ok(derived.calories > 1500 && derived.calories < 2600); // fat-loss deficit applied
  assert.equal(derived.protein, 170); // 2 g/kg
});

test("splitMeals: weights sum to ~daily", () => {
  const split = splitMeals({ calories: 2000, protein: 160, fats: 60, carbs: 200 }, 4);
  assert.equal(split.length, 4);
  const totalKcal = split.reduce((s, m) => s + m.calories, 0);
  assert.ok(Math.abs(totalKcal - 2000) <= 5);
});

test("solvePortions: scales grams to hit the kcal target", () => {
  const items = solvePortions(
    [{ food: "chicken breast", grams: 100, per100g: { kcal: 165, protein: 31, fats: 3.6, carbs: 0 } }],
    { calories: 330, protein: 60, fats: 10, carbs: 0 },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].grams, 200); // 100g→165kcal, target 330 → ×2
  assert.equal(items[0].kcal, 330);
});

test("solvePortions: hits protein, not just calories, across foods", () => {
  const items = solvePortions(
    [
      { food: "chicken breast", grams: 100, per100g: { kcal: 165, protein: 31, fats: 3.6, carbs: 0 } },
      { food: "white rice", grams: 150, per100g: { kcal: 130, protein: 2.7, fats: 0.3, carbs: 28 } },
      { food: "olive oil", grams: 10, per100g: { kcal: 884, protein: 0, fats: 100, carbs: 0 } },
    ],
    { calories: 600, protein: 50, fats: 20, carbs: 50 },
  );
  const sum = (k: "kcal" | "protein" | "fats" | "carbs") => items.reduce((s, it) => s + it[k], 0);
  // Calories stay close AND protein lands near target (calorie-only scaling missed it badly).
  assert.ok(Math.abs(sum("kcal") - 600) <= 90, `kcal ${sum("kcal")}`);
  assert.ok(Math.abs(sum("protein") - 50) <= 15, `protein ${sum("protein")}`);
  assert.ok(items.every((it) => it.grams >= 5));
});

test("solvePortions: caps condiments instead of inflating them to fill macros", () => {
  // Soy sauce is low-calorie; without a cap the solver scales it to 100g+ chasing kcal.
  const items = solvePortions(
    [
      { food: "white rice", grams: 80, per100g: { kcal: 130, protein: 2.7, fats: 0.3, carbs: 28 } },
      { food: "soy sauce", grams: 15, per100g: { kcal: 53, protein: 8, fats: 0, carbs: 5 } },
    ],
    { calories: 700, protein: 50, fats: 10, carbs: 90 },
  );
  const soy = items.find((it) => it.food === "soy sauce")!;
  assert.ok(soy.grams <= 30, `soy sauce ${soy.grams}g exceeds condiment cap`);
});

test("curatedPer100g: correct whole-food values, prep words stripped", () => {
  assert.equal(curatedPer100g("egg")?.kcal, 143); // whole egg, not egg white
  assert.equal(curatedPer100g("egg")?.fats, 10);
  assert.equal(curatedPer100g("banana")?.kcal, 89); // fresh, not dried 346
  assert.equal(curatedPer100g("rolled oats")?.kcal, 379);
  assert.equal(curatedPer100g("Grilled Salmon")?.kcal, 208); // prep word stripped → salmon
  assert.equal(curatedPer100g("steamed broccoli")?.kcal, 34);
  assert.equal(curatedPer100g("boiled egg")?.kcal, 155); // prepared egg forms resolve
  assert.equal(curatedPer100g("omelet")?.fats, 12);
  assert.equal(curatedPer100g("scrambled eggs")?.kcal, 149);
  assert.equal(curatedPer100g("unicorn steak surprise"), null);
});

test("isPlausiblePer100g: rejects garbage OFF matches", () => {
  assert.ok(isPlausiblePer100g({ kcal: 165, protein: 31, fats: 3.6, carbs: 0 })); // chicken
  assert.ok(isPlausiblePer100g({ kcal: 884, protein: 0, fats: 100, carbs: 0 })); // olive oil
  assert.ok(!isPlausiblePer100g({ kcal: 50, protein: 0, fats: 0, carbs: 0 })); // no macros
  assert.ok(!isPlausiblePer100g({ kcal: 100, protein: 80, fats: 80, carbs: 80 })); // >100g/100g
  assert.ok(!isPlausiblePer100g({ kcal: 0, protein: 10, fats: 5, carbs: 10 })); // no kcal
});

test("localParts: UTC fixed date", () => {
  const p = localParts("UTC", new Date("2026-06-05T10:30:00Z"));
  assert.equal(p.date, "2026-06-05");
  assert.equal(p.weekday, 5); // Friday
  assert.equal(p.hour, 10);
});

test("i18n: converts *bold* markers to HTML", () => {
  assert.match(t("en", "plan_header"), /<b>Your Training Plan<\/b>/);
});

test("i18n: escapes interpolated values", () => {
  const s = t("en", "verified_suffix", { n: 2, total: 3, src: "USDA" });
  assert.match(s, /2\/3 item\(s\) cross-checked against USDA/);
});

test("cleanAi: fixes the LaTeX \\times artifact (JSON-parsed TAB)", () => {
  // AI emits "\times"; JSON.parse turns "\t" into a TAB → "4 <TAB>imes 8-12".
  const corrupted = JSON.parse('{"s":"4 \\times 8-12"}').s;
  assert.equal(cleanAi(corrupted), "4 × 8-12");
  // Words containing "rac"/"x" must be untouched.
  assert.equal(cleanAi("Barbell rack pull 4 x 6"), "Barbell rack pull 4 x 6");
});

test("muscleGroupOf: owner-reported gaps are classified (seated press, incline, raises)", () => {
  assert.equal(muscleGroupOf("Жим гантелей сидячи"), "shoulders");
  assert.equal(muscleGroupOf("Підйом гантелі перед собою"), "shoulders");
  assert.equal(muscleGroupOf("Розведення рук назад у тренажері"), "shoulders");
  assert.equal(muscleGroupOf("Зведення рук назад у тренажері"), "shoulders");
  assert.equal(muscleGroupOf("Жим гантелей на похилій лаві"), "chest");
  assert.equal(muscleGroupOf("Жим штанги на похилій лаві середнім хватом"), "chest");
  // must NOT regress existing classifications
  assert.equal(muscleGroupOf("Зведення рук у тренажері"), "chest");
  assert.equal(muscleGroupOf("Тяга мотузки до обличчя"), "shoulders");
  assert.equal(muscleGroupOf("Розведення гантелей у сторони"), "shoulders");
  assert.equal(muscleGroupOf("Жим ногами в тренажері"), "legs");
  assert.equal(muscleGroupOf("Горизонтальна тяга на нижньому блоці"), "back");
});

test("resolveWeightMode: explicit tag wins, else inferred from name", () => {
  assert.equal(resolveWeightMode("Горизонтальна тяга в тренажері"), "total");
  assert.equal(resolveWeightMode("Горизонтальна тяга в тренажері", "perSide"), "perSide");
  assert.equal(resolveWeightMode("Тяга гантелі однією рукою"), "perSide");
  assert.equal(resolveWeightMode("One-arm dumbbell row"), "perSide");
  assert.equal(resolveWeightMode("Жим гантелей сидячи"), "perHand");
  assert.equal(resolveWeightMode("Dumbbell Bench Press"), "perHand");
  assert.equal(resolveWeightMode("Присідання зі штангою"), "total");
  assert.equal(resolveWeightMode("Болгарський випад на одну ногу"), "perSide");
});

test("inQuietHours: off when bounds missing or equal", () => {
  assert.equal(inQuietHours(3), false);
  assert.equal(inQuietHours(3, 22, 22), false);
});
test("inQuietHours: non-wrapping window", () => {
  assert.equal(inQuietHours(14, 13, 18), true);
  assert.equal(inQuietHours(18, 13, 18), false); // end exclusive
  assert.equal(inQuietHours(12, 13, 18), false);
});
test("inQuietHours: wrapping past midnight (22→7)", () => {
  assert.equal(inQuietHours(23, 22, 7), true);
  assert.equal(inQuietHours(3, 22, 7), true);
  assert.equal(inQuietHours(7, 22, 7), false); // end exclusive
  assert.equal(inQuietHours(12, 22, 7), false);
});
