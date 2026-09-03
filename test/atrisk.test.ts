import { test } from "node:test";
import assert from "node:assert/strict";
import { lastPlannedDates, missedConsecutiveWorkouts, nutritionLapse } from "../src/domain/atrisk";

// 2026-06-29 is a Monday. Plan = Mon/Wed/Fri (1,3,5).
const MWF = [1, 3, 5];

test("lastPlannedDates: newest-first planned dates strictly before today", () => {
  // today Sat 2026-07-04 → last MWF before it: Fri 07-03, Wed 07-01, Mon 06-29
  assert.deepEqual(lastPlannedDates(MWF, "2026-07-04", 3), ["2026-07-03", "2026-07-01", "2026-06-29"]);
  assert.deepEqual(lastPlannedDates([], "2026-07-04", 2), []);
});

test("missedConsecutiveWorkouts: both recent planned days missed → [older, newer]", () => {
  // today Sat 07-04; last two planned = Fri 07-03 (newer), Wed 07-01 (older)
  assert.deepEqual(missedConsecutiveWorkouts(MWF, [], "2026-07-04"), ["2026-07-01", "2026-07-03"]);
});

test("missedConsecutiveWorkouts: either day logged → null", () => {
  assert.equal(missedConsecutiveWorkouts(MWF, ["2026-07-03"], "2026-07-04"), null); // newer done
  assert.equal(missedConsecutiveWorkouts(MWF, ["2026-07-01"], "2026-07-04"), null); // older done
});

test("missedConsecutiveWorkouts: no plan days → null", () => {
  assert.equal(missedConsecutiveWorkouts([], [], "2026-06-29"), null);
});

test("missedConsecutiveWorkouts: notBefore floors out pre-join dates (new client)", () => {
  // today Sat 07-04; last two planned MWF = Fri 07-03, Wed 07-01. Client joined 07-01 →
  // only 07-03 qualifies (07-01 is the floor-excluded older one) → not two missed → null.
  assert.equal(missedConsecutiveWorkouts(MWF, [], "2026-07-04", "2026-07-02"), null);
  // With a floor before both, it still flags.
  assert.deepEqual(missedConsecutiveWorkouts(MWF, [], "2026-07-04", "2026-06-01"), ["2026-07-01", "2026-07-03"]);
});

test("nutritionLapse: regular then a 3-day gap → alert", () => {
  // 8 consecutive days logged, last on 06-25; today 06-29 → gap 4, regular window has ≥7
  const dates = ["06-18", "06-19", "06-20", "06-21", "06-22", "06-23", "06-24", "06-25"].map((d) => `2026-${d}`);
  const r = nutritionLapse(dates, "2026-06-29")!;
  assert.ok(r);
  assert.equal(r.lastLogged, "2026-06-25");
  assert.equal(r.gapDays, 4);
});

test("nutritionLapse: no lapse when still logging within threshold", () => {
  const dates = Array.from({ length: 8 }, (_, i) => `2026-06-${String(21 + i).padStart(2, "0")}`); // …up to 06-28
  assert.equal(nutritionLapse(dates, "2026-06-29"), null); // gap 1 < 3
});

test("nutritionLapse: sporadic logger (below regularity gate) → null", () => {
  const dates = ["2026-06-20", "2026-06-24"]; // only 2 days in window
  assert.equal(nutritionLapse(dates, "2026-06-29"), null);
});

test("nutritionLapse: never logged → null", () => {
  assert.equal(nutritionLapse([], "2026-06-29"), null);
});
