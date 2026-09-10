import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVATION_LAST_DAY, activationDay, nextActivationStep } from "../src/domain/activation";

const step = (o: { day?: string; workouts?: number; sent?: string[] }) =>
  nextActivationStep({
    joinedDate: "2026-06-01",
    today: o.day ?? "2026-06-02",
    workouts: o.workouts ?? 0,
    sentSteps: o.sent ?? [],
  });

test("activationDay: the join date itself is day 1", () => {
  assert.equal(activationDay("2026-06-01", "2026-06-01"), 1);
  assert.equal(activationDay("2026-06-01", "2026-06-14"), 14);
  assert.equal(activationDay("2026-06-01", "2026-05-30"), 0); // before joining
});

test("day 1 is never nudged — the plan was just delivered", () => {
  assert.equal(step({ day: "2026-06-01" }), null);
});

test("day 2 with nothing logged → the first-session beat", () => {
  const r = step({ day: "2026-06-02" })!;
  assert.equal(r.step, "act_first");
  assert.equal(r.onTrack, false);
});

test("a logged session skips straight to the first-win beat", () => {
  const r = step({ day: "2026-06-02", workouts: 1 })!;
  assert.equal(r.step, "act_win");
  assert.equal(r.onTrack, true);
});

test("each beat is sent at most once", () => {
  assert.equal(step({ day: "2026-06-02", sent: ["act_first"] }), null);
  assert.equal(step({ day: "2026-06-02", workouts: 1, sent: ["act_win"] }), null);
});

test("week-one beat: two sessions is on pace, fewer is not", () => {
  const on = step({ day: "2026-06-08", workouts: 2, sent: ["act_win"] })!;
  assert.deepEqual([on.step, on.onTrack], ["act_week", true]);
  const behind = step({ day: "2026-06-08", workouts: 1, sent: ["act_win"] })!;
  assert.deepEqual([behind.step, behind.onTrack], ["act_week", false]);
});

test("day 14 beat splits on the three-session target", () => {
  const sent = ["act_win", "act_week"];
  assert.equal(step({ day: "2026-06-14", workouts: 3, sent })!.onTrack, true);
  assert.equal(step({ day: "2026-06-14", workouts: 2, sent })!.onTrack, false);
  assert.equal(step({ day: "2026-06-14", workouts: 3, sent })!.step, "act_locked");
});

test("a quiet user gets the missed beat first, not the whole arc at once", () => {
  // Nothing sent, nothing logged, day 10: the first-session beat still comes before the week one.
  const first = step({ day: "2026-06-10" })!;
  assert.equal(first.step, "act_first");
  const next = step({ day: "2026-06-10", sent: ["act_first"] })!;
  assert.equal(next.step, "act_week");
});

test("the arc closes: no beat fires for an established account", () => {
  const late = `2026-06-${String(1 + ACTIVATION_LAST_DAY).padStart(2, "0")}`; // day 22
  assert.equal(step({ day: late }), null);
  // And an account created months ago never retro-fires the whole arc.
  assert.equal(nextActivationStep({ joinedDate: "2026-01-01", today: "2026-06-01", workouts: 0, sentSteps: [] }), null);
});
