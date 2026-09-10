// SquadSchedulerDO's cutover branch — own file for the same storage-isolation reason as
// user-scheduler-do-cutover.test.ts. The real recap decision depends on the wall clock
// (SQUAD_RECAP_HOUR_UTC, matching scheduler.ts on purpose), so this only asserts what holds
// regardless of the hour: the DO takes the real (non-shadow) code path once cut over, and
// produces no dry-run log entries either way.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getOrCreateUser, joinSquad, upsertSquad } from "../../src/db/repos";

const CHAT = -6001;

describe("SquadSchedulerDO alarm — cut over (real)", () => {
  it("with scheduler_cutover_squad=1, no dry-run log is produced — the real path ran instead", async () => {
    await getOrCreateUser(env.DB, 501, 9501, "en", "Ana");
    await upsertSquad(env.DB, CHAT, "Cutover Squad", 501);
    await joinSquad(env.DB, CHAT, 501);
    await env.DB
      .prepare("INSERT INTO settings (key, value) VALUES ('scheduler_cutover_squad', '1')")
      .run();

    const id = env.SQUAD_SCHEDULER.idFromName(String(CHAT));
    const stub = env.SQUAD_SCHEDULER.get(id);
    await stub.fetch(`https://do/wake?chatId=${CHAT}`);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const logged = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM scheduler_dryrun_log WHERE source = 'squad' AND entityId = ?")
      .bind(CHAT)
      .first<{ n: number }>();
    expect(logged?.n).toBe(0);
  });
});
