// The comeback interview's first question is inside the opener message, so a user may be put in
// `comeback` mode only once that message reached them. A permanently failed opener (a 400) left
// its outbox row in place; the next tick's enqueue came back "duplicate", which was read as
// delivered, and the user was parked in an interview whose question they never saw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { afterDelivery } from "../src/domain/notificationDelivery";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { runComebackOpeners } from "../src/schedulerJobs/comebackOpener";
import type { Env, UserDoc } from "../src/types";

test("afterDelivery: commit only on a delivered message, judge a duplicate by the first attempt", () => {
  assert.equal(afterDelivery("sent"), "commit");
  assert.equal(afterDelivery("retrying"), "wait");
  assert.equal(afterDelivery("duplicate", "sent"), "commit");
  assert.equal(afterDelivery("duplicate", "pending"), "wait");
  assert.equal(afterDelivery("duplicate", "failed"), "give_up");
  assert.equal(afterDelivery("duplicate", null), "give_up");
  assert.equal(afterDelivery("failed"), "give_up");
  assert.equal(afterDelivery("blocked"), "give_up");
  assert.equal(afterDelivery("muted"), "give_up");
});

async function vacationOver(db: ReturnType<typeof newDb>) {
  await getOrCreateUser(db, 61, 61, "en", "Ann");
  await updateUser(db, 61, { vacationUntil: new Date("2026-11-01T00:00:00Z") } as Partial<UserDoc>);
}

const env = (db: ReturnType<typeof newDb>) => ({ DB: db, TELEGRAM_BOT_TOKEN: "t" } as unknown as Env);
const now = new Date("2026-11-04T10:00:00Z");

test("comeback: an opener that failed for good never parks the user in the interview", async () => {
  const db = newDb();
  await vacationOver(db);
  const failing = { api: { sendMessage: async () => { throw new GrammyError("Bad Request: chat not found", { ok: false, error_code: 400, description: "chat not found" }, "sendMessage", {}); } } };
  await runComebackOpeners(env(db), failing as never, db, now);
  await runComebackOpeners(env(db), failing as never, db, new Date(now.getTime() + 3_600_000)); // the next tick
  const u = (await getUser(db, 61)) as UserDoc;
  assert.notEqual(u.session?.mode, "comeback", "they never saw the question");
});

test("comeback: a delivered opener starts the interview once", async () => {
  const db = newDb();
  await vacationOver(db);
  let sends = 0;
  const ok = { api: { sendMessage: async () => { sends++; return {} as never; } } };
  await runComebackOpeners(env(db), ok as never, db, now);
  await runComebackOpeners(env(db), ok as never, db, new Date(now.getTime() + 3_600_000));
  const u = (await getUser(db, 61)) as UserDoc;
  assert.equal(u.session?.mode, "comeback");
  assert.equal(sends, 1);
});
