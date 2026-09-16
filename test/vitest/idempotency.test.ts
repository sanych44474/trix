// Idempotency-key claim/replay, against real D1 -- the whole point of the claim design is an
// INSERT that fails atomically on a PK conflict, which is exactly the kind of D1-specific
// semantic the node:sqlite-backed node:test harness can't promise matches real D1.
//
// Domain 9 of the v2 cutover repointed every real caller (src/webapp/v2Api.ts, miscApi.ts,
// settingsApi.ts, trainerApi.ts, workoutApi.ts) from src/db/repos/idempotency.ts (legacy
// idempotency_keys) to src/adapters/d1/v2Idempotency.ts (v2_idempotency) -- see that module's
// header comment. This file used to exercise the legacy module exclusively, which after that
// repoint covered a path nothing in the live app calls anymore; it now exercises the v2-native
// module instead, against v2_idempotency, which (unlike legacy idempotency_keys) FKs to
// v2_accounts -- every userId used below is seeded first.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { claimIdempotencyKey, completeIdempotencyClaim, pruneIdempotencyKeys, runIdempotent } from "../../src/adapters/d1/v2Idempotency";

async function seedAccount(id: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

describe("v2Idempotency: claim/complete", () => {
  it("a fresh key claims successfully", async () => {
    await seedAccount(1);
    expect(await claimIdempotencyKey(env.DB, 1, "key-a")).toEqual({ claimed: true });
  });

  it("completing a claim, then reclaiming the same key, replays the recorded response verbatim", async () => {
    await seedAccount(2);
    await claimIdempotencyKey(env.DB, 2, "key-b");
    await completeIdempotencyClaim(env.DB, 2, "key-b", 200, { ok: true, xp: 15 });
    expect(await claimIdempotencyKey(env.DB, 2, "key-b")).toEqual({
      claimed: false,
      cached: { status: 200, response: { ok: true, xp: 15 } },
    });
  });

  it("the same key is scoped per user -- another user's identical key still claims fresh", async () => {
    await seedAccount(3);
    await seedAccount(4);
    await claimIdempotencyKey(env.DB, 3, "shared-key");
    await completeIdempotencyClaim(env.DB, 3, "shared-key", 200, { for: "user3" });
    expect(await claimIdempotencyKey(env.DB, 4, "shared-key")).toEqual({ claimed: true });
  });

  it("THE race this closes: two concurrent claims on the same key -- exactly one wins", async () => {
    await seedAccount(5);
    const [a, b] = await Promise.all([
      claimIdempotencyKey(env.DB, 5, "race-key"),
      claimIdempotencyKey(env.DB, 5, "race-key"),
    ]);
    const claimedCount = [a, b].filter((r) => r.claimed).length;
    expect(claimedCount).toBe(1);
    // The loser is told to retry shortly (the winner hasn't completed yet), not handed a fake
    // cached response.
    const loser = a.claimed ? b : a;
    expect(loser).toEqual({ claimed: false, cached: null });
  });

  it("an abandoned claim (crashed before completing) is taken over once stale, not wedged forever", async () => {
    await seedAccount(6);
    await env.DB
      .prepare("INSERT INTO v2_idempotency (accountId, key, response, status, state, createdAt) VALUES (6, 'stale-key', '{}', 0, 'processing', '2000-01-01T00:00:00.000Z')")
      .run();
    expect(await claimIdempotencyKey(env.DB, 6, "stale-key")).toEqual({ claimed: true });
  });

  it("a key older than the replay window is pruned and claims fresh again", async () => {
    await seedAccount(7);
    await env.DB
      .prepare("INSERT INTO v2_idempotency (accountId, key, response, status, state, createdAt) VALUES (7, 'old-key', '{}', 200, 'done', '2000-01-01T00:00:00.000Z')")
      .run();
    await pruneIdempotencyKeys(env.DB, "2020-01-01T00:00:00.000Z");
    const row = await env.DB.prepare("SELECT 1 FROM v2_idempotency WHERE accountId = 7 AND key = 'old-key'").first();
    expect(row).toBeNull();
  });
});

describe("v2Idempotency: runIdempotent", () => {
  it("no key -> runs every time, no dedup", async () => {
    await seedAccount(8);
    let calls = 0;
    const run = () => { calls++; return Promise.resolve({ status: 200, body: { calls } }); };
    await runIdempotent(env.DB, 8, null, run);
    await runIdempotent(env.DB, 8, null, run);
    expect(calls).toBe(2);
  });

  it("with a key -> runs once, the second call replays without re-running the handler", async () => {
    await seedAccount(9);
    let calls = 0;
    const run = () => { calls++; return Promise.resolve({ status: 200, body: { calls } }); };
    const first = await runIdempotent(env.DB, 9, "idem-1", run);
    const second = await runIdempotent(env.DB, 9, "idem-1", run);
    expect(calls).toBe(1);
    expect(first).toEqual({ status: 200, body: { calls: 1 } });
    expect(second).toEqual({ status: 200, body: { calls: 1 } });
  });

  it("a concurrent duplicate call is told to retry (409) instead of running the handler twice", async () => {
    await seedAccount(10);
    let calls = 0;
    const run = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50)); // hold the claim open long enough to overlap
      return { status: 200, body: { calls } };
    };
    const [a, b] = await Promise.all([
      runIdempotent(env.DB, 10, "idem-2", run),
      runIdempotent(env.DB, 10, "idem-2", run),
    ]);
    expect(calls).toBe(1);
    const results = [a, b];
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(results.some((r) => r.status === 409)).toBe(true);
  });
});
