// SquadSchedulerDO's own infrastructure guarantees, against real D1 and a real DO alarm — the
// squad counterpart to user-scheduler-do.test.ts. The recap DECISION itself (does it post this
// week or not) depends on the real wall clock (the 09:00 UTC gate), so this only asserts what's true regardless of when the
// test happens to run.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getOrCreateUser } from "../../src/adapters/d1/v2Users";
import { joinSquad, upsertSquad } from "../../src/adapters/d1/v2Gamification";

const CHAT = -5001;

describe("SquadSchedulerDO alarm", () => {
  it("wakes, runs, and reschedules itself regardless of the hour", async () => {
    await getOrCreateUser(env.DB, 301, 9301, "en", "Ana");
    await upsertSquad(env.DB, CHAT, "Real D1 Squad", 301);
    await joinSquad(env.DB, CHAT, 301);

    const id = env.SQUAD_SCHEDULER.idFromName(String(CHAT));
    const stub = env.SQUAD_SCHEDULER.get(id);
    await stub.fetch(`https://do/wake?chatId=${CHAT}`);

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const again = await runDurableObjectAlarm(stub); // a second alarm exists iff it rescheduled
    expect(again).toBe(true);
  });

  it("re-waking an already-armed squad does not duplicate its alarm", async () => {
    await upsertSquad(env.DB, CHAT - 1, "Second", 301);
    const id = env.SQUAD_SCHEDULER.idFromName(String(CHAT - 1));
    const stub = env.SQUAD_SCHEDULER.get(id);
    await stub.fetch(`https://do/wake?chatId=${CHAT - 1}`);
    await stub.fetch(`https://do/wake?chatId=${CHAT - 1}`);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
  });
});
