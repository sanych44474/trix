// The cutover ("real") branch of UserSchedulerDO's alarm, kept in its OWN file deliberately:
// storage isolation in this pool is per FILE, not per test (see isolation-and-concurrency in the
// Workers Vitest docs) -- the scheduler_cutover_user=1 setting this test writes would otherwise
// leak into every other test sharing a file and silently flip them from dry-run to real too.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getOrCreateUser, getUser, updateUser } from "../../src/db/repos";

describe("UserSchedulerDO alarm — cut over (real)", () => {
  it("with scheduler_cutover_user=1, the write actually lands — no shadow, no dry-run log", async () => {
    const inviter = await getOrCreateUser(env.DB, 401, 9401, "en", "Inviter");
    await getOrCreateUser(env.DB, 402, 9402, "en", "Invitee");
    await updateUser(env.DB, 402, { onboarded: true, profile: { referredBy: 401 } });
    await env.DB
      .prepare("INSERT INTO settings (key, value) VALUES ('scheduler_cutover_user', '1')")
      .run();

    const id = env.USER_SCHEDULER.idFromName("402");
    const stub = env.USER_SCHEDULER.get(id);
    await stub.fetch("https://do/wake?userId=402");
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // The real write landed this time -- reminders.sent actually recorded ref_reward.
    const invitee = await getUser(env.DB, 402);
    expect(invitee?.reminders?.sent?.ref_reward).toBeDefined();
    // Cut-over sends are not shadow-logged (that log is for comparing dry-run against the cron
    // path; a real send has no need of it -- it already happened for real).
    const logged = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM scheduler_dryrun_log WHERE source = 'user' AND entityId = 402")
      .first<{ n: number }>();
    expect(logged?.n).toBe(0);
    void inviter;
  });
});
