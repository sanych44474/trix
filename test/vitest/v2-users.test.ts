// Domain 1 v2-native repo (src/adapters/d1/v2Users.ts) against REAL D1 (workerd) — the
// node:sqlite-backed node:test harness (test/v2-users.test.ts) can't promise db.batch()'s
// atomicity guarantees match real D1, and getOrCreateUser/updateUser both fan a single logical
// write out across multiple tables (v2_accounts/v2_profiles/v2_preferences/v2_onboarding/
// v2_trainer_relationships) in one batch — exactly the kind of D1-specific semantic this file
// exists to cover (same reasoning as test/vitest/idempotency.test.ts).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getOrCreateUser, getUser, updateUser } from "../../src/adapters/d1/v2Users";

describe("v2Users: getOrCreateUser — one batch across 4 tables", () => {
  it("lands rows in v2_accounts, v2_profiles, v2_preferences and v2_onboarding together", async () => {
    await getOrCreateUser(env.DB, 500, 500, "en", "Batch");
    const account = await env.DB.prepare("SELECT * FROM v2_accounts WHERE id = ?").bind(500).first();
    const profile = await env.DB.prepare("SELECT * FROM v2_profiles WHERE accountId = ?").bind(500).first();
    const prefs = await env.DB.prepare("SELECT * FROM v2_preferences WHERE accountId = ?").bind(500).first();
    const onboarding = await env.DB.prepare("SELECT * FROM v2_onboarding WHERE accountId = ?").bind(500).first();
    expect(account).not.toBeNull();
    expect(profile).not.toBeNull();
    expect(prefs).not.toBeNull();
    expect(onboarding).not.toBeNull();

    const u = await getUser(env.DB, 500);
    expect(u?.profile.name).toBe("Batch");
    expect(u?.onboarded).toBe(false);
  });
});

describe("v2Users: updateUser — multi-table patch lands atomically", () => {
  it("a patch touching account + profile + session + preferences + trainerId writes all five tables in one call", async () => {
    await getOrCreateUser(env.DB, 501, 501, "en");
    await getOrCreateUser(env.DB, 502, 502, "en"); // trainer

    await updateUser(env.DB, 501, {
      blocked: true,
      profile: { name: "Multi", referredBy: 9 },
      session: { mode: "coach", retryAfter: "2030-01-01T00:00:00.000Z" },
      competeOptIn: true,
      trainerId: 502,
    });

    const u = await getUser(env.DB, 501);
    expect(u?.blocked).toBe(true);
    expect(u?.profile.name).toBe("Multi");
    expect(u?.session).toEqual({ mode: "coach", retryAfter: "2030-01-01T00:00:00.000Z" });
    expect(u?.competeOptIn).toBe(true);
    expect(u?.trainerId).toBe(502);

    const edge = await env.DB
      .prepare("SELECT status FROM v2_trainer_relationships WHERE clientId = ? AND trainerId = ?")
      .bind(501, 502)
      .first<{ status: string }>();
    expect(edge?.status).toBe("active");
  });

  it("re-assigning trainerId deletes the old edge and inserts the new one in the same batch", async () => {
    await getOrCreateUser(env.DB, 510, 510, "en");
    await getOrCreateUser(env.DB, 511, 511, "en");
    await getOrCreateUser(env.DB, 512, 512, "en");

    await updateUser(env.DB, 510, { trainerId: 511 });
    await updateUser(env.DB, 510, { trainerId: 512 });

    const old = await env.DB
      .prepare("SELECT 1 FROM v2_trainer_relationships WHERE clientId = ? AND trainerId = ?")
      .bind(510, 511)
      .first();
    expect(old).toBeNull();

    const u = await getUser(env.DB, 510);
    expect(u?.trainerId).toBe(512);
  });
});
