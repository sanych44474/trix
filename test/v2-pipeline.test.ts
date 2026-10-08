// The /api/v2 request pipeline (v2Api.ts forward): throttling, the idempotency claim and what happens
// to a failure. Every test goes through the real handler so the ORDER of the stages is covered too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleV2Api } from "../src/webapp/v2Api";
import worker from "../src/index";
import { claimIdempotencyKey, completeIdempotencyClaim, runIdempotent, WORKOUT_SAVE_WINDOW_HOURS } from "../src/adapters/d1/v2Idempotency";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { expensiveBucket } from "../src/limits";
import { newDb } from "./harness";
import type { Env } from "../src/types";

type Db = ReturnType<typeof newDb>;
const quiet = () => {
  const e = console.error, l = console.log;
  console.error = () => {}; console.log = () => {};
  return () => { console.error = e; console.log = l; };
};
const envFor = (db: Db, extra: Record<string, unknown> = {}) =>
  ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test", ...extra }) as unknown as Env;
function limiter(allow: (key: string) => boolean) {
  const keys: string[] = [];
  return { keys, binding: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: allow(key) }; } } };
}
async function call(env: Env, userId: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const url = `https://example.test${path}${path.includes("?") ? "&" : "?"}debugUser=${userId}`;
  const req = new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return handleV2Api(req, new URL(url), env);
}

test("expensiveBucket: POST on the four costly surfaces only, whole path segments", () => {
  assert.equal(expensiveBucket("POST", "/api/v2/media/meal"), "media");
  assert.equal(expensiveBucket("POST", "/api/v2/coach"), "coach");
  assert.equal(expensiveBucket("POST", "/api/v2/chat"), "chat");
  assert.equal(expensiveBucket("POST", "/api/v2/settings"), "settings");
  assert.equal(expensiveBucket("GET", "/api/v2/coach/thread"), null, "reads are not throttled");
  assert.equal(expensiveBucket("POST", "/api/v2/mediaX"), null);
  assert.equal(expensiveBucket("POST", "/api/v2/workout/save"), null);
});

test("pipeline: a throttled expensive action is a 429 rate_limited envelope with Retry-After, keyed per user", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9301, 9301, "en", "T");
  const l = limiter(() => false);
  const res = await call(envFor(db, { RL_EXPENSIVE: l.binding }), 9301, "POST", "/api/v2/coach", { message: "hi" });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "60");
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "rate_limited");
  assert.deepEqual(l.keys, ["coach:9301"]);
});

test("pipeline: reads and un-throttled routes never touch the limiter", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9302, 9302, "en", "T");
  const l = limiter(() => false);
  const env = envFor(db, { RL_EXPENSIVE: l.binding });
  assert.notEqual((await call(env, 9302, "GET", "/api/v2/coach/thread")).status, 429);
  assert.notEqual((await call(env, 9302, "POST", "/api/v2/workout/rest", { seconds: 60 })).status, 429);
  assert.deepEqual(l.keys, []);
});

test("pipeline: with no limiter binding the request goes through (fail open)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9303, 9303, "en", "T");
  const restore = quiet();
  try {
    const res = await call(envFor(db), 9303, "POST", "/api/v2/workout/rest", { seconds: 60 });
    assert.equal(res.status, 200);
  } finally { restore(); }
});

test("pipeline: a limiter that throws fails open too", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9304, 9304, "en", "T");
  const restore = quiet();
  try {
    const broken = { limit: async () => { throw new Error("limiter down"); } };
    const res = await call(envFor(db, { RL_EXPENSIVE: broken }), 9304, "POST", "/api/v2/settings", {});
    assert.notEqual(res.status, 429);
  } finally { restore(); }
});

test("/admin: throttled by client IP before the secret is compared; otherwise the secret decides", async () => {
  const db = newDb();
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const mk = (extra: Record<string, unknown>) => ({ DB: db, TELEGRAM_BOT_TOKEN: "t", ADMIN_SECRET: "right", ...extra }) as unknown as Env;
  const req = (secret: string) => new Request("https://w.example/admin/ping-stuck", { method: "POST", headers: { "X-Admin-Secret": secret, "cf-connecting-ip": "203.0.113.9" } });

  const blocked = limiter(() => false);
  const res429 = await worker.fetch(req("right"), mk({ RL_ADMIN: blocked.binding }), ctx);
  assert.equal(res429.status, 429, "even the right secret is refused once the IP is over the limit");
  assert.deepEqual(blocked.keys, ["203.0.113.9"]);

  const open = limiter(() => true);
  assert.equal((await worker.fetch(req("wrong"), mk({ RL_ADMIN: open.binding }), ctx)).status, 401);
  assert.notEqual((await worker.fetch(req("right"), mk({ RL_ADMIN: open.binding }), ctx)).status, 401);
});

// ---- idempotency ----

const SAVE = { entries: [{ name: "Bench Press", sets: [{ reps: 8, weight: 60 }] }] };
const sessions = async (db: Db, id: number) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM v2_workout_sessions WHERE accountId = ?").bind(id).first<{ n: number }>())!.n;

test("pipeline: a workout-save replay after more than 24 h but inside the 15-day window is answered from the cache", async () => {
  const db = newDb();
  const id = 9310;
  await getOrCreateUser(db, id, id, "en", "T");
  const env = envFor(db);
  const headers = { "Idempotency-Key": "offline-replay-0001" };
  const first = await call(env, id, "POST", "/api/v2/workout/save", SAVE, headers);
  assert.equal(first.status, 200);

  // The client was offline for five days; meanwhile the user edited that day (a different save).
  await db.prepare("UPDATE v2_idempotency SET createdAt = ? WHERE accountId = ?").bind(new Date(Date.now() - 5 * 86_400_000).toISOString(), id).run();
  const edited = await call(env, id, "POST", "/api/v2/workout/save", { entries: [{ name: "Squat", sets: [{ reps: 5, weight: 100 }] }] }, { "Idempotency-Key": "a-newer-save-0002" });
  assert.equal(edited.status, 200);

  const replay = await call(env, id, "POST", "/api/v2/workout/save", SAVE, headers);
  assert.equal(replay.status, 200);
  const squat = await db.prepare("SELECT COUNT(*) AS n FROM v2_workout_exercises WHERE name = 'Squat'").first<{ n: number }>();
  assert.equal(squat!.n, 1, "the replay did not overwrite the edit made in between");
  assert.equal(await sessions(db, id), 1);
});

test("pipeline: the default window is still 24 h for everything else", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9311, 9311, "en", "T");
  assert.ok(WORKOUT_SAVE_WINDOW_HOURS > 14 * 24, "longer than the 14-day edit limit");
  const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await db.prepare("INSERT INTO v2_idempotency (accountId, key, response, status, state, createdAt) VALUES (9311, 'old-key-00001', '{}', 200, 'done', ?)").bind(old).run();
  assert.deepEqual(await claimIdempotencyKey(db, 9311, "old-key-00001"), { claimed: true }, "two days old: a new action");
  assert.equal((await claimIdempotencyKey(db, 9311, "old-key-00001", WORKOUT_SAVE_WINDOW_HOURS)).claimed, false, "same row, longer window: replayed");
});

test("runIdempotent: a 5xx result is not cached; the next attempt with the same key runs fresh", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9312, 9312, "en", "T");
  let runs = 0;
  const attempt = (status: number) => runIdempotent(db, 9312, "retry-key-0001", async () => { runs++; return { status, body: { n: runs } }; });
  assert.equal((await attempt(503)).status, 503);
  const second = await attempt(200);
  assert.equal(second.status, 200, "ran again instead of replaying the 503");
  assert.equal(runs, 2);
  const replay = await attempt(500);
  assert.equal(runs, 2, "a 200 IS cached");
  assert.equal(replay.status, 200);
});

test("runIdempotent: a handler that throws releases the claim", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9313, 9313, "en", "T");
  await assert.rejects(runIdempotent(db, 9313, "throw-key-0001", async () => { throw new Error("boom"); }), /boom/);
  const again = await runIdempotent(db, 9313, "throw-key-0001", async () => ({ status: 200, body: { ok: true } }));
  assert.equal(again.status, 200, "not stuck as 'processing'");
  await completeIdempotencyClaim(db, 9313, "other-key-0001", 200, {}); // helper still exported and harmless
});

// ---- failures ----

test("pipeline: a handler crash is a 500 envelope that reaches error_events once, and the key is reusable", async () => {
  const db = newDb();
  const id = 9320;
  await getOrCreateUser(db, id, id, "en", "T");
  let broken = true;
  const wrapped = {
    prepare: (sql: string) => {
      if (broken && /INSERT/i.test(sql) && /v2_workout_sessions/.test(sql)) throw new Error("disk on fire");
      return db.prepare(sql);
    },
    batch: (stmts: unknown[]) => db.batch(stmts as never),
  } as unknown as Db;
  const restore = quiet();
  try {
    const headers = { "Idempotency-Key": "crash-retry-0001" };
    const failed = await call(envFor(wrapped), id, "POST", "/api/v2/workout/save", SAVE, headers);
    assert.equal(failed.status, 500);
    assert.equal(((await failed.json()) as { error: { code: string } }).error.code, "dependency_unavailable");
    const rows = await db.prepare("SELECT COUNT(*) AS n FROM v2_error_events WHERE kind = 'api_workout'").first<{ n: number }>();
    assert.equal(rows!.n, 1, "recorded exactly once, not by both the handler and the pipeline");

    broken = false;
    const retry = await call(envFor(wrapped), id, "POST", "/api/v2/workout/save", SAVE, headers);
    assert.equal(retry.status, 200, "the failed attempt did not poison the key");
  } finally { restore(); }
});
