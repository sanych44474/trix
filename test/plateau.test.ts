import { test } from "node:test";
import assert from "node:assert/strict";
import { plateauReport, repRange } from "../src/domain/plateau";
import { plateauMessage } from "../src/schedulerJobs/nudges";
import type { PlanDoc, SetEntry, WorkoutLogDoc } from "../src/types";

const TODAY = "2026-10-19";
const daysAgo = (n: number) => new Date(Date.parse(TODAY) - n * 86_400_000).toISOString().slice(0, 10);
const sets = (weight: number, ...reps: number[]): SetEntry[] => reps.map((r) => ({ weight, reps: r }));
const log = (ago: number, name: string, done: SetEntry[]): WorkoutLogDoc => ({
  userId: 1, date: daysAgo(ago), weekday: 1, completed: true, createdAt: new Date(0),
  exercises: [{ name, setsDone: done, skipped: false }],
});

test("the same weight and reps for 6 weeks is a plateau, with the numbers and a next step", () => {
  const logs = [40, 33, 26, 19, 12, 5].map((d) => log(d, "Leg Extension", sets(40, 10, 10, 9)));
  const [f] = plateauReport(logs, TODAY);
  assert.equal(f.exercise, "Leg Extension");
  assert.equal(f.kind, "flat");
  assert.equal(f.weight, 40);
  assert.equal(f.reps, 10);
  assert.equal(f.sets, 3);
  assert.deepEqual(f.advice, { kind: "add_reps", weight: 40, target: 12, sets: 3 });
});

test("more reps or more sets at the same top weight is progress, not a plateau", () => {
  const reps = [log(40, "Hip Abduction", sets(50, 10, 10)), log(33, "Hip Abduction", sets(50, 10, 10)), log(19, "Hip Abduction", sets(50, 10, 10)), log(12, "Hip Abduction", sets(50, 12, 11)), log(5, "Hip Abduction", sets(50, 12, 12))];
  assert.deepEqual(plateauReport(reps, TODAY), []);
  const moreSets = [log(40, "Hip Abduction", sets(50, 12, 12)), log(30, "Hip Abduction", sets(50, 12, 12)), log(12, "Hip Abduction", sets(50, 12, 12, 12)), log(5, "Hip Abduction", sets(50, 12, 12, 12))];
  assert.deepEqual(plateauReport(moreSets, TODAY), [], "an added set raises volume");
});

test("a heavier top set with a rep reset is progress", () => {
  const logs = [log(40, "Bench Press", sets(80, 8, 8)), log(30, "Bench Press", sets(80, 8, 8)), log(12, "Bench Press", sets(82.5, 6, 6)), log(5, "Bench Press", sets(82.5, 6, 6))];
  assert.deepEqual(plateauReport(logs, TODAY), []);
});

test("at the top of the plan's rep range the advice is to add load and restart low", () => {
  const plan = { split: [{ weekday: 1, muscleGroup: "Legs", exercises: [{ name: "Leg Press", sets: "3 × 8–10", startWeight: "", technique: "" }] }] } as unknown as PlanDoc;
  const logs = [40, 33, 26, 19, 12, 5].map((d) => log(d, "Leg Press", sets(120, 10, 10, 10)));
  const [f] = plateauReport(logs, TODAY, plan);
  assert.deepEqual(f.advice, { kind: "add_weight", weight: 122.5, reps: 8 });
});

test("falling performance asks for a lighter week first", () => {
  const logs = [log(40, "Squat", sets(100, 6, 6)), log(33, "Squat", sets(100, 6, 6)), log(12, "Squat", sets(90, 5, 5)), log(5, "Squat", sets(90, 5, 4))];
  const [f] = plateauReport(logs, TODAY);
  assert.equal(f.kind, "regress");
  assert.equal(f.advice.kind, "deload");
});

test("too little history is never called a plateau", () => {
  const logs = [12, 8, 5].map((d) => log(d, "Leg Curl", sets(30, 10, 10)));
  assert.deepEqual(plateauReport(logs, TODAY), [], "three sessions in two weeks");
  const timed = [40, 30, 12, 5].map((d) => log(d, "Plank", [{ weight: 10, reps: 1, seconds: 60 }]));
  assert.deepEqual(plateauReport(timed, TODAY), [], "timed work is not judged on load");
});

test("repRange reads the plan's set notation", () => {
  assert.deepEqual(repRange("4 × 8–12"), [8, 12]);
  assert.deepEqual(repRange("3x10"), [10, 10]);
  assert.equal(repRange("AMRAP"), null);
});

test("the message names each lift with its numbers and one concrete step", () => {
  const logs = [40, 33, 26, 19, 12, 5].map((d) => log(d, "Розгинання ніг у тренажері", sets(40, 10, 10, 9)));
  const text = plateauMessage("uk", plateauReport(logs, TODAY));
  assert.match(text, /Розгинання ніг у тренажері.*40 кг.*40 × 10/s);
  assert.match(text, /3 × 12/);
});
