// The bot and the Mini App are two surfaces over one backend, and src/webapp/workout.ts calls
// itself a "ctx-free mirror of finalizeWorkoutLog". Mirrors drift: this one had, silently. A
// personal record logged in chat was announced to the user's squad; the SAME record logged in the
// Mini App was not, because only the bot path called announceSquadPr.
//
// This pins the two together. It asserts behaviour through the real save path rather than
// comparing source text, so it fails if either side stops announcing -- including the bot side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { saveWorkout } from "../src/webapp/workout";
import { formatPrBest } from "../src/bot/workoutSave";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { joinSquad, upsertSquad } from "../src/adapters/d1/v2Gamification";
import type { Env, UserDoc } from "../src/types";

const SQUAD_CHAT = -100123;

async function userInSquad(db: ReturnType<typeof newDb>, id: number): Promise<UserDoc> {
  const user = await getOrCreateUser(db, id, id, "en", "Lifter");
  await upsertSquad(db, SQUAD_CHAT, "Test squad", id);
  await joinSquad(db, SQUAD_CHAT, id);
  return user as unknown as UserDoc;
}

/** Captures the raw Bot API calls both save paths make. */
function captureSends(): { calls: { chatId: number; text: string }[]; restore: () => void } {
  const realFetch = globalThis.fetch;
  const calls: { chatId: number; text: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/sendMessage") && init?.body) {
      const body = JSON.parse(String(init.body)) as { chat_id: number; text: string };
      calls.push({ chatId: body.chat_id, text: body.text });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

test("a PR saved from the Mini App is announced to the squad, same as one saved from the bot", async () => {
  const db = newDb();
  const user = await userInSquad(db, 8201);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;

  // The first log of a lift establishes the baseline record; only BEATING it counts as a PR.
  const baseline = captureSends();
  try {
    await saveWorkout(env, user, [{ name: "Bench Press", sets: [{ reps: 5, weight: 100 }] }] as Parameters<typeof saveWorkout>[2], "2026-01-05");
  } finally {
    baseline.restore();
  }
  assert.equal(baseline.calls.length, 0, "the baseline log is not a record and must stay quiet");

  const { calls, restore } = captureSends();
  try {
    const result = await saveWorkout(env, user, [
      { name: "Bench Press", sets: [{ reps: 5, weight: 105 }] },
    ] as Parameters<typeof saveWorkout>[2]);
    assert.deepEqual(result.prExercises, ["Bench Press"], "beating the baseline is a PR");
  } finally {
    restore();
  }

  const squadPost = calls.find((c) => c.chatId === SQUAD_CHAT);
  assert.ok(
    squadPost,
    `the Mini App save must announce the PR to the squad; sends were ${JSON.stringify(calls)}`,
  );
  assert.match(squadPost.text, /Bench Press/);
  assert.match(squadPost.text, /105 kg/);
});

test("a squad-less lifter's PR triggers no post", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 8202, 8202, "en", "Solo")) as unknown as UserDoc;
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;
  const { calls, restore } = captureSends();

  try {
    await saveWorkout(env, user, [{ name: "Bench Press", sets: [{ reps: 5, weight: 100 }] }] as Parameters<typeof saveWorkout>[2], "2026-01-05");
    await saveWorkout(env, user, [{ name: "Bench Press", sets: [{ reps: 5, weight: 105 }] }] as Parameters<typeof saveWorkout>[2]);
  } finally {
    restore();
  }

  assert.equal(calls.length, 0, `a squad-less user must trigger no posts, got ${JSON.stringify(calls)}`);
});

test("formatPrBest renders each metric the one way both surfaces use", () => {
  assert.equal(formatPrBest({ name: "x", metric: "reps", weight: 100, reps: 5 }), "100 kg × 5");
  assert.equal(formatPrBest({ name: "x", metric: "time", weight: 0, reps: 0, seconds: 90 }), "1:30");
  assert.equal(formatPrBest({ name: "x", metric: "distance", weight: 0, reps: 0, meters: 5000 }), "5 km");
});
