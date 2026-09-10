// GlobalSchedulerDO's own guarantees, against real D1 and a real DO alarm — the singleton
// counterpart to the per-user and per-squad DOs. Uses the leaderboard-cache write as the
// deterministic assertion: unlike owner alerts (needs an error/outage threshold) or telemetry
// pruning (only runs once/week), it happens unconditionally every firing, so it's the one
// sub-job of runGlobalJobs that doesn't depend on seeded state or the wall clock.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getSetting } from "../../src/db/repos";

describe("GlobalSchedulerDO alarm (dry-run)", () => {
  it("decides for real (leaderboard cache) but never writes it for real", async () => {
    expect(await getSetting(env.DB, "boards_cache")).toBeNull();

    const id = env.GLOBAL_SCHEDULER.idFromName("global");
    const stub = env.GLOBAL_SCHEDULER.get(id);
    await stub.fetch("https://do/wake");
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    // The real settings row was never written -- only the shadow saw it.
    expect(await getSetting(env.DB, "boards_cache")).toBeNull();

    const logged = await env.DB
      .prepare("SELECT kind FROM scheduler_dryrun_log WHERE source = 'global'")
      .all<{ kind: string }>();
    expect(logged.results.some((r) => r.kind === "write")).toBe(true);
  });

  it("waking twice does not create a second alarm, and it reschedules itself", async () => {
    const id = env.GLOBAL_SCHEDULER.idFromName("global");
    const stub = env.GLOBAL_SCHEDULER.get(id);
    await stub.fetch("https://do/wake");
    await stub.fetch("https://do/wake"); // e.g. two health-check ticks before the first alarm fires
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runDurableObjectAlarm(stub)).toBe(true); // exists iff the first run rescheduled it
  });
});
