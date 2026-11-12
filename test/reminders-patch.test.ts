// `reminders` is one JSON column written by many flows. Each used to write the whole object from
// its own copy of the user, so two flows wiped each other's fields: the hourly pass holds a
// snapshot for the length of the pass, and when it flushed its `sent` map it erased a release
// note's `releaseSent` set in the meantime (the note was then sent again), and the reverse lost
// the day's reminder dedupe. patchReminders changes only the fields it is given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, patchReminders, updateUser } from "../src/adapters/d1/v2Users";
import type { UserDoc } from "../src/types";

test("patchReminders: two writers holding stale copies keep each other's fields", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await updateUser(db, 1, { reminders: { sent: { water: "2026-11-10" }, prCount: 2 } });
  // Both flows read the user before either writes.
  const passCopy = (await getUser(db, 1)) as UserDoc;
  const broadcastCopy = (await getUser(db, 1)) as UserDoc;
  assert.ok(passCopy && broadcastCopy);
  await patchReminders(db, 1, { releaseSent: "2026-11-10" });
  await patchReminders(db, 1, { sent: { workout: "2026-11-11" } });
  const after = (await getUser(db, 1)) as UserDoc;
  assert.equal(after.reminders?.releaseSent, "2026-11-10", "the release mark survives the pass's flush");
  assert.deepEqual(after.reminders?.sent, { water: "2026-11-10", workout: "2026-11-11" }, "sent keys merge, none are lost");
  assert.equal(after.reminders?.prCount, 2);
});

test("patchReminders: works on a user with no reminders yet, and null removes a field", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "en", "Bo");
  await patchReminders(db, 2, { lastLevel: 3 });
  assert.equal(((await getUser(db, 2)) as UserDoc).reminders?.lastLevel, 3);
  await patchReminders(db, 2, { lastLevel: null });
  assert.equal(((await getUser(db, 2)) as UserDoc).reminders?.lastLevel, undefined);
});

test("guard: no flow writes the whole reminders object through updateUser any more", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
  const offenders = walk("src").filter((f) => /updateUser\([^;]*\breminders\b\s*[:,}]/s.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")));
  assert.deepEqual(offenders, []);
});

test("vacation: turning it off ends the streak freeze today, not at the original end date", async () => {
  const { handleV2Api } = await import("../src/webapp/v2Api");
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Cy");
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never;
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const post = async (body: unknown, key: string) => {
    const req = new Request("https://example.test/api/v2/settings?debugUser=5", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
    return handleV2Api(req, new URL(req.url), env, ctx);
  };
  const on = await post({ action: "vacation", days: 90 }, "vacation-on-0001");
  assert.equal(on.status, 200, await on.clone().text());
  const frozen = ((await getUser(db, 5)) as UserDoc).reminders?.lastVacation;
  assert.ok(frozen && frozen.until > frozen.from);
  const off = await post({ action: "vacation", off: true }, "vacation-off-0001");
  assert.equal(off.status, 200);
  const after = ((await getUser(db, 5)) as UserDoc).reminders?.lastVacation;
  assert.equal(after?.until, after?.from, "the freeze window ends the day it was cancelled");
});
