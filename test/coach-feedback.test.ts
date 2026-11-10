// The AI coach's action contract: a feedback action carries its summary, plan values stay short,
// and the app gets only the edits it can apply (the coach screen sends feedback through
// POST /api/v2/coach/feedback).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCoachEditResult } from "../src/domain/coachActions";

test("coach contract: a feedback action needs its summary", () => {
  assert.doesNotThrow(() => validateCoachEditResult({
    reply: "Thanks! Tap to pass it on.",
    actions: [{ label: "📨 Send to the team", kind: "feedback", value: "The rest timer resets when the app is minimised." }],
  }));
  assert.throws(() => validateCoachEditResult({ reply: "Thanks!", actions: [{ label: "Send", kind: "feedback" }] }), /value is required/);
});

test("coach contract: plan values stay short even though feedback may be long", () => {
  assert.throws(
    () => validateCoachEditResult({ reply: "ok", actions: [{ label: "W", kind: "weight", weekday: 1, index: 0, value: "1".repeat(81) }] }),
    /too long/,
  );
});
test("miniAppCoachActions: only edits the app can apply, feedback carries the user's words", async () => {
  const { miniAppCoachActions } = await import("../src/domain/coachActions");
  const out = miniAppCoachActions([
    { label: "60 kg", kind: "weight", weekday: 1, index: 0, value: "60" },
    { label: "Harder", kind: "harder", weekday: 1 },
    { label: "Swap?", kind: "swap", weekday: 1, index: 1 },
    { label: "Swap to RDL", kind: "swap", weekday: 1, index: 1, exercise: "Romanian Deadlift" },
    { label: "Send", kind: "feedback", value: "Timer resets." },
  ], "the timer resets, tell the devs", [{ weekday: 1, exercises: [{ name: "Squat" }, { name: "Leg Curl" }] }]);
  assert.deepEqual(out.map((a) => a.kind), ["weight", "swap", "feedback"]);
  assert.deepEqual(out.map((a) => a.target), ["Squat", "Leg Curl", undefined], "targeted edits name the exercise they act on");
  assert.equal(out[2]!.note, "the timer resets, tell the devs");
});
