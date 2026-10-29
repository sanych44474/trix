import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTrainingSignals } from "../src/features/trainingSignals";
import { upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const ago = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const NOON = new Date("2026-10-29T12:00:00Z");
const TOMORROW = new Date("2026-10-30T12:00:00Z");

async function account(db: ReturnType<typeof newDb>, id: number) {
  const now = NOON.toISOString();
  await db.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)").bind(id, id, id, now, now).run();
}

async function seed(db: ReturnType<typeof newDb>, now: Date) {
  await account(db, 1);
  for (const n of [3, 10, 17]) {
    await upsertWorkoutLog(
      db as never,
      1,
      ago(now, n),
      3,
      [{ name: "Squat", skipped: false, setsDone: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }] }],
      true,
    );
  }
}

/** A Clef stub that answers every question it is sent, in the question's own type. */
function clefStub(calls: Array<{ model: string; input: { questions: Record<string, { type: string }> } }>, fail = false) {
  return async (model: string, input: unknown) => {
    const inp = input as { questions: Record<string, { type: string }> };
    calls.push({ model, input: inp });
    if (fail) throw new Error("boom");
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(inp.questions)) {
      answers[id] =
        q.type === "noul"
          ? { type: "noul", noul: 0.8 }
          : { type: "choice", choice: "stalled", probabilities: { stalled: 0.9 }, confidence: 0.75 };
    }
    return { model: "clef-flash", answers, usage: { input_tokens: 100, output_tokens: 2 } };
  };
}

test("loadTrainingSignals asks Clef once and serves the rest of the UTC day from cache", async () => {
  const db = newDb();
  await seed(db, NOON);
  const calls: Array<{ model: string; input: { questions: Record<string, { type: string }> } }> = [];
  const env = { AI: { run: clefStub(calls) }, DB: db } as unknown as Env;

  const first = await loadTrainingSignals(env, 1, NOON);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "@cf/cloudflare/clef-flash");
  assert.ok("lift_0" in calls[0].input.questions);
  assert.deepEqual(first.exercises, [{ name: "Squat", status: "stalled", confidence: 0.75 }]);
  assert.deepEqual(first.deload, { probability: 0.8, suggested: true });
  assert.equal(first.computedAt, NOON.toISOString());

  const again = await loadTrainingSignals(env, 1, new Date("2026-10-29T20:00:00Z"));
  assert.equal(calls.length, 1, "a second load the same UTC day must not call Clef");
  assert.deepEqual(again, first);

  await loadTrainingSignals(env, 1, TOMORROW);
  assert.equal(calls.length, 2, "a new UTC day recomputes");
});

test("loadTrainingSignals returns empty signals, not an error, when Clef fails", async () => {
  const db = newDb();
  await seed(db, NOON);
  const calls: Array<{ model: string; input: { questions: Record<string, { type: string }> } }> = [];
  const env = { AI: { run: clefStub(calls, true) }, DB: db } as unknown as Env;

  const out = await loadTrainingSignals(env, 1, NOON);
  assert.deepEqual(out.exercises, []);
  assert.equal(out.deload, null);
});

test("a failed Clef call is not cached: the next load the same day asks again", async () => {
  const db = newDb();
  await seed(db, NOON);
  const calls: Array<{ model: string; input: { questions: Record<string, { type: string }> } }> = [];
  const failing = { AI: { run: clefStub(calls, true) }, DB: db } as unknown as Env;
  await loadTrainingSignals(failing, 1, NOON);

  const working = { AI: { run: clefStub(calls) }, DB: db } as unknown as Env;
  const later = await loadTrainingSignals(working, 1, new Date("2026-10-29T20:00:00Z"));
  assert.equal(calls.length, 2);
  assert.deepEqual(later.exercises, [{ name: "Squat", status: "stalled", confidence: 0.75 }]);
});

test("loadTrainingSignals does not call Clef for a user with no usable history", async () => {
  const db = newDb();
  await account(db, 1);
  const calls: Array<{ model: string; input: { questions: Record<string, { type: string }> } }> = [];
  const env = { AI: { run: clefStub(calls) }, DB: db } as unknown as Env;

  const out = await loadTrainingSignals(env, 1, NOON);
  assert.equal(calls.length, 0);
  assert.deepEqual(out, { exercises: [], deload: null, computedAt: NOON.toISOString() });
});

test("the cache is per user", async () => {
  const db = newDb();
  await seed(db, NOON);
  await account(db, 2);
  const calls: Array<{ model: string; input: { questions: Record<string, { type: string }> } }> = [];
  const env = { AI: { run: clefStub(calls) }, DB: db } as unknown as Env;

  await loadTrainingSignals(env, 1, NOON);
  const other = await loadTrainingSignals(env, 2, NOON);
  assert.equal(calls.length, 1, "user 2 has no history, so no call, and no cache hit from user 1");
  assert.deepEqual(other.exercises, []);
});
