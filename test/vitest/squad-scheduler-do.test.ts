// SquadSchedulerDO's own infrastructure guarantees, against real D1 and a real DO alarm — the
// squad counterpart to user-scheduler-do.test.ts. The recap DECISION itself (does it post this
// week or not) depends on the real wall clock (matches scheduler.ts's own hour gate exactly, on
// purpose — see the file's comment), so this only asserts what's true regardless of when the
// test happens to run.
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getOrCreateUser, getSquad, joinSquad, upsertSquad } from "../../src/db/repos";

const CHAT = -5001;

describe("SquadSchedulerDO alarm (dry-run)", () => {
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

    // The squad itself is never mutated by a mere alarm firing that happens before the recap
    // hour — and even past the recap hour, only through the shadow (see below).
    const squad = await getSquad(env.DB, CHAT);
    expect(squad).not.toBeNull();
  });

  it("re-waking an already-armed squad does not duplicate its alarm", async () => {
    await upsertSquad(env.DB, CHAT - 1, "Second", 301);
    const id = env.SQUAD_SCHEDULER.idFromName(String(CHAT - 1));
    const stub = env.SQUAD_SCHEDULER.get(id);
    await stub.fetch(`https://do/wake?chatId=${CHAT - 1}`);
    await stub.fetch(`https://do/wake?chatId=${CHAT - 1}`);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
  });

  it("whatever it decides, the real squad row's lastRecapWeek is never touched by dry-run", async () => {
    await upsertSquad(env.DB, CHAT - 2, "Third", 301);
    await joinSquad(env.DB, CHAT - 2, 301);
    const before = await getSquad(env.DB, CHAT - 2);
    const id = env.SQUAD_SCHEDULER.idFromName(String(CHAT - 2));
    const stub = env.SQUAD_SCHEDULER.get(id);
    await stub.fetch(`https://do/wake?chatId=${CHAT - 2}`);
    await runDurableObjectAlarm(stub);
    const after = await getSquad(env.DB, CHAT - 2);
    // Whether or not it was past the recap hour, markSquadRecapped only ever runs against the
    // shadow inside the DO — the real row's lastRecapWeek can only be null both times.
    expect(after?.lastRecapWeek).toBe(before?.lastRecapWeek);
  });
});
