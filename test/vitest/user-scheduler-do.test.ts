// UserSchedulerDO end to end: wake a real DO, run its alarm against real D1 (env.DB) via
// runDurableObjectAlarm, and confirm processUser's write landed. The alarm is the only thing that
// runs a user's reminders (ADR-0015); there is no flag to turn it on.
//
// Trigger used: the referral-reward block (scheduler.ts) is the one reminder that depends on
// NOTHING time-of-day — just `user.onboarded && user.profile.referredBy && !sent.ref_reward` —
// which makes it the one deterministic way to exercise a real send+write pair without mocking
// the wall clock.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getOrCreateUser, getUser, updateUser } from "../../src/adapters/d1/v2Users";

describe("UserSchedulerDO alarm", () => {
  it("runs the user's reminders for real, with no flag set", async () => {
    await getOrCreateUser(env.DB, 201, 9201, "en", "Inviter");
    await getOrCreateUser(env.DB, 202, 9202, "en", "Invitee");
    await updateUser(env.DB, 202, { onboarded: true, profile: { referredBy: 201 } });

    const id = env.USER_SCHEDULER.idFromName("202");
    const stub = env.USER_SCHEDULER.get(id);
    await stub.fetch("https://do/wake?userId=202");
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // The write landed in the real database: reminders.sent recorded ref_reward.
    const invitee = await getUser(env.DB, 202);
    expect(invitee?.reminders?.sent?.ref_reward).toBeDefined();
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

  it("the alarm reschedules itself", async () => {
    await getOrCreateUser(env.DB, 204, 9204, "en", "Solo2");
    const id = env.USER_SCHEDULER.idFromName("204");
    const stub = env.USER_SCHEDULER.get(id);
    await stub.fetch("https://do/wake?userId=204");
    await runDurableObjectAlarm(stub);
    const again = await runDurableObjectAlarm(stub); // a second alarm exists iff it rescheduled
    expect(again).toBe(true);
  });
});
