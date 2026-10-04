// questClose.ts against real D1: a week's finished quests are recorded on Monday even when the
// Mini App was never opened, and only once.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { closeQuestWeek } from "../../src/questClose";
import { getUser } from "../../src/adapters/d1/v2Users";

describe("closeQuestWeek", () => {
  it("records the done quests of the finished week once", async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (9201, 9201, 9201, 'solo', 'active', ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO v2_profiles (accountId, lang, name, updatedAt) VALUES (9201, 'uk', 'Q', ?)").bind(now),
      ...["2026-09-22", "2026-09-24", "2026-09-30"].map((d, i) =>
        env.DB.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (9201, ?, ?, 1, ?, ?)").bind(d, [2, 4, 3][i], now, now)),
    ]);
    const user = (await getUser(env.DB, 9201))!;
    // Week of 2026-09-21: two workouts against a target of two (no plan, none the week before).
    expect(await closeQuestWeek(env.DB, user, "2026-09-21")).toContain("workouts");
    expect(await closeQuestWeek(env.DB, user, "2026-09-21")).toEqual([]);
    const rows = await env.DB.prepare("SELECT code FROM v2_quests WHERE accountId = 9201 AND weekStart = '2026-09-21'").all<{ code: string }>();
    expect(rows.results.map((r) => r.code)).toContain("workouts");
    // The 2026-09-30 workout belongs to the next week and must not count toward it.
    const next = await env.DB.prepare("SELECT COUNT(*) AS n FROM v2_quests WHERE accountId = 9201 AND weekStart = '2026-09-28'").first<{ n: number }>();
    expect(next?.n).toBe(0);
  });
});
