// Same-day readiness advice. The daily check-in (energy/sleep/stress) already gated the WEEKLY
// progression (computePlanProgression → heldForWellbeing) but said nothing about today's
// session; readinessAdvice() is that missing half. Both now share poorWellbeing() as the single
// definition of "not a day to push" — these tests pin that agreement down, since two drifting
// thresholds would let the bot tell you to back off today while ratcheting the plan up anyway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { poorWellbeing, readinessAdvice } from "../src/domain/progression";
import type { DailyCheckinDoc } from "../src/types";

const ci = (energy: number, sleep: number, stress: number): DailyCheckinDoc => ({
  userId: 1,
  date: "2026-06-01",
  energy,
  sleep,
  stress,
  createdAt: new Date("2026-06-01T08:00:00Z"),
});

test("readinessAdvice: a good check-in asks for nothing", () => {
  assert.equal(readinessAdvice(ci(4, 4, 2)), "ok");
  assert.equal(readinessAdvice(ci(5, 5, 1)), "ok");
  assert.equal(readinessAdvice(ci(3, 3, 3)), "ok");
});

test("readinessAdvice: no check-in logged is NOT treated as a bad day", () => {
  assert.equal(readinessAdvice(null), "ok");
  assert.equal(readinessAdvice(undefined), "ok");
});

test("readinessAdvice: one bad signal → ease off; two, or a rock-bottom one → go light", () => {
  assert.equal(readinessAdvice(ci(2, 4, 2)), "easy"); // low energy only
  assert.equal(readinessAdvice(ci(4, 2, 2)), "easy"); // poor sleep only
  assert.equal(readinessAdvice(ci(4, 4, 4)), "easy"); // high stress only
  assert.equal(readinessAdvice(ci(2, 2, 2)), "light"); // energy + sleep
  assert.equal(readinessAdvice(ci(2, 4, 4)), "light"); // energy + stress
  assert.equal(readinessAdvice(ci(1, 4, 2)), "light"); // rock-bottom energy alone
  assert.equal(readinessAdvice(ci(4, 1, 2)), "light"); // rock-bottom sleep alone
  assert.equal(readinessAdvice(ci(4, 4, 5)), "light"); // rock-bottom stress alone
});

test("readinessAdvice: zeroed-out fields (unanswered) don't count as bad signals", () => {
  // The check-in stores 0 for a question that was never answered — 0 must not read as "terrible".
  assert.equal(readinessAdvice(ci(0, 0, 0)), "ok");
  assert.equal(readinessAdvice(ci(0, 4, 2)), "ok");
});

test("poorWellbeing agrees with readinessAdvice: anything that holds the week is at least 'easy'", () => {
  const cases = [ci(2, 4, 2), ci(4, 2, 2), ci(4, 4, 4), ci(1, 1, 5), ci(2, 2, 4)];
  for (const c of cases) {
    assert.equal(poorWellbeing([c]), true, `expected weekly hold for ${JSON.stringify(c)}`);
    assert.notEqual(readinessAdvice(c), "ok", `expected same-day advice for ${JSON.stringify(c)}`);
  }
  // …and the converse: a day the weekly rule is fine with never demands same-day backing off.
  for (const c of [ci(4, 4, 2), ci(3, 3, 3), ci(5, 5, 1)]) {
    assert.equal(poorWellbeing([c]), false);
    assert.equal(readinessAdvice(c), "ok");
  }
});
