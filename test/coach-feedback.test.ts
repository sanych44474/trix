// The AI coach can take feedback about the app and, on the user's tap, pass it to the owner
// (bot/coach.ts "feedback" action → feedbackIntake.recordFeedback).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { handleCoachAction } from "../src/bot/coach";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { validateCoachEditResult } from "../src/domain/coachActions";
import type { UserDoc } from "../src/types";

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

test("tapping the feedback button forwards summary + original message to the owner, once", async () => {
  const db = newDb();
  await setOwnerChatId(db, 999);
  const user = (await getOrCreateUser(db, 30, 30, "en", "Ann")) as unknown as UserDoc;
  user.session = {
    ...user.session,
    coachTurnId: 7,
    coachActions: [{ label: "Send", kind: "feedback", value: "Rest timer resets when minimised.", note: "your timer keeps resetting, tell the devs" }],
  };
  const { ctx, sent } = makeCtx(db, user as unknown as Record<string, unknown>);

  await handleCoachAction(ctx as never, "feedback", 7, 0);
  const toOwner = sent.filter((m) => m.to === 999);
  assert.equal(toOwner.length, 1);
  assert.match(toOwner[0]!.text, /Feedback via AI coach/);
  assert.match(toOwner[0]!.text, /Rest timer resets/);
  assert.match(toOwner[0]!.text, /tell the devs/);
  const row = await db.prepare("SELECT text FROM v2_feedback WHERE accountId = 30").first<{ text: string }>();
  assert.match(row!.text, /^\[AI coach\] Rest timer resets/);

  await handleCoachAction(ctx as never, "feedback", 7, 0); // double tap
  assert.equal(sent.filter((m) => m.to === 999).length, 1);

});
