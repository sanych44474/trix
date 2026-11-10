// The cron no longer runs reminders, global jobs or squad recaps: the three scheduler Durable
// Objects own them (ADR-0015). If the cron ran them too, every reminder would be sent twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { runSchedule } from "../src/scheduler";
import { getSetting } from "../src/adapters/d1/v2Admin";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import type { Env } from "../src/types";

test("runSchedule: wakes the Durable Objects and leaves the user pass and the global jobs to them", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 101, "en", "Inviter");
  await getOrCreateUser(db, 2, 102, "en", "Invitee");
  // The referral reward is the one reminder with no time-of-day gate: a user pass would record it.
  await updateUser(db, 2, { onboarded: true, profile: { referredBy: 1 } });
  const woken: string[] = [];
  const namespace = (kind: string) => ({
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: async () => { woken.push(`${kind}:${name}`); return new Response("ok"); } }),
  });
  const env = {
    DB: db,
    TELEGRAM_BOT_TOKEN: "1:test",
    USER_SCHEDULER: namespace("user"),
    SQUAD_SCHEDULER: namespace("squad"),
    GLOBAL_SCHEDULER: namespace("global"),
  } as unknown as Env;

  await runSchedule(env);

  assert.ok(woken.includes("user:2"), "a never-woken user gets their Durable Object armed");
  assert.ok(woken.some((w) => w.startsWith("global:")), "the global Durable Object is kept armed");
  assert.equal((await getUser(db, 2))?.reminders?.sent?.ref_reward, undefined, "the cron ran the user pass");
  assert.equal(await getSetting(db, "boards_cache"), null, "the cron ran the global jobs");
});
