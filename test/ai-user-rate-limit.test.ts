// Improvement #1 from the production-readiness list: nothing previously stopped a single user
// from firing repeated AI calls and burning through shared free-tier quota. run() now checks
// aiAttemptCountForUserSince before doing any provider work and throws RateLimitError (the same
// error type providers throw on 429/503, so it flows through the existing "limit_hit" message
// handling in router.ts/plan.ts with no changes needed there) once a user crosses the threshold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { aiText } from "../src/ai";
import { RateLimitError } from "../src/ai/errors";
import { aiCallStmt } from "../src/adapters/d1/v2AiTelemetry";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import type { Env } from "../src/types";

async function seedAttempts(db: ReturnType<typeof newDb>, userId: number, n: number) {
  const stmts = Array.from({ length: n }, () =>
    aiCallStmt(db, { userId, provider: "gemini", kind: "coach", latencyMs: 10, wasFallback: false }),
  );
  await db.batch(stmts);
}

test("run(): throws RateLimitError once a user crosses the attempt threshold, without calling any provider", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en");
  await seedAttempts(db, 1, 20); // at the limit already
  let fetchCalled = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalled = true; return new Response("nope"); }) as typeof fetch;
  try {
    const env = { GROQ_API_KEY: "k" } as unknown as Env;
    await assert.rejects(
      () => aiText(env, { system: "s", user: "u", kind: "coach", db, userId: 1 }),
      RateLimitError,
    );
    assert.equal(fetchCalled, false, "should fail fast before touching any provider");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("run(): a user under the threshold is not limited", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "en");
  await seedAttempts(db, 2, 5); // well under the limit
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 })) as typeof fetch;
  try {
    const env = { GROQ_API_KEY: "k" } as unknown as Env;
    const out = await aiText(env, { system: "s", user: "u", kind: "coach", db, userId: 2 });
    assert.equal(out, "hi");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("run(): the limit is scoped per-user, not global", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en");
  await getOrCreateUser(db, 2, 2, "en");
  await seedAttempts(db, 1, 20); // user 1 is at the limit
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 })) as typeof fetch;
  try {
    const env = { GROQ_API_KEY: "k" } as unknown as Env;
    // user 2 has zero attempts logged — should go through fine even though user 1 is limited
    const out = await aiText(env, { system: "s", user: "u", kind: "coach", db, userId: 2 });
    assert.equal(out, "hi");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("run(): a parallel burst cannot overshoot the per-user window (atomic admission, ai/limiter.ts)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 3, 3, "en");
  const realFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 }); }) as typeof fetch;
  try {
    const env = { GROQ_API_KEY: "k" } as unknown as Env;
    const results = await Promise.allSettled(Array.from({ length: 26 }, (_, i) => aiText(env, { system: "s", user: `u${i}`, kind: "coach", db, userId: 3 })));
    const limited = results.filter((r) => r.status === "rejected" && r.reason instanceof RateLimitError).length;
    assert.ok(limited >= 6, `limited ${limited} of 26`);
    assert.ok(providerCalls <= 20, `provider called ${providerCalls} times`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("run(): the daily service ceiling refuses before any provider is called", async () => {
  const db = newDb();
  await getOrCreateUser(db, 4, 4, "en");
  const { DAILY_CALLS, dayKey } = await import("../src/ai/limiter");
  db.dump("INSERT INTO v2_settings (key, value) VALUES (?, ?)", dayKey(Date.now()), String(DAILY_CALLS));
  let fetchCalled = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalled = true; return new Response("nope"); }) as typeof fetch;
  try {
    const env = { GROQ_API_KEY: "k" } as unknown as Env;
    await assert.rejects(() => aiText(env, { system: "s", user: "u", kind: "coach", db, userId: 4 }), RateLimitError);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
