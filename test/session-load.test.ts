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
  const { isCalendarDate } = await import("../src/domain/editWindow");
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-13-01"), false);
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("26-02-28"), false);
});

// ---- edges of the volume and kcal rules

test("volume: a muscle-up lifts the whole body, and added weight stacks on it", () => {
  assert.equal(setVolumeKg("Muscle-up", { weight: 0, reps: 5 }, 80), 400);
  assert.equal(setVolumeKg("Weighted muscle-up", { weight: 10, reps: 5 }, 80), 450);
});

test("volume: only the first matching share applies, in table order (a dip is not a push-up)", () => {
  assert.equal(bodyweightShare("Bar dips")?.share, 0.95);
  assert.equal(bodyweightShare("Push-ups on knees")?.share, 0.49);
  assert.equal(bodyweightShare("Push-up")?.share, 0.64);
  assert.equal(bodyweightShare("Bench Press"), null);
});

test("volume: negative or zero reps move nothing, a negative weight counts as zero", () => {
  assert.equal(setVolumeKg("Bench Press", { weight: 80, reps: -3 }), 0);
  assert.equal(setVolumeKg("Bench Press", { weight: 80, reps: 0 }), 0);
  assert.equal(setVolumeKg("Bench Press", { weight: -20, reps: 5 }), 0);
  assert.equal(setVolumeKg("Pull-up", { weight: -20, reps: 5 }, 80), 400, "a negative added weight is not subtracted");
});

test("volume: a zero or negative body weight is the same as an unknown one", () => {
  assert.equal(setVolumeKg("Pull-up", { weight: 0, reps: 10 }, 0), 0);
  assert.equal(setVolumeKg("Pull-up", { weight: 0, reps: 10 }, -80), 0);
  assert.equal(setVolumeKg("Assisted Pull-up", { weight: 30, reps: 10 }, 0), 0);
});

test("kcal: the effort bands meet at RPE 6 / 7 / 8, and a rating outside 1 to 10 is ignored", () => {
  assert.equal(sessionMet([6]), 3.5);
  assert.equal(sessionMet([6.5]), 5);
  assert.equal(sessionMet([7.9]), 5);
  assert.equal(sessionMet([8]), 6);
  assert.equal(sessionMet([10]), 6);
  assert.equal(sessionMet([0]), 5, "0 means not rated");
  assert.equal(sessionMet([11, 12]), 5, "above 10 is not a rating");
  assert.equal(sessionMet([11, 6]), 3.5, "the invalid one is skipped, the valid one decides");
});

test("kcal: a negative or zero duration is not a measurement, the set count is used instead", () => {
  const entries = [{ name: "Row", sets: Array.from({ length: 12 }, () => ({ weight: 60, reps: 10 })) }];
  assert.equal(sessionKcal(entries, 70, -100), 175);
  assert.equal(sessionKcal(entries, 70, 0), 175);
  assert.equal(sessionKcal(entries, 70, 3600), 350, "a real hour is used as is");
});

test("kcal: rounded to 5, never below 5, and an estimate from set count stops at 3 hours", () => {
  const sets = (n: number) => [{ name: "Row", sets: Array.from({ length: n }, () => ({ weight: 60, reps: 10 })) }];
  assert.equal(sessionKcal(sets(1), 40), 10, "5 MET x 40 kg x 150 s is 8.3: rounded to the nearest 5");
  assert.equal(sessionKcal(sets(1), 1), 5, "never below 5");
  assert.equal(sessionKcal(sets(100), 70), 1050, "100 sets would be 4.2 h: capped at 3 h");
  assert.equal(sessionKcal(sets(72), 70), 1050, "72 sets is exactly 3 h: the same as the cap");
  assert.equal(sessionKcal(sets(71), 70), 1035, "one set fewer is just under the cap");
});

test("kcal: a timed or distance set counts as a set even with no reps", () => {
  assert.notEqual(sessionKcal([{ name: "Plank", sets: [{ weight: 0, reps: 0, seconds: 60 }] }], 70), null);
  assert.notEqual(sessionKcal([{ name: "Run", sets: [{ weight: 0, reps: 0, meters: 1000 }] }], 70), null);
  assert.equal(sessionKcal([{ name: "Plank", sets: [{ weight: 0, reps: 0 }] }], 70), null);
});

test("kcal: the hardest effort comes from the whole session, set ratings included", () => {
  const entries = [{ name: "Squat", sets: [{ weight: 100, reps: 5, rpe: 9 }, { weight: 100, reps: 5, rpe: 6 }] }];
  assert.equal(sessionKcal(entries, 80, 3600), 480, "a set at RPE 9 makes the session 6 MET");
  assert.equal(sessionKcal([{ name: "Squat", rpe: 9, sets: [{ weight: 100, reps: 5 }] }], 80, 3600), 480, "so does the exercise rating");
});
