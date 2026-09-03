import { test } from "node:test";
import assert from "node:assert/strict";
import { trainerCanSee, parseBirthdayInput, birthdayInfo, anthroLines, type AnthroLabels } from "../src/domain/clientCard";
import type { UserProfile } from "../src/types";

const TODAY = "2026-07-10";

test("trainerCanSee: only an explicit true grants visibility", () => {
  assert.equal(trainerCanSee({}, "body"), false);
  assert.equal(trainerCanSee({}, "health"), false);
  assert.equal(trainerCanSee({ shareWithTrainer: {} }, "body"), false);
  assert.equal(trainerCanSee({ shareWithTrainer: {} }, "health"), false);
  assert.equal(trainerCanSee({ shareWithTrainer: { body: true } }, "body"), true);
  assert.equal(trainerCanSee({ shareWithTrainer: { body: true } }, "health"), false);
  assert.equal(trainerCanSee({ shareWithTrainer: { body: false, health: false } }, "body"), false);
  assert.equal(trainerCanSee({ shareWithTrainer: { body: false, health: false } }, "health"), false);
});

test("parseBirthdayInput accepts the three formats and canonicalizes", () => {
  assert.equal(parseBirthdayInput("15.03.1990", TODAY), "1990-03-15");
  assert.equal(parseBirthdayInput("15.03", TODAY), "03-15");
  assert.equal(parseBirthdayInput("1990-03-15", TODAY), "1990-03-15");
  assert.equal(parseBirthdayInput(" 15.03.1990 ", TODAY), "1990-03-15");
});

test("parseBirthdayInput rejects impossible dates and out-of-range years", () => {
  assert.equal(parseBirthdayInput("31.02.1990", TODAY), null);
  assert.equal(parseBirthdayInput("32.01", TODAY), null);
  assert.equal(parseBirthdayInput("13.13", TODAY), null); // month 13
  assert.equal(parseBirthdayInput("hello", TODAY), null);
  assert.equal(parseBirthdayInput("15.03.1800", TODAY), null);
  assert.equal(parseBirthdayInput("15.03.2030", TODAY), null); // future year
});

test("parseBirthdayInput: 29.02 needs a leap year only when the year is known", () => {
  assert.equal(parseBirthdayInput("29.02.2000", TODAY), "2000-02-29");
  assert.equal(parseBirthdayInput("29.02.2001", TODAY), null);
  assert.equal(parseBirthdayInput("29.02", TODAY), "02-29");
});

test("birthdayInfo: age counts up only once the birthday passed this year", () => {
  const before = birthdayInfo("1990-03-15", "2026-03-14");
  assert.equal(before.display, "15.03.1990");
  assert.equal(before.age, 35);
  assert.equal(before.daysUntil, 1);
  const onDay = birthdayInfo("1990-03-15", "2026-03-15");
  assert.equal(onDay.age, 36);
  assert.equal(onDay.daysUntil, 0);
});

test("birthdayInfo: daysUntil wraps over New Year", () => {
  const r = birthdayInfo("01-02", "2026-12-30");
  assert.equal(r.display, "02.01");
  assert.equal(r.age, undefined);
  assert.equal(r.daysUntil, 3);
});

test("birthdayInfo: yearless birthday has no age", () => {
  const r = birthdayInfo("03-15", TODAY);
  assert.equal(r.display, "15.03");
  assert.equal(r.age, undefined);
});

test("birthdayInfo: 02-29 counts as 03-01 in a non-leap year", () => {
  const r = birthdayInfo("2000-02-29", TODAY); // next occurrence = 2027-03-01
  assert.equal(r.display, "29.02.2000");
  assert.equal(r.age, 26);
  assert.equal(r.daysUntil, 234);
});

const LABELS: AnthroLabels = {
  height: "Height", weight: "Weight", age: "Age", sex: "Sex", goalWeight: "Goal weight",
  waist: "Waist", chest: "Chest", hips: "Hips", arm: "Arm", thigh: "Thigh",
  male: "male", female: "female",
};

test("anthroLines: empty profile yields no lines", () => {
  assert.deepEqual(anthroLines({}, LABELS), []);
});

test("anthroLines: full profile renders every line with units", () => {
  const profile: UserProfile = {
    heightCm: 178, weightKg: 80, age: 30, sex: "male", goalWeight: 75,
    measurements: { waist: 82, chest: 100, hips: 95, arm: 36, thigh: 58 },
  };
  assert.deepEqual(anthroLines(profile, LABELS), [
    "• Height: 178 cm",
    "• Weight: 80 kg",
    "• Age: 30",
    "• Sex: male",
    "• Goal weight: 75 kg",
    "• Waist: 82 cm",
    "• Chest: 100 cm",
    "• Hips: 95 cm",
    "• Arm: 36 cm",
    "• Thigh: 58 cm",
  ]);
});

test("anthroLines: partial measurements render only what is present", () => {
  const lines = anthroLines({ sex: "female", measurements: { waist: 70 } }, LABELS);
  assert.deepEqual(lines, ["• Sex: female", "• Waist: 70 cm"]);
});
