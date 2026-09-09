// Improvement #1 from the production-readiness list: nothing previously stopped a single user
// from firing repeated AI calls and burning through shared free-tier quota. run() now checks
// aiAttemptCountForUserSince before doing any provider work and throws RateLimitError (the same
// error type providers throw on 429/503, so it flows through the existing "limit_hit" message
// handling in router.ts/plan.ts with no changes needed there) once a user crosses the threshold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { aiText, RateLimitError } from "../src/ai/index";
import { aiCallStmt } from "../src/db/repos";
import type { Env } from "../src/types";

async function seedAttempts(db: ReturnType<typeof newDb>, userId: number, n: number) {
  const stmts = Array.from({ length: n }, () =>
    aiCallStmt(db, { userId, provider: "gemini", kind: "coach", latencyMs: 10, wasFallback: false }),
  );
  await db.batch(stmts);
}

test("run(): throws RateLimitError once a user crosses the attempt threshold, without calling any provider", async () => {
  const db = newDb();
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
