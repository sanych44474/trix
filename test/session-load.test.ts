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

test("volume: assisted moves count the body weight left after the help; abs and unknown names add only what was logged", () => {
  assert.equal(bodyweightShare("Assisted pull-up"), null);
  // 30 kg of help: (80 - 30) x 10 moved, not 300 "lifted"; nothing without a body weight.
  assert.equal(setVolumeKg("Гравітрон підтягування", { weight: 30, reps: 10 }, 80), 500);
  assert.equal(setVolumeKg("Assisted Pull-up", { weight: 30, reps: 10 }), 0);
  assert.equal(setVolumeKg("Assisted Pull-up", { weight: 100, reps: 10 }, 80), 0);
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

test("planned amount: time and distance prescriptions prefill in seconds and metres, not the rep parser's number", async () => {
  const { plannedAmount } = await import("../src/webapp/workout");
  assert.equal(plannedAmount("3 × 1 min", "time"), 60);
  assert.equal(plannedAmount("20 min", "time"), 1200);
  assert.equal(plannedAmount("3 × 30-45s", "time"), 38);
  assert.equal(plannedAmount("3 × 45 сек", "time"), 45);
  assert.equal(plannedAmount("5 km", "distance"), 5000);
  assert.equal(plannedAmount("1 × 2 km", "distance"), 2000);
  assert.equal(plannedAmount("1 × 2000m", "distance"), 2000);
  assert.equal(plannedAmount("3 × 8–12", "reps"), 10);
  assert.equal(plannedAmount("3 × 12", "time"), 12, "no unit in the spec: the number as written");
});

test("quest target: the plan's days win over the profile's, as on every other surface", async () => {
  const { plannedDayCount } = await import("../src/domain/quests");
  const split = [1, 2, 3, 4, 5].map((weekday) => ({ weekday }));
  assert.equal(plannedDayCount([1, 3, 5], split), 5);
  assert.equal(plannedDayCount([1, 3, 5], undefined), 3, "no plan: the profile's days");
  assert.equal(plannedDayCount(undefined, undefined), 0);
});

test("edit date: a date that does not exist is refused (V8 reads 2026-02-30 as 2 March)", async () => {
  const { isCalendarDate } = await import("../src/webapp/workoutApi");
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-13-01"), false);
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("26-02-28"), false);
});
