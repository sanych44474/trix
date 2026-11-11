// Water every N hours: each slot is its own reminder. The outbox key used to be the text, and the
// text has no hour in it ("0/2500 ml"), so 11:00 collided with 09:00: "duplicate", nothing sent,
// and the duplicate counted as delivered, using up that pass's one reminder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { notify } from "../src/notify/notify";
import { waterReminder } from "../src/schedulerJobs/nudges";
import { reminderKey, type UserPass } from "../src/schedulerJobs/userPass";
import type { Env, UserDoc } from "../src/types";

test("water reminders at 09:00 and 11:00 with the same text both reach the user", async () => {
  const db = newDb();
  await getOrCreateUser(db, 51, 51, "en", "Ann");
  const u0 = (await getUser(db, 51)) as UserDoc;
  await updateUser(db, 51, { profile: { ...u0.profile, waterEvery: 2 } });
  const user = (await getUser(db, 51)) as UserDoc;
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "t" } as unknown as Env;
  const delivered: string[] = [];
  const bot = { api: { sendMessage: async (_chat: number, text: string) => { delivered.push(text); return {} as never; } } };
  const sent: Record<string, string> = {};
  const date = "2026-11-04";
  const pass = (hour: number) => ({
    env, bot, user, db, lang: "en", date, hour, sent,
    remOff: () => false,
    appKb: () => undefined,
    // The scheduler's own send: the outbox, keyed by reminderKey.
    send: (text: string, extra?: unknown, key?: string) =>
      notify(env, bot as never, { userId: user._id, chatId: user.chatId }, { kind: "reminder", key: reminderKey(date, text, key), text, extra }),
    durable: (r: string) => r === "sent" || r === "retrying" || r === "duplicate",
    setSent: (k: string, v: string) => { sent[k] = v; },
  }) as unknown as UserPass;

  assert.equal(await waterReminder(pass(9)), true);
  assert.equal(await waterReminder(pass(11)), true);
  assert.equal(delivered.length, 2, "the 11:00 slot is a new reminder, not a duplicate of 09:00");
  assert.equal(delivered[0], delivered[1], "same text: nothing logged in between");
});
