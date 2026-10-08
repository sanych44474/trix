// rawTelegramApi / sendBestEffort: Telegram over fetch. The thing under test is that a REFUSAL is
// an error. Telegram answers a blocked bot or a rate limit with HTTP 4xx + JSON, not a thrown
// exception, and the old hand-written fetch helpers treated any response as success -- so the
// notification outbox would have recorded a message to a blocked trainer as "sent".
import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { newDb } from "./harness";
import { rawTelegramApi, sendBestEffort } from "../src/adapters/telegram/rawApi";
import { enqueueAndDeliver } from "../src/schedulerOutbox";
import { completeWorkout } from "../src/bot/workoutSave";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import type { Env, UserDoc, Weekday } from "../src/types";

const env = { TELEGRAM_BOT_TOKEN: "1:t" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return handler(String(url), init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("rawTelegramApi: success returns the result and posts chat_id, text and extras", async () => {
  const s = stubFetch(() => json(200, { ok: true, result: { message_id: 5 } }));
  try {
    const out = await rawTelegramApi(env).sendMessage(42, "hi", { parse_mode: "HTML" });
    assert.deepEqual(out, { message_id: 5 });
    assert.equal(s.calls[0]!.url, "https://api.telegram.org/bot1:t/sendMessage");
    assert.deepEqual(s.calls[0]!.body, { chat_id: 42, text: "hi", parse_mode: "HTML" });
  } finally { s.restore(); }
});

test("rawTelegramApi: a blocked bot and a rate limit throw the GrammyError the outbox classifies", async () => {
  const blocked = stubFetch(() => json(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
  try {
    await assert.rejects(rawTelegramApi(env).sendMessage(1, "x"), (e: unknown) => e instanceof GrammyError && e.error_code === 403);
  } finally { blocked.restore(); }

  const limited = stubFetch(() => json(429, { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } }));
  try {
    await assert.rejects(rawTelegramApi(env).sendMessage(1, "x"), (e: unknown) => e instanceof GrammyError && e.error_code === 429 && e.parameters?.retry_after === 7);
  } finally { limited.restore(); }
});

test("rawTelegramApi: a non-JSON error body still fails with the HTTP status", async () => {
  const s = stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
  try {
    await assert.rejects(rawTelegramApi(env).sendMessage(1, "x"), (e: unknown) => e instanceof GrammyError && e.error_code === 502);
  } finally { s.restore(); }
});

test("sendBestEffort: true on success, false on a refusal or a network error, never throws", async () => {
  const ok = stubFetch(() => json(200, { ok: true, result: {} }));
  try { assert.equal(await sendBestEffort(env, 1, "x"), true); } finally { ok.restore(); }
  const refused = stubFetch(() => json(403, { ok: false, error_code: 403, description: "blocked" }));
  try { assert.equal(await sendBestEffort(env, 1, "x"), false); } finally { refused.restore(); }
  const down = stubFetch(() => { throw new TypeError("network down"); });
  try { assert.equal(await sendBestEffort(env, 1, "x"), false); } finally { down.restore(); }
  const withMarkup = stubFetch(() => json(200, { ok: true, result: {} }));
  try {
    await sendBestEffort(env, 9, "x", { inline_keyboard: [] });
    assert.deepEqual(withMarkup.calls[0]!.body, { chat_id: 9, text: "x", parse_mode: "HTML", reply_markup: { inline_keyboard: [] } });
  } finally { withMarkup.restore(); }
});

test("outbox over rawTelegramApi: 200 is sent, 403 is blocked (and flags the user), 429 is queued for retry", async () => {
  const db = newDb();
  await getOrCreateUser(db, 700, 700, "en", "Trainer");
  const e = { DB: db, TELEGRAM_BOT_TOKEN: "1:t" } as unknown as Env;
  const send = (key: string) => enqueueAndDeliver(e, { api: rawTelegramApi(e) }, { userId: 700, chatId: 700, kind: "t", idempotencyKey: key, text: "x" });

  const ok = stubFetch(() => json(200, { ok: true, result: {} }));
  try { assert.equal(await send("k-ok"), "sent"); } finally { ok.restore(); }

  const limited = stubFetch(() => json(429, { ok: false, error_code: 429, description: "slow down", parameters: { retry_after: 30 } }));
  try { assert.equal(await send("k-429"), "retrying"); } finally { limited.restore(); }

  const blocked = stubFetch(() => json(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
  try { assert.equal(await send("k-403"), "blocked"); } finally { blocked.restore(); }
  assert.equal(((await getUser(db, 700)) as UserDoc).botBlocked, true, "a blocked trainer is flagged, as for any outbox send");
});

test("completeWorkout over the Mini App's adapter: a trainer who blocked the bot is recorded as blocked, not 'sent'", async () => {
  const db = newDb();
  await getOrCreateUser(db, 710, 710, "en", "Coach");
  await updateUser(db, 710, { role: "trainer" });
  await getOrCreateUser(db, 711, 711, "en", "Client");
  await linkClient(db, 711, 710);
  await updateUser(db, 711, { role: "client", trainerId: 710 });
  const client = (await getUser(db, 711)) as UserDoc;
  const e = { DB: db, TELEGRAM_BOT_TOKEN: "1:t" } as unknown as Env;

  const s = stubFetch(() => json(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
  try {
    const done = await completeWorkout(e, client, [{ name: "Bench Press", sets: [{ reps: 8, weight: 60 }] }], {
      date: "2026-10-08", weekday: 4 as Weekday, rawText: "bench", api: rawTelegramApi(e),
    });
    assert.equal(done.totalWorkouts, 1, "the workout saved regardless");
  } finally { s.restore(); }
  const row = await db.prepare("SELECT status FROM v2_notifications WHERE kind = 'trainer_workout_done'").first<{ status: string }>();
  assert.equal(row?.status, "blocked");
});
