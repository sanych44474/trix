// Session volume with bodyweight moves and the kcal estimate (src/domain/sessionLoad.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyweightShare, sessionKcal, sessionMet, sessionVolumeKg, setVolumeKg } from "../src/domain/sessionLoad";

test("volume: a pull-up logged at 0 kg counts the body weight (it used to count nothing)", () => {
  assert.equal(setVolumeKg("Pull-up", { weight: 0, reps: 10 }, 80), 800);
  assert.equal(setVolumeKg("Підтягування", { weight: 0, reps: 10 }, 80), 800);
  assert.equal(setVolumeKg("Pull-up", { weight: 0, reps: 10 }), 0, "no body weight known: nothing to add");
});

test("volume: added weight on pull-ups and dips stacks on the body weight", () => {
  assert.equal(setVolumeKg("Weighted pull-up", { weight: 10, reps: 5 }, 80), 450);
  assert.equal(setVolumeKg("Віджимання на брусах", { weight: 0, reps: 10 }, 80), 760, "a dip, not a push-up");
});

test("volume: push-ups count ~64%, knee push-ups ~49%", () => {
  assert.equal(setVolumeKg("Push-up", { weight: 0, reps: 10 }, 100), 640);
  assert.equal(setVolumeKg("Віджимання з колін", { weight: 0, reps: 10 }, 100), 490);
});

test("volume: a barbell squat counts the bar only; an air squat counts the body share", () => {
  assert.equal(setVolumeKg("Присідання зі штангою", { weight: 100, reps: 5 }, 80), 500);
  assert.equal(setVolumeKg("Air squat", { weight: 0, reps: 20 }, 80), 1120);
});

test("volume: assisted moves, abs and unknown names add only what was logged", () => {
  assert.equal(bodyweightShare("Assisted pull-up"), null);
  assert.equal(setVolumeKg("Гравітрон підтягування", { weight: 30, reps: 10 }, 80), 300);
  assert.equal(setVolumeKg("Crunch", { weight: 0, reps: 20 }, 80), 0);
  assert.equal(setVolumeKg("Bench Press", { weight: 80, reps: 8 }, 80), 640);
  assert.equal(setVolumeKg("Plank", { weight: 0, reps: 0, seconds: 60 }, 80), 0);
});

test("session volume sums every set and rounds", () => {
  assert.equal(sessionVolumeKg([
    { name: "Bench Press", sets: [{ weight: 80, reps: 8 }, { weight: 82.5, reps: 6 }] },
    { name: "Dips", sets: [{ weight: 0, reps: 12 }] },
  ], 81), 640 + 495 + Math.round(0.95 * 81 * 12));
});

test("kcal: MET from the hardest RPE, measured duration first", () => {
  assert.equal(sessionMet([]), 5);
  assert.equal(sessionMet([6, 5]), 3.5);
  assert.equal(sessionMet([7]), 5);
  assert.equal(sessionMet([9, 6]), 6);
  // 6 MET × 80 kg × 1 h = 480
  assert.equal(sessionKcal([{ name: "Squat", rpe: 9, sets: [{ weight: 100, reps: 5 }] }], 80, 3600), 480);
});

test("kcal: no clock estimates from the set count; no body weight or no sets gives no number", () => {
  const entries = [{ name: "Row", sets: Array.from({ length: 12 }, () => ({ weight: 60, reps: 10 })) }];
  // 12 sets × 150 s = 30 min; 5 MET × 70 kg × 0.5 h = 175
  assert.equal(sessionKcal(entries, 70), 175);
  assert.equal(sessionKcal(entries, undefined, 1800), null);
  assert.equal(sessionKcal([{ name: "Row", sets: [{ weight: 60, reps: 0 }] }], 70, 1800), null);
});
