// The trainer's voice command turned into a proposal (src/domain/trainerVoice.ts, ADR-0018): which
// texts skip the AI, how the model's answer is checked, and the order plan edits are applied in.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_CUE,
  normalizeSpokenSets,
  normalizeVoiceEntries,
  orderPlanActions,
  quickWorkoutProposal,
  validateTrainerVoiceResult,
} from "../src/domain/trainerVoice";

const PLAN = ["Bench Press", "Barbell Squat", "Pull-Up"];

test("spoken numbers read as sets: 'на', 'by', 'по' and a spoken kg unit", () => {
  assert.equal(normalizeSpokenSets("жим 80 на 6"), "жим 80x6");
  assert.equal(normalizeSpokenSets("bench 80 kg by 6"), "bench 80x6");
  assert.equal(normalizeSpokenSets("присід 100 кілограмів по 5"), "присід 100x5");
  assert.equal(normalizeSpokenSets("Bench 80x6"), "Bench 80x6", "already written");
});

test("plain dictation becomes entries with no AI, grouped by exercise and named after the plan", () => {
  assert.deepEqual(quickWorkoutProposal("Bench press 80x6, 80x5", PLAN), [{ name: "Bench Press", sets: [{ weight: 80, reps: 6 }, { weight: 80, reps: 5 }] }]);
  assert.deepEqual(quickWorkoutProposal("Жим 60х10 @8", ["Жим лежачи"]), [{ name: "Жим лежачи", sets: [{ weight: 60, reps: 10 }], rpe: 8 }]);
  const two = quickWorkoutProposal("bench 80 на 6\nsquat 100 на 5; bench 80 на 5", PLAN);
  assert.deepEqual(two?.map((e) => [e.name, e.sets.length]), [["Bench Press", 2], ["Barbell Squat", 1]]);
  assert.deepEqual(quickWorkoutProposal("pull-up bw x8", PLAN)?.[0], { name: "Pull-Up", sets: [{ weight: 0, reps: 8 }] });
});

test("anything that is not plain dictation is left to the AI", () => {
  assert.equal(quickWorkoutProposal("заміни жим на 80x6", PLAN), null, "a plan cue wins over numbers");
  assert.equal(quickWorkoutProposal("bench 80x6\nand then something heavy", PLAN), null, "a line with no sets");
  assert.equal(quickWorkoutProposal("80x6", PLAN), null, "sets with no exercise named");
  assert.equal(quickWorkoutProposal("   ", PLAN), null);
  for (const t of ["replace bench", "add to plan", "прибери присід", "додай тягу", "удали жим", "в план"]) assert.ok(PLAN_CUE.test(t), t);
  assert.ok(!PLAN_CUE.test("bench 80x6"));
});

test("the model's answer is checked: kind, a non-empty proposal, and plan actions the coach rules allow", () => {
  assert.doesNotThrow(() => validateTrainerVoiceResult({ kind: "workout", reply: "ok", entries: [{ name: "Bench", sets: [{ weight: 80, reps: 6 }] }] }));
  assert.doesNotThrow(() => validateTrainerVoiceResult({ kind: "plan", reply: "ok", actions: [{ label: "Bench 65", kind: "weight", weekday: 1, index: 0, value: "65" }] }));
  assert.doesNotThrow(() => validateTrainerVoiceResult({ kind: "none", reply: "Which one?" }));
  assert.throws(() => validateTrainerVoiceResult({ kind: "delete", reply: "ok" }), /invalid/);
  assert.throws(() => validateTrainerVoiceResult({ kind: "none", reply: "  " }), /blank/);
  assert.throws(() => validateTrainerVoiceResult({ kind: "workout", reply: "ok", entries: [] }), /without entries/);
  assert.throws(() => validateTrainerVoiceResult({ kind: "workout", reply: "ok", entries: [{ name: "Bench", sets: [{ weight: -1, reps: 6 }] }] }), /invalid/);
  assert.throws(() => validateTrainerVoiceResult({ kind: "plan", reply: "ok" }), /without actions/);
  assert.throws(() => validateTrainerVoiceResult({ kind: "plan", reply: "ok", actions: [{ label: "x", kind: "weight", weekday: 1, value: "60" }] }), /index is required/);
  const five = Array.from({ length: 5 }, () => ({ label: "x", kind: "delete", weekday: 1, index: 0 }));
  assert.throws(() => validateTrainerVoiceResult({ kind: "plan", reply: "ok", actions: five }), /invalid/);
});

test("model entries are matched to the client's names and cleaned like a save", () => {
  const out = normalizeVoiceEntries([
    { name: " bench press ", sets: [{ weight: 80, reps: 6.4 }, { weight: 80, reps: 0 }] },
    { name: "Plank", sets: [{ weight: 0, reps: 0, seconds: 60 }] },
    { name: "Nothing done", sets: [{ weight: 50, reps: 0 }] },
  ], PLAN);
  assert.deepEqual(out, [
    { name: "Bench Press", sets: [{ weight: 80, reps: 6 }] },
    { name: "Plank", sets: [{ weight: 0, reps: 0, seconds: 60 }] },
  ]);
});

test("plan edits apply in an order that never shifts a later index", () => {
  const actions = [
    { kind: "add", weekday: 1 },
    { kind: "delete", weekday: 1, index: 0 },
    { kind: "weight", weekday: 1, index: 2 },
    { kind: "delete", weekday: 1, index: 3 },
    { kind: "delete", weekday: 2, index: 1 },
    { kind: "sets", weekday: 2, index: 0 },
  ];
  assert.deepEqual(orderPlanActions(actions).map((a) => `${a.kind}:${a.weekday}:${a.index ?? "-"}`), [
    "weight:1:2", "sets:2:0", "delete:1:3", "delete:1:0", "delete:2:1", "add:1:-",
  ]);
});
