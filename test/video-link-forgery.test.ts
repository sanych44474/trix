// GET /v?u=<youtube url>&uid=<id> used to trust `uid` outright: anyone could hit the endpoint
// with any id and inflate a stranger's video_open counter with zero authentication. The redirect
// itself must keep working unconditionally (a link generated before this landed must not break),
// so only the counter bump is gated on a signature -- see src/domain/videoLink.ts.
import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { buildVideoOpenLink, signVideoOpen, verifyVideoOpen } from "../src/domain/videoLink";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const BOT_TOKEN = "test-bot-token";
const YT_URL = "https://www.youtube.com/watch?v=abc123";

function ctxStub(): ExecutionContext & { settled: () => Promise<unknown[]> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
    props: {},
    settled: () => Promise.all(pending),
  } as unknown as ExecutionContext & { settled: () => Promise<unknown[]> };
}

function testEnv(db: ReturnType<typeof newDb>): Env {
  return { DB: db, TELEGRAM_BOT_TOKEN: BOT_TOKEN } as unknown as Env;
}

async function eventCount(db: ReturnType<typeof newDb>, uid: number): Promise<number> {
  const r = await db
    .prepare("SELECT count FROM v2_analytics_events WHERE accountId = ? AND event = 'video_open'")
    .bind(uid)
    .first<{ count: number }>();
  return r?.count ?? 0;
}

test("videoLink: signVideoOpen is deterministic and binds both uid and url", async () => {
  const a = await signVideoOpen(42, YT_URL, BOT_TOKEN);
  const b = await signVideoOpen(42, YT_URL, BOT_TOKEN);
  assert.equal(a, b, "same inputs must produce the same signature");
  assert.notEqual(a, await signVideoOpen(43, YT_URL, BOT_TOKEN), "a different uid must change the signature");
  assert.notEqual(a, await signVideoOpen(42, "https://www.youtube.com/watch?v=other", BOT_TOKEN), "a different url must change the signature");
});

test("videoLink: verifyVideoOpen accepts the matching signature and rejects everything else", async () => {
  const sig = await signVideoOpen(42, YT_URL, BOT_TOKEN);
  assert.equal(await verifyVideoOpen(42, YT_URL, sig, BOT_TOKEN), true);
  assert.equal(await verifyVideoOpen(42, YT_URL, "", BOT_TOKEN), false, "empty sig");
  assert.equal(await verifyVideoOpen(42, YT_URL, "deadbeef", BOT_TOKEN), false, "wrong sig");
  assert.equal(await verifyVideoOpen(99, YT_URL, sig, BOT_TOKEN), false, "sig for a different uid");
  assert.equal(await verifyVideoOpen(42, YT_URL, sig, "other-bot-token"), false, "wrong key");
});

test("videoLink: buildVideoOpenLink is a no-op passthrough with no baseUrl (matches every prior call site's behavior)", async () => {
  assert.equal(await buildVideoOpenLink(undefined, YT_URL, 42, BOT_TOKEN), YT_URL);
});

test("GET /v: a forged uid with no sig still redirects but does NOT bump the counter", async () => {
  const db = newDb();
  const victim = await getOrCreateUser(db, 4301, 4301, "en", "Victim");
  const env = testEnv(db);
  const ctx = ctxStub();

  const req = new Request(`https://x/v?u=${encodeURIComponent(YT_URL)}&uid=${victim._id}`);
  const res = await worker.fetch(req, env, ctx);
  await ctx.settled();

  assert.equal(res.status, 302, "the redirect must still work for an unsigned/legacy link");
  assert.equal(res.headers.get("location"), YT_URL);
  assert.equal(await eventCount(db, victim._id), 0, "an unsigned uid must not inflate the victim's counter");
});

test("GET /v: a forged uid with a garbage sig redirects but does NOT bump the counter", async () => {
  const db = newDb();
  const victim = await getOrCreateUser(db, 4302, 4302, "en", "Victim");
  const env = testEnv(db);
  const ctx = ctxStub();

  const req = new Request(`https://x/v?u=${encodeURIComponent(YT_URL)}&uid=${victim._id}&sig=0000000000000000`);
  const res = await worker.fetch(req, env, ctx);
  await ctx.settled();

  assert.equal(res.status, 302);
  assert.equal(await eventCount(db, victim._id), 0);
});

test("GET /v: replaying another user's valid sig against a DIFFERENT url does NOT bump the counter", async () => {
  const db = newDb();
  const victim = await getOrCreateUser(db, 4303, 4303, "en", "Victim");
  const env = testEnv(db);
  const ctx = ctxStub();
  // A real signature, but minted for a different video -- the (uid, url) pair must match exactly.
  const sigForOtherVideo = await signVideoOpen(victim._id, "https://www.youtube.com/watch?v=different", BOT_TOKEN);

  const req = new Request(`https://x/v?u=${encodeURIComponent(YT_URL)}&uid=${victim._id}&sig=${sigForOtherVideo}`);
  const res = await worker.fetch(req, env, ctx);
  await ctx.settled();

  assert.equal(res.status, 302);
  assert.equal(await eventCount(db, victim._id), 0);
});

test("GET /v: a genuine signed link redirects AND bumps the right account's counter", async () => {
  const db = newDb();
  const user = await getOrCreateUser(db, 4304, 4304, "en", "Real");
  const env = testEnv(db);
  const ctx = ctxStub();
  const link = await buildVideoOpenLink("https://x", YT_URL, user._id, BOT_TOKEN);

  const res = await worker.fetch(new Request(link), env, ctx);
  await ctx.settled();

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), YT_URL);
  assert.equal(await eventCount(db, user._id), 1, "a genuinely minted link must still count normally");
});
