// Post-workout coach recap (roadmap item 6): finalizeWorkoutLog used to send up to 4 separate
// messages (saved+summary, PR, badges, next session); it now sends ONE, folding in
// nextTargetGuidance (RPE-autoregulated "what to do next time", previously shown only on the
// standalone /records screen). No prior test exercised this path at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { handleWorkoutLog } from "../src/bot/workoutSave";
import { nextTargetGuidance } from "../src/domain/progression";
import type { LoggedExercise, UserDoc } from "../src/types";

async function ctxFor(db: ReturnType<typeof newDb>, id = 1) {
  const u = (await getOrCreateUser(db, id, id, "en", "Ann")) as unknown as UserDoc;
  await updateUser(db, id, { onboarded: true });
  return makeCtx(db, u as unknown as Record<string, unknown>);
}

test("finalizeWorkoutLog: a normal save sends exactly ONE message with the saved line and next-target guidance", async () => {
  const db = newDb();
  const { ctx, sent } = await ctxFor(db, 1);

  await handleWorkoutLog(ctx as never, "Bench press 60x8");

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Logged/);
  assert.match(sent[0].text, /Next time/);
  assert.match(sent[0].text, /Bench press/);
});

test("finalizeWorkoutLog: a PR still shows in the SAME single message, with the share keyboard", async () => {
  const db = newDb();
  const { ctx, sent } = await ctxFor(db, 2);

  await handleWorkoutLog(ctx as never, "Bench press 60x8");
  sent.length = 0; // only care about the second (PR) save
  await handleWorkoutLog(ctx as never, "Bench press 65x8"); // heavier -> a PR

  assert.equal(sent.length, 1);
  assert.equal(sent[0].hasKb, true); // celebration share/invite keyboard
  assert.match(sent[0].text, /Bench press/);
});

test("finalizeWorkoutLog: a near-max set (RPE >= 9.5) gets the overload flag in the recap", async () => {
  const db = newDb();
  const { ctx, sent } = await ctxFor(db, 3);

  await handleWorkoutLog(ctx as never, "Squat 100x5 rpe 9.5");

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /near max/);
});

test("nextTargetGuidance: prioritizes PR exercises first and caps the list", () => {
  const exercises: LoggedExercise[] = [
    { name: "A", setsDone: [{ weight: 40, reps: 8 }], skipped: false },
    { name: "B", setsDone: [{ weight: 50, reps: 8 }], skipped: false },
    { name: "C (PR)", setsDone: [{ weight: 60, reps: 8 }], skipped: false },
    { name: "D", setsDone: [{ weight: 70, reps: 8 }], skipped: false },
  ];
  const guidance = nextTargetGuidance(exercises, ["C (PR)"], 2);
  assert.equal(guidance.length, 2);
  assert.equal(guidance[0].name, "C (PR)"); // PR exercise surfaces first despite being 3rd in the log
});

test("nextTargetGuidance: skips skipped exercises and non-weight metrics (time/distance)", () => {
  const exercises: LoggedExercise[] = [
    { name: "Skipped Lift", setsDone: [{ weight: 40, reps: 8 }], skipped: true },
    { name: "Plank", setsDone: [{ weight: 0, reps: 0, seconds: 60 }], skipped: false },
    { name: "Real Lift", setsDone: [{ weight: 40, reps: 8 }], skipped: false },
  ];
  const guidance = nextTargetGuidance(exercises, []);
  assert.deepEqual(guidance.map((g) => g.name), ["Real Lift"]);
});

test("nextTargetGuidance: flags overload only at RPE >= 9.5, matching nextTarget's own hold threshold", () => {
  const moderate: LoggedExercise[] = [{ name: "A", setsDone: [{ weight: 40, reps: 8 }], skipped: false, rpe: 8 }];
  const max: LoggedExercise[] = [{ name: "A", setsDone: [{ weight: 40, reps: 8 }], skipped: false, rpe: 9.5 }];
  assert.equal(nextTargetGuidance(moderate, [])[0].overload, false);
  assert.equal(nextTargetGuidance(max, [])[0].overload, true);
});
