import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getSetting, setSetting, setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { newDb } from "./harness";
import type { Env } from "../src/types";

// The dead-man switch used to hang off the legacy GET /api/dashboard branch only. Every user is on
// the v2 client (V2_APP_ENABLED), which calls /api/v2/dashboard -- so the "cron is not running"
// alert had become unreachable in production. These two tests pin it to the v2 branch.

async function withStubbedNetwork<T>(run: (calls: string[]) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Collects waitUntil promises so the test can await the detached heartbeat check. */
function ctxStub(): ExecutionContext & { settled: () => Promise<unknown[]> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
    props: {},
    settled: () => Promise.all(pending),
  } as unknown as ExecutionContext & { settled: () => Promise<unknown[]> };
}

test("v2 dashboard arms the cron dead-man switch when the heartbeat is stale", async () => {
  const db = newDb();
  const userId = 9101;
  await getOrCreateUser(db, userId, userId, "en", "Test");
  await setOwnerChatId(db, userId);
  // Older than checkCronHeartbeat's 10-minute threshold.
  await setSetting(db, "cron_heartbeat", new Date(Date.now() - 45 * 60_000).toISOString());

  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env; // no WORKER_URL -> debugUser bypass
  const ctx = ctxStub();

  await withStubbedNetwork(async (calls) => {
    const request = new Request(`https://example.test/api/v2/dashboard?debugUser=${userId}`);
    await handleV2Api(request, new URL(request.url), env, ctx);
    await ctx.settled();
    assert.ok(
      calls.some((u) => u.includes("/sendMessage")),
      `expected the owner alert to be sent, got: ${JSON.stringify(calls)}`,
    );
  });

  // The once-per-hour throttle stamp is what proves the check actually ran to completion.
  assert.ok(await getSetting(db, "cron_alerted"), "cron_alerted should be stamped after alerting");
});

test("v2 dashboard does not alert while the cron heartbeat is fresh", async () => {
  const db = newDb();
  const userId = 9102;
  await getOrCreateUser(db, userId, userId, "en", "Test");
  await setOwnerChatId(db, userId);
  await setSetting(db, "cron_heartbeat", new Date().toISOString());

  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;
  const ctx = ctxStub();

  await withStubbedNetwork(async (calls) => {
    const request = new Request(`https://example.test/api/v2/dashboard?debugUser=${userId}`);
    await handleV2Api(request, new URL(request.url), env, ctx);
    await ctx.settled();
    assert.equal(calls.some((u) => u.includes("/sendMessage")), false, "a fresh heartbeat must not alert");
  });

  assert.equal(await getSetting(db, "cron_alerted"), null);
});
