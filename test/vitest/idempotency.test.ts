// Idempotency-key replay, against real D1 (ON CONFLICT DO UPDATE semantics matter here).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getIdempotentResponse, pruneIdempotencyKeys, recordIdempotentResponse } from "../../src/db/repos/idempotency";

describe("idempotency keys", () => {
  it("a fresh key is a miss; a recorded key replays verbatim", async () => {
    expect(await getIdempotentResponse(env.DB, 1, "key-a")).toBeNull();
    await recordIdempotentResponse(env.DB, 1, "key-a", 200, { ok: true, xp: 15 });
    const cached = await getIdempotentResponse(env.DB, 1, "key-a");
    expect(cached).toEqual({ status: 200, response: { ok: true, xp: 15 } });
  });

  it("the same key is scoped per user -- another user's identical key is still a miss", async () => {
    await recordIdempotentResponse(env.DB, 2, "shared-key", 200, { for: "user2" });
    expect(await getIdempotentResponse(env.DB, 3, "shared-key")).toBeNull();
  });

  it("recording again under the same key overwrites the cached response", async () => {
    await recordIdempotentResponse(env.DB, 4, "key-b", 200, { v: 1 });
    await recordIdempotentResponse(env.DB, 4, "key-b", 500, { v: 2 });
    expect(await getIdempotentResponse(env.DB, 4, "key-b")).toEqual({ status: 500, response: { v: 2 } });
  });

  it("a key older than the replay window is pruned and reads back as a miss", async () => {
    await env.DB
      .prepare("INSERT INTO idempotency_keys (userId, key, response, status, createdAt) VALUES (5, 'old-key', '{}', 200, '2000-01-01T00:00:00.000Z')")
      .run();
    await pruneIdempotencyKeys(env.DB, "2020-01-01T00:00:00.000Z");
    const row = await env.DB.prepare("SELECT 1 FROM idempotency_keys WHERE userId = 5 AND key = 'old-key'").first();
    expect(row).toBeNull();
  });
});
