import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStartWeights, familyOf, isSelfSelectWeight, parseBaselineLifts, weightFromBaseline } from "../src/domain/startWeights";

const ex = (name: string, startWeight = "60 kg", sets = "4 × 8–10") => ({ name, sets, startWeight, technique: "" });

test("baseline lifts in Ukrainian and English, with or without reps", () => {
  const b = parseBaselineLifts("жим лежачи 60, присід 80х5; станова 100 кг");
  assert.equal(b.bench, 60);
  assert.ok(Math.abs(b.squat! - 80 * (1 + 5 / 30)) < 0.01);
  assert.equal(b.deadlift, 100);
  assert.deepEqual(parseBaselineLifts("bench 70kg x 8, OHP 40"), { bench: 70 * (1 + 8 / 30), ohp: 40 });
  assert.deepEqual(parseBaselineLifts("тяга в нахилі 50"), { row: 50 });
  assert.deepEqual(parseBaselineLifts("none"), {});
  assert.deepEqual(parseBaselineLifts(""), {});
});

test("exercise families and per-hand dumbbell shares", () => {
  assert.deepEqual(familyOf("Жим штанги лежачи"), { lift: "bench", ratio: 1, dumbbell: false });
  assert.equal(familyOf("Жим гантелей лежачи")?.dumbbell, true);
  assert.equal(familyOf("Жим гантелей над головою")?.lift, "ohp");
  assert.equal(familyOf("Румунська тяга")?.lift, "deadlift");
  assert.equal(familyOf("Кубковий присід")?.lift, "squat");
  assert.equal(familyOf("Згинання рук з гантелями"), null, "isolation isn't inferred");
  assert.equal(familyOf("Присідання без ваги"), null);
  // 100 kg 1RM bench, 8–10 reps: 100 / (1 + 9/30) * 0.9 ≈ 69 → 70.
  assert.equal(weightFromBaseline("Жим штанги лежачи", "4 × 8–10", { bench: 100 }), 70);
  assert.equal(weightFromBaseline("Жим стоячи", "3 × 8", { bench: 100 }), 45, "OHP estimated from the bench");
  assert.equal(weightFromBaseline("Присідання зі штангою", "3 × 8", { bench: 100 }), undefined, "no squat from a bench");
});

test("a beginner without stated lifts picks their own weights; bodyweight and timed work stay", () => {
  const split = [{ weekday: 1, exercises: [ex("Жим ногами", "80 kg"), ex("Віджимання", "Власна вага"), ex("Планка", "—", "3 × 30 с"), ex("Тяга гантелі однією рукою", "14 kg")] }];
  const r = applyStartWeights(split, { level: "beginner", weightKg: 70 }, "uk");
  assert.deepEqual(r.split[0]!.exercises.map((e) => e.startWeight), ["підбери вагу", "Власна вага", "—", "підбери вагу"]);
  assert.equal(r.selfSelect, 2);
  assert.ok(isSelfSelectWeight(r.split[0]!.exercises[0]!.startWeight));
});

test("stated lifts calibrate related exercises even for a beginner; the rest still self-select", () => {
  const split = [{ weekday: 1, exercises: [ex("Жим штанги лежачи", "40 kg"), ex("Розведення гантелей лежачи", "12 kg")] }];
  const r = applyStartWeights(split, { level: "beginner", baselineLifts: "жим 60" }, "uk");
  assert.equal(r.split[0]!.exercises[0]!.startWeight, "42.5 kg");
  assert.equal(r.split[0]!.exercises[1]!.startWeight, "підбери вагу");
  assert.equal(r.calibrated, 1);
});

test("uncalibrated numbers are capped to a sane share of bodyweight for the level", () => {
  const split = [{ weekday: 1, exercises: [ex("Станова тяга", "200 kg"), ex("Згинання рук з гантелями", "30 kg"), ex("Жим штанги лежачи", "45 kg")] }];
  const r = applyStartWeights(split, { level: "intermediate", weightKg: 70 }, "en");
  assert.deepEqual(r.split[0]!.exercises.map((e) => e.startWeight), ["75 kg", "8 kg", "45 kg"]);
  assert.equal(r.capped, 2);
});

test("after a session, 'pick a weight' exercises adopt the logged weight; others are untouched", async () => {
  const { adoptLoggedWeights } = await import("../src/domain/startWeights");
  const split = [{ weekday: 1, exercises: [ex("Кубковий присід", "підбери вагу"), ex("Жим гантелей лежачи на підлозі", "підбери вагу"), ex("Тяга гантелі однією рукою", "14 kg")] }];
  const r = adoptLoggedWeights(split, [{ name: "Кубковий присід", weight: 16 }, { name: "Тяга гантелі однією рукою", weight: 20 }, { name: "Жим гантелей лежачи на підлозі", weight: 0 }]);
  assert.equal(r.adopted, 1);
  assert.deepEqual(r.split[0]!.exercises.map((e) => e.startWeight), ["16 kg", "підбери вагу", "14 kg"]);
});

test("parseBaselineLifts: look-alike lifts are not baselines", () => {
  assert.deepEqual(parseBaselineLifts("жим ногами 150, підтягування 10, тяга блоку 50"), {});
  assert.deepEqual(parseBaselineLifts("жим гантелей 24"), {});
  assert.equal(parseBaselineLifts("тяга 120").deadlift, 120);
  assert.equal(parseBaselineLifts("жим 80").bench, 80);
});

test("a barbell split squat is not calibrated as a full squat", () => {
  const w = weightFromBaseline("Bulgarian Split Squat (barbell)", "3 x 8", { squat: 100 })!;
  assert.ok(w <= 35, `got ${w}`);
});
