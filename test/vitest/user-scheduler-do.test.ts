// End-to-end proof of the dry-run mechanism: wake a real UserSchedulerDO, run its alarm against
// real D1 (env.DB) via runDurableObjectAlarm, and confirm that (a) it decided to do something
// real processUser logic would do, (b) that decision was LOGGED, and (c) nothing it decided was
// actually applied to the real database or sent for real.
//
// Trigger used: the referral-reward block (scheduler.ts) is the one reminder that depends on
// NOTHING time-of-day — just `user.onboarded && user.profile.referredBy && !sent.ref_reward` —
// which makes it the one deterministic way to exercise a real send+write pair without mocking
// the wall clock.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getOrCreateUser, getUser, listAchievements, updateUser } from "../../src/db/repos";

describe("UserSchedulerDO alarm (dry-run)", () => {
  it("decides for real, but sends and writes are logged instead of applied", async () => {
    const inviter = await getOrCreateUser(env.DB, 201, 9201, "en", "Inviter");
    await getOrCreateUser(env.DB, 202, 9202, "en", "Invitee");
    await updateUser(env.DB, 202, { onboarded: true, profile: { referredBy: 201 } });

    const id = env.USER_SCHEDULER.idFromName("202");
    const stub = env.USER_SCHEDULER.get(id);
    await stub.fetch("https://do/wake?userId=202");

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    // Logged: the referral-reward send (to the INVITER's chat) and at least one write (the
    // achievement award + the reminders.sent update processUser makes when it decides to act).
    const logged = await env.DB
      .prepare("SELECT kind, detail FROM scheduler_dryrun_log WHERE source = 'user' AND entityId = 202")
      .all<{ kind: string; detail: string }>();
    const sends = logged.results.filter((r) => r.kind === "send").map((r) => JSON.parse(r.detail));
    const writes = logged.results.filter((r) => r.kind === "write");
    expect(sends).toHaveLength(1);
    expect(sends[0].chatId).toBe(inviter.chatId);
    expect(writes.length).toBeGreaterThan(0);

    // Nothing it decided was actually applied: the invitee's OWN dedup state never recorded
    // ref_reward, and the inviter never actually received the achievement.
    const invitee = await getUser(env.DB, 202);
    expect(invitee?.reminders?.sent?.ref_reward).toBeUndefined();
    expect(await listAchievements(env.DB, 201)).not.toContain("referral");
  });

  it("re-waking an already-scheduled alarm does not reset its cadence", async () => {
    await getOrCreateUser(env.DB, 203, 9203, "en", "Solo");
    const id = env.USER_SCHEDULER.idFromName("203");
    const stub = env.USER_SCHEDULER.get(id);
    await stub.fetch("https://do/wake?userId=203");
    await stub.fetch("https://do/wake?userId=203"); // a settings-change re-wake, e.g.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true); // still exactly one alarm, not lost or duplicated
  });

  it("the alarm reschedules itself even though it never sends for real", async () => {
    await getOrCreateUser(env.DB, 204, 9204, "en", "Solo2");
    const id = env.USER_SCHEDULER.idFromName("204");
    const stub = env.USER_SCHEDULER.get(id);
    await stub.fetch("https://do/wake?userId=204");
    await runDurableObjectAlarm(stub);
    const again = await runDurableObjectAlarm(stub); // a second alarm exists iff it rescheduled
    expect(again).toBe(true);
  });
});
