// The signup -> second workout funnel query against real D1 (EXISTS columns, LIMIT/OFFSET subquery).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { funnelAccounts } from "../../src/adapters/d1/funnel";
import { computeFunnel } from "../../src/domain/funnel";

describe("onboarding funnel", () => {
  it("reads every milestone and counts the steps", async () => {
    const t = "2026-10-01T09:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (951, 951, 951, 'solo', 'active', ?, ?), (952, 952, 952, 'solo', 'active', ?, ?)").bind(t, t, t, t),
      env.DB.prepare("INSERT INTO v2_analytics_events (accountId, event, date, count) VALUES (951, 'funnel_onboarding_started', '2026-10-01', 1), (952, 'funnel_onboarding_started', '2026-10-01', 1)"),
      env.DB.prepare("INSERT INTO v2_plans (accountId, version, status, createdAt, updatedAt) VALUES (951, 1, 'active', ?, ?)").bind(t, t),
      env.DB.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (951, '2026-10-02', 5, 1, ?, ?), (951, '2026-10-06', 2, 1, ?, ?)").bind(t, t, t, t),
    ]);
    const rows = (await funnelAccounts(env.DB)).filter((r) => r.signupDate === "2026-10-01");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.firstWorkout)).toMatchObject({ started: true, planned: true, firstWorkout: "2026-10-02", secondWorkout: "2026-10-06" });
    expect(computeFunnel(rows).counts).toEqual([2, 2, 1, 1, 1, 1]);
  });
});
