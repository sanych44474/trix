// The Mini App feed against real D1: events land where they happen, and reading clears unread.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { awardAchievement } from "../../src/adapters/d1/v2Gamification";
import { listInbox, markInboxRead } from "../../src/adapters/d1/v2Inbox";
import { insertMessage } from "../../src/adapters/d1/v2Trainer";
import { recordPlanChange } from "../../src/adapters/d1/v2Plans";

describe("inbox", () => {
  it("records badges, trainer messages and trainer plan edits; read clears the count", async () => {
    const now = new Date().toISOString();
    await env.DB.batch([9501, 9502].map((id) => env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)").bind(id, id, id, now, now)));
    await env.DB.prepare("INSERT INTO v2_profiles (accountId, lang, name, updatedAt) VALUES (9502, 'uk', 'Coach Ann', ?)").bind(now).run();

    expect(await awardAchievement(env.DB, 9501, "first_workout")).toBe(true);
    expect(await awardAchievement(env.DB, 9501, "first_workout")).toBe(false); // no second feed item
    await insertMessage(env.DB, 9502, 9501, "Great session today, keep the tempo slow");
    await recordPlanChange(env.DB, 9501, "trainer", "swap: Bench -> Floor press");
    await recordPlanChange(env.DB, 9501, "manual", "own edit"); // not announced to yourself

    const feed = await listInbox(env.DB, 9501);
    expect(feed.unread).toBe(3);
    expect(feed.items.map((i) => i.kind)).toEqual(["plan_changed", "message", "badge"]);
    expect(feed.items[1]!.params).toMatchObject({ fromName: "Coach Ann", preview: "Great session today, keep the tempo slow" });
    expect(feed.items[2]!.params).toMatchObject({ code: "first_workout" });
    expect(typeof feed.items[2]!.params.uk).toBe("string");

    await markInboxRead(env.DB, 9501);
    expect((await listInbox(env.DB, 9501)).unread).toBe(0);
  });
});
