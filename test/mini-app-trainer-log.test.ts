// The trainer's "log a client's workout" form in the Mini App (apps/mini-app/src/logic/trainerLog.ts,
// ADR-0018): how a voice proposal lands in the form, how cells change, what is sent on save, and the
// plan-edit body shared with the coach chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionToPlanEditBody, addExercise, addRow, formRows, mergeProposalEntries, setCell, trainerSaveEntries } from "../apps/mini-app/src/logic/trainerLog";
import type { LoggerExercise } from "../apps/mini-app/src/logic/logger";

const plan = (): LoggerExercise[] => [
  { index: 0, name: "Bench Press", metric: "reps", sets: 3, reps: 8, weightKg: 60 },
  { index: 1, name: "Plank", metric: "time", sets: 2, reps: 45 },
];

test("an untouched plan exercise shows empty rows, one per planned set; logged sets show as they are", () => {
  const [bench, plank] = plan();
  assert.deepEqual(formRows(bench), [{ weight: 0, reps: 0 }, { weight: 0, reps: 0 }, { weight: 0, reps: 0 }], "the plan's numbers are placeholders, not done sets");
  assert.deepEqual(formRows(plank), [{ weight: 0, reps: 0, seconds: 0 }, { weight: 0, reps: 0, seconds: 0 }]);
  assert.deepEqual(formRows({ ...bench, setsDone: [{ weight: 70, reps: 5 }] }), [{ weight: 70, reps: 5 }]);
  assert.equal(formRows({ ...bench, sets: 0 }).length, 1, "at least one row");
});

test("a voice proposal replaces the sets of an exercise already in the form and appends a new one", () => {
  const merged = mergeProposalEntries(plan(), [
    { name: "bench press", sets: [{ weight: 80, reps: 6 }, { weight: 80, reps: 5 }, { weight: 75, reps: 6 }, { weight: 70, reps: 8 }], rpe: 8 },
    { name: "Rowing", sets: [{ weight: 0, reps: 0, meters: 2000, seconds: 480 }] },
    { name: "Dead Hang", sets: [{ weight: 0, reps: 0, seconds: 40 }] },
    { name: "Nothing", sets: [] },
  ]);
  assert.equal(merged.length, 4, "an entry with no sets adds nothing");
  assert.deepEqual(merged[0].setsDone?.map((s) => [s.weight, s.reps]), [[80, 6], [80, 5], [75, 6], [70, 8]]);
  assert.equal(merged[0].sets, 4, "the rows grow to the spoken sets");
  assert.equal(merged[0].rpe, 8);
  assert.deepEqual([merged[2].name, merged[2].metric, merged[2].index], ["Rowing", "distance", 2]);
  assert.deepEqual([merged[3].metric, merged[3].index], ["time", 3]);
  assert.equal(plan()[0].setsDone, undefined, "the input is not mutated");

  const swapped = mergeProposalEntries([{ ...plan()[0], name: "Dumbbell Press", planName: "Bench Press" }], [{ name: "Bench Press", sets: [{ weight: 30, reps: 10 }] }]);
  assert.equal(swapped.length, 1, "matched by the plan name it stands in for");
});

test("cells: typing fills a row, grows the list when needed, and a bad number becomes 0", () => {
  const bench = plan()[0];
  const one = setCell(bench, 0, "weight", 80);
  assert.deepEqual(one.setsDone, [{ weight: 80, reps: 0 }, { weight: 0, reps: 0 }, { weight: 0, reps: 0 }]);
  const four = setCell(one, 3, "reps", 6);
  assert.equal(four.setsDone?.length, 4);
  assert.equal(four.sets, 4);
  assert.equal(setCell(bench, 0, "reps", Number.NaN).setsDone?.[0]?.reps, 0);
  assert.equal(setCell(bench, 0, "reps", -3).setsDone?.[0]?.reps, 0);
  assert.equal(addRow(bench).setsDone?.length, 4);
});

test("adding an exercise by name: trimmed, no duplicates, indexed after the rest", () => {
  const added = addExercise(plan(), "  Face Pull ");
  assert.deepEqual(added.map((e) => [e.index, e.name]).at(-1), [2, "Face Pull"]);
  assert.equal(addExercise(plan(), "bench press").length, 2, "already there");
  assert.equal(addExercise(plan(), "   ").length, 2);
});

test("the save sends only filled sets of exercises that have one, keeping RPE and the plan name", () => {
  const ex: LoggerExercise[] = [
    { ...plan()[0], planName: "Bench Press", name: "Dumbbell Press", rpe: 7, setsDone: [{ weight: 30, reps: 10 }, { weight: 0, reps: 0 }] },
    { ...plan()[1], setsDone: [{ weight: 0, reps: 0, seconds: 0 }] },
  ];
  assert.deepEqual(trainerSaveEntries(ex), [{ name: "Dumbbell Press", sets: [{ weight: 30, reps: 10 }], rpe: 7, planName: "Bench Press" }]);
  assert.deepEqual(trainerSaveEntries(plan()), [], "nothing typed, nothing sent");
});

test("plan actions become plan-editor bodies; clientId only when editing a client's plan", () => {
  assert.deepEqual(actionToPlanEditBody({ kind: "weight", weekday: 1, index: 0, value: "65", target: "Bench Press" }, 20),
    { action: "weight", weekday: 1, index: 0, value: "65", expectName: "Bench Press", clientId: 20 });
  assert.deepEqual(actionToPlanEditBody({ kind: "delete", weekday: 2, index: 3 }), { action: "del", weekday: 2, index: 3, value: undefined });
  assert.deepEqual(actionToPlanEditBody({ kind: "swap", weekday: 1, index: 1, exercise: "Leg Press", value: "ignored" }, 20)?.value, "Leg Press");
  assert.equal(actionToPlanEditBody({ kind: "add", weekday: 3, exercise: "Plank" })?.index, -1);
  assert.equal(actionToPlanEditBody({ kind: "harder", weekday: 1 }), null, "the editor cannot apply it");
  assert.equal(actionToPlanEditBody({ kind: "weight", index: 0, value: "60" }), null, "no day");
});
