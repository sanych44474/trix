// Domain 6 v2-native repo (src/adapters/d1/v2Tracking.ts) against REAL D1 (workerd) — the
// node:sqlite-backed node:test harness (test/v2-tracking.test.ts) can't promise D1-specific
// behaviors actually match: `RETURNING id` on INSERT (createInjury), `json_patch()` merge-patch
// semantics on a real SQLite build (upsertBodyLog), and `ON CONFLICT ... DO UPDATE` racing two
// concurrent writers for the same (accountId, date) row (addWater) — same reasoning as
// test/vitest/v2-users.test.ts.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getOrCreateUser } from "../../src/adapters/d1/v2Users";
import {
  addWater,
  bodyLogsByUser,
  createInjury,
  getInjury,
  getWater,
  upsertBodyLog,
} from "../../src/adapters/d1/v2Tracking";

describe("v2Tracking: createInjury — RETURNING id on real D1", () => {
  it("returns the actual autoincremented id, and getInjury reads the same row back", async () => {
    await getOrCreateUser(env.DB, 600, 600, "en");
    const id = await createInjury(env.DB, { userId: 600, area: "knee", severity: "mild", checkAfter: "2026-02-01", swaps: [] });
    expect(id).toBeGreaterThan(0);
    const inj = await getInjury(env.DB, id);
    expect(inj?.userId).toBe(600);
    expect(inj?.area).toBe("knee");
    expect(inj?.status).toBe("active");
  });
});

describe("v2Tracking: upsertBodyLog — json_patch merge-patch on real D1", () => {
  it("a second upsert with a partial measurements patch merges instead of clobbering, and an update with no measurements at all is untouched", async () => {
    await getOrCreateUser(env.DB, 601, 601, "en");
    await upsertBodyLog(env.DB, 601, "2026-03-01", { weight: 82, measurements: { waist: 88, chest: 102 } });
    await upsertBodyLog(env.DB, 601, "2026-03-01", { measurements: { waist: 85 } });
    let logs = await bodyLogsByUser(env.DB, 601);
    expect(logs).toHaveLength(1);
    expect(logs[0].weight).toBe(82); // COALESCE kept it
    expect(logs[0].measurements).toEqual({ waist: 85, chest: 102 }); // merged, not replaced

    await upsertBodyLog(env.DB, 601, "2026-03-01", { weight: 83 });
    logs = await bodyLogsByUser(env.DB, 601);
    expect(logs[0].weight).toBe(83);
    expect(logs[0].measurements).toEqual({ waist: 85, chest: 102 }); // still untouched
  });
});

describe("v2Tracking: addWater — ON CONFLICT DO UPDATE increments atomically under concurrent writers", () => {
  it("N concurrent addWater calls for the same (account, date) all land — no lost update", async () => {
    await getOrCreateUser(env.DB, 602, 602, "en");
    const calls = Array.from({ length: 10 }, () => addWater(env.DB, 602, "2026-04-01", 100));
    await Promise.all(calls);
    const total = await getWater(env.DB, 602, "2026-04-01");
    expect(total).toBe(1000); // all 10 x 100ml increments landed, none lost to a race
  });
});
