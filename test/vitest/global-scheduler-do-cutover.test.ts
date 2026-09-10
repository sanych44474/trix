// GlobalSchedulerDO's cutover branch — own file for the same storage-isolation reason as the
// other *-cutover.test.ts files. Uses the same deterministic signal as the dry-run test (the
// leaderboard cache write), but this time expects it to land for real.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getSetting } from "../../src/db/repos";

describe("GlobalSchedulerDO alarm — cut over (real)", () => {
  it("with scheduler_cutover_global=1, the leaderboard cache is actually written", async () => {
    await env.DB
      .prepare("INSERT INTO settings (key, value) VALUES ('scheduler_cutover_global', '1')")
      .run();
    expect(await getSetting(env.DB, "boards_cache")).toBeNull();

    const id = env.GLOBAL_SCHEDULER.idFromName("global");
    const stub = env.GLOBAL_SCHEDULER.get(id);
    await stub.fetch("https://do/wake");
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await getSetting(env.DB, "boards_cache")).not.toBeNull();
    const logged = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM scheduler_dryrun_log WHERE source = 'global'")
      .first<{ n: number }>();
    expect(logged?.n).toBe(0);
  });
});
