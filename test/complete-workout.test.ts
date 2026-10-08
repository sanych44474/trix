// completeWorkout: the one place a finished workout's side effects live, for the chat and the Mini
// App alike. Pins the replay safety the offline queue depends on (a second save of the same day
// must not tell the trainer again) and the level bookkeeping both surfaces now share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { completeWorkout } from "../src/bot/workoutSave";
import { advanceLevel } from "../src/features/gamification/level";
import type { Env, UserDoc, Weekday } from "../src/types";

type Db = ReturnType<typeof newDb>;
const ENTRIES = [{ name: "Bench Press", sets: [{ reps: 8, weight: 60 }] }];

async function pair(db: Db, trainerId: number, clientId: number): Promise<{ trainer: UserDoc; client: UserDoc }> {
  await getOrCreateUser(db, trainerId, trainerId, "en", "Coach");
  await updateUser(db, trainerId, { role: "trainer" });
  await getOrCreateUser(db, clientId, clientId, "en", "Maxim");
  await linkClient(db, clientId, trainerId);
  await updateUser(db, clientId, { role: "client", trainerId });
  return { trainer: (await getUser(db, trainerId)) as UserDoc, client: (await getUser(db, clientId)) as UserDoc };
}
function recorder() {
  const sent: Array<{ chatId: number; text: string }> = [];
  const api = { sendMessage: (async (chatId: number, text: string) => { sent.push({ chatId, text }); return {} as never; }) as never };
  return { sent, api };
}
const envFor = (db: Db) => ({ DB: db, TELEGRAM_BOT_TOKEN: "t" }) as unknown as Env;
const save = (db: Db, client: UserDoc, api: ReturnType<typeof recorder>["api"], date: string, isPastEdit = false) =>
  completeWorkout(envFor(db), client, ENTRIES, { date, weekday: 3 as Weekday, rawText: "bench 8x60", isPastEdit, api });

test("completeWorkout: the trainer hears about a client's workout once per day, however often it is saved", async () => {
  const db = newDb();
  const { trainer, client } = await pair(db, 900, 901);
  const { sent, api } = recorder();
  await save(db, client, api, "2026-10-07");
  assert.equal(sent.filter((m) => m.chatId === trainer.chatId).length, 1);
  assert.match(sent[0]!.text, /Maxim/);

  // An offline replay or an edit of the same day: the outbox key (date, client) is already taken.
  await save(db, client, api, "2026-10-07");
  await save(db, client, api, "2026-10-07");
  assert.equal(sent.filter((m) => m.chatId === trainer.chatId).length, 1, "not notified again");

  // The next day is a new workout and does notify.
  await save(db, client, api, "2026-10-08");
  assert.equal(sent.filter((m) => m.chatId === trainer.chatId).length, 2);
});

test("completeWorkout: correcting a past day does not tell the trainer the client 'just trained'", async () => {
  const db = newDb();
  const { trainer, client } = await pair(db, 902, 903);
  const { sent, api } = recorder();
  await save(db, client, api, "2026-09-30", true);
  assert.equal(sent.filter((m) => m.chatId === trainer.chatId).length, 0);
});

test("completeWorkout: a solo user has nobody to notify, and a failing send never fails the save", async () => {
  const db = newDb();
  await getOrCreateUser(db, 904, 904, "en", "Solo");
  const solo = (await getUser(db, 904)) as UserDoc;
  const { sent, api } = recorder();
  const done = await save(db, solo, api, "2026-10-07");
  assert.equal(sent.length, 0);
  assert.equal(done.totalWorkouts, 1);

  const { client } = await pair(db, 905, 906);
  const broken = { sendMessage: (async () => { throw new Error("telegram down"); }) as never };
  const ok = await save(db, client, broken, "2026-10-07");
  assert.equal(ok.totalWorkouts, 1, "the trainer message failed, the workout still saved");
});

test("completeWorkout: reports the level the workout earned", async () => {
  const db = newDb();
  await getOrCreateUser(db, 907, 907, "en", "Solo");
  const user = (await getUser(db, 907)) as UserDoc;
  const { api } = recorder();
  const done = await save(db, user, api, "2026-10-07");
  assert.ok(done.level >= 1);
  assert.equal(done.leveledUp, false, "the first sighting of a level is recorded silently");
  assert.equal(user.reminders?.lastLevel, done.level, "and persisted on the user");
});

test("advanceLevel: first sighting is silent; a higher level than last recorded is a level-up exactly once", async () => {
  const db = newDb();
  await getOrCreateUser(db, 908, 908, "en", "Solo");
  const user = (await getUser(db, 908)) as UserDoc;

  const first = await advanceLevel(db, user);
  assert.equal(first?.leveledUp, false);
  assert.equal(user.reminders?.lastLevel, first?.level);

  // Pretend the user was last congratulated at level 0: now level 1 is a genuine step up.
  user.reminders = { ...user.reminders, lastLevel: 0 };
  await updateUser(db, 908, { reminders: user.reminders });
  const up = await advanceLevel(db, user);
  assert.equal(up?.leveledUp, true);
  const again = await advanceLevel(db, user);
  assert.equal(again?.leveledUp, false, "celebrated once");
});
