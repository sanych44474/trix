// A plan build that keeps failing must not be retried every minute for ever: after a few fast
// tries the sweep backs off to one try an hour, and a stuck user no longer blocks the next one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRetryDue } from "../src/features/plan/planService";
import type { UserDoc } from "../src/types";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const user = (session: UserDoc["session"]) => ({ session }) as UserDoc;

test("the first failures are retried at once", () => {
  assert.equal(planRetryDue(user({ mode: "plan_pending" }), NOW), true);
  assert.equal(planRetryDue(user({ mode: "plan_pending", planTries: 4, planTriedAt: "2026-11-12T11:59:30Z" }), NOW), true);
});

test("after five failures the sweep waits an hour", () => {
  const recent = user({ mode: "plan_pending", planTries: 5, planTriedAt: "2026-11-12T11:30:00Z" });
  assert.equal(planRetryDue(recent, NOW), false);
  const old = user({ mode: "plan_pending", planTries: 9, planTriedAt: "2026-11-12T10:59:00Z" });
  assert.equal(planRetryDue(old, NOW), true);
});

test("a missing timestamp never strands a user", () => {
  assert.equal(planRetryDue(user({ mode: "plan_pending", planTries: 7 }), NOW), true);
});
