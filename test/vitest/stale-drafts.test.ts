// Stale trainer-client drafts (src/staleDrafts.ts) against real D1: remind once after a day,
// activate after three, never touch a draft that sits next to an active plan.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sweepStaleDrafts } from "../../src/staleDrafts";

const H = 3_600_000;
async function seed(id: number, role: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'active', ?, ?)").bind(id, id, id, role, now, now),
    env.DB.prepare("INSERT INTO v2_profiles (accountId, lang, name, updatedAt) VALUES (?, 'uk', ?, ?)").bind(id, `u${id}`, now),
  ]);
}
async function link(client: number, trainer: number) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO v2_trainer_relationships (clientId, trainerId, status, createdAt, updatedAt) VALUES (?, ?, 'active', ?, ?)").bind(client, trainer, now, now).run();
}
async function plan(account: number, version: number, status: "draft" | "active", createdAt: string) {
  await env.DB.prepare("INSERT INTO v2_plans (accountId, version, status, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(account, version, status, status === "active" ? 1 : 0, createdAt, createdAt).run();
}
const statusOf = async (account: number) =>
  (await env.DB.prepare("SELECT status, active FROM v2_plans WHERE accountId = ? ORDER BY version DESC").bind(account).all<{ status: string; active: number }>()).results;

describe("sweepStaleDrafts", () => {
  it("reminds the trainer once after a day, activates after three days, skips drafts beside an active plan", async () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    await seed(9100, "trainer");
    for (const id of [9101, 9102, 9103, 9104]) await seed(id, "client");
    for (const id of [9101, 9102, 9103]) await link(id, 9100);
    await plan(9101, 1, "draft", new Date(now - 30 * H).toISOString()); // a day old → remind
    await plan(9102, 1, "draft", new Date(now - 80 * H).toISOString()); // 3+ days → activate
    await plan(9103, 1, "active", new Date(now - 200 * H).toISOString());
    await plan(9103, 2, "draft", new Date(now - 200 * H).toISOString()); // progression proposal → untouched
    await plan(9104, 1, "draft", new Date(now - 1 * H).toISOString()); // no trainer → activate now

    const sent: Array<[number, string]> = [];
    const send = async (chatId: number, text: string) => { sent.push([chatId, text]); };
    expect(await sweepStaleDrafts(env.DB, send, now)).toEqual({ reminded: 1, activated: 2 });
    expect(sent.filter(([c]) => c === 9100)).toHaveLength(2); // reminder for 9101 + auto-activation note for 9102
    expect(sent.some(([c]) => c === 9102) && sent.some(([c]) => c === 9104)).toBe(true);
    expect(await statusOf(9102)).toEqual([{ status: "active", active: 1 }]);
    expect(await statusOf(9104)).toEqual([{ status: "active", active: 1 }]);
    expect((await statusOf(9103))[0]).toEqual({ status: "draft", active: 0 });

    // Next hour: no repeat reminder; at three days the first draft activates too.
    expect(await sweepStaleDrafts(env.DB, send, now + H)).toEqual({ reminded: 0, activated: 0 });
    expect(await sweepStaleDrafts(env.DB, send, now + 45 * H)).toEqual({ reminded: 0, activated: 1 });
    expect(await statusOf(9101)).toEqual([{ status: "active", active: 1 }]);
  });
});
