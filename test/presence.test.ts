// Presence: "was this person here?" has one definition now (domain/presence.ts + v2Presence), written by
// the bot AND by the Mini App's auth. These tests pin the two defects it replaces: the Mini App never
// moved lastSeenAt, and "active" was read off updatedAt, which a cron sweep bumps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { PRESENCE_WRITE_GAP_MS, SESSION_IDLE_MS, presenceStep } from "../src/domain/presence";
import { recordPresence } from "../src/adapters/d1/v2Presence";
import { countSessionAccountsBetween } from "../src/adapters/d1/v2Analytics";
import { countActiveSince, getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { miniAppUser } from "../src/webapp/auth";
import type { Env, UserDoc } from "../src/types";

const T0 = Date.parse("2026-10-16T10:00:00Z");
const MIN = 60_000;

test("presenceStep: first sight writes and opens a session; a repeat inside a minute does neither", () => {
  assert.deepEqual(presenceStep(undefined, T0), { write: true, newSession: true });
  assert.deepEqual(presenceStep(new Date(T0), T0 + 30_000), { write: false, newSession: false });
});

test("presenceStep: writes once a minute inside a session; a gap over 30 minutes opens a new one", () => {
  assert.deepEqual(presenceStep(new Date(T0), T0 + PRESENCE_WRITE_GAP_MS), { write: true, newSession: false });
  assert.deepEqual(presenceStep(new Date(T0), T0 + SESSION_IDLE_MS), { write: true, newSession: false }, "exactly 30 min is still the same session");
  assert.deepEqual(presenceStep(new Date(T0), T0 + SESSION_IDLE_MS + 1), { write: true, newSession: true });
});

test("recordPresence: writes lastSeenAt and one session mark, throttles repeats, marks again after idle", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "A");
  const user = (await getUser(db, 1)) as UserDoc;

  assert.equal(await recordPresence(db, user, "miniapp", T0), true);
  assert.equal(user.lastSeenAt?.getTime(), T0, "the in-memory user is updated so a second call in the same request is free");
  assert.equal(await recordPresence(db, user, "miniapp", T0 + 10_000), false, "throttled");
  assert.equal(await recordPresence(db, user, "miniapp", T0 + 2 * MIN), true, "a minute later it writes again");

  const day = "2026-10-16";
  const count = async () => (await db.prepare("SELECT SUM(count) AS n FROM v2_analytics_events WHERE accountId = 1 AND event = 'session' AND date = ?").bind(day).first<{ n: number }>())!.n;
  assert.equal(await count(), 1, "still one session after the second write");

  await recordPresence(db, user, "bot", T0 + 2 * MIN + SESSION_IDLE_MS + MIN);
  assert.equal(await count(), 2, "an idle gap opens a second session the same day");
  assert.equal(await countSessionAccountsBetween(db, day, "2026-10-17"), 1, "but it is still one distinct account that day");
  const stored = await db.prepare("SELECT lastSeenAt FROM v2_accounts WHERE id = 1").first<{ lastSeenAt: string }>();
  assert.equal(stored!.lastSeenAt, new Date(T0 + 2 * MIN + SESSION_IDLE_MS + MIN).toISOString());
});

test("recordPresence: a failing write never throws", async () => {
  const user = { _id: 1, lastSeenAt: undefined as Date | undefined };
  const broken = { prepare: () => { throw new Error("db down"); }, batch: async () => { throw new Error("db down"); } } as never;
  assert.equal(await recordPresence(broken, user, "miniapp", T0), false);
});

const envFor = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" }) as unknown as Env;
const authed = (env: Env, id: number) => {
  const url = new URL(`https://x/api/v2/dashboard?debugUser=${id}`);
  return miniAppUser(new Request(url), url, env);
};

test("Mini App auth: an authenticated request counts as being here; a background write does not", async () => {
  const db = newDb();
  await getOrCreateUser(db, 7, 7, "en", "AppOnly");
  await getOrCreateUser(db, 8, 8, "en", "Sleeping");
  const since = new Date(Date.now() - 3_600_000).toISOString();

  // A reminder / quest close / cron sweep writes to the row. It must not make anyone active.
  await updateUser(db, 8, { onboarded: true });
  assert.equal(await countActiveSince(db, since), 0);

  const user = await authed(envFor(db), 7);
  assert.ok(user, "the debug user resolves");
  assert.equal(await countActiveSince(db, since), 1, "only the person who opened the app");

  const row = await db.prepare("SELECT lastSeenAt FROM v2_accounts WHERE id = 7").first<{ lastSeenAt: string | null }>();
  assert.ok(row!.lastSeenAt, "lastSeenAt moved for a Mini App-only account");
  const before = row!.lastSeenAt;
  await authed(envFor(db), 7);
  const after = await db.prepare("SELECT lastSeenAt FROM v2_accounts WHERE id = 7").first<{ lastSeenAt: string }>();
  assert.equal(after!.lastSeenAt, before, "a second request inside the minute does not rewrite it");
});

test("Mini App auth: a blocked account is not recorded as present", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9, 9, "en", "Blocked");
  await updateUser(db, 9, { blocked: true });
  assert.equal(await authed(envFor(db), 9), null);
  const row = await db.prepare("SELECT lastSeenAt FROM v2_accounts WHERE id = 9").first<{ lastSeenAt: string | null }>();
  assert.equal(row!.lastSeenAt, null);
});
