// The legacy-write guard (src/adapters/d1/legacyFreeze.ts) that CUTOVER_LEGACY_FROZEN enables --
// a stray missed call site must fail loudly against a legacy table instead of silently writing
// to a schema the rest of the app has stopped reading. Exercised directly against the same
// in-memory D1 harness the v2-native domain tests use (test/harness.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { freezeLegacyWrites, LegacyWriteBlockedError, withLegacyFreeze } from "../src/adapters/d1/legacyFreeze";

test("freezeLegacyWrites: blocks INSERT/UPDATE/DELETE against a legacy table", () => {
  const db = newDb();
  const blocked: string[] = [];
  const frozen = freezeLegacyWrites(db as unknown as D1Database, (sql) => blocked.push(sql));

  // The guard throws synchronously from prepare() itself, before any .run()/.bind() call.
  assert.throws(
    () => frozen.prepare("INSERT INTO users (id, chatId, lang, onboarded, profile, session, createdAt, updatedAt) VALUES (1,1,'en',0,'{}','{}','x','x')"),
    LegacyWriteBlockedError,
  );
  assert.throws(() => frozen.prepare("UPDATE users SET lang = 'uk' WHERE id = 1"), LegacyWriteBlockedError);
  assert.throws(() => frozen.prepare("DELETE FROM users WHERE id = 1"), LegacyWriteBlockedError);
  assert.equal(blocked.length, 3);
});

test("freezeLegacyWrites: is case-insensitive and tolerates INSERT OR IGNORE/REPLACE", () => {
  const db = newDb();
  const frozen = freezeLegacyWrites(db as unknown as D1Database, () => {});
  assert.throws(() => frozen.prepare("insert into users (id) values (1)"), LegacyWriteBlockedError);
  assert.throws(() => frozen.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)"), LegacyWriteBlockedError);
  assert.throws(() => frozen.prepare("INSERT OR REPLACE INTO plans (id) VALUES (1)"), LegacyWriteBlockedError);
});

test("freezeLegacyWrites: never blocks reads (SELECT/PRAGMA) against a legacy table", async () => {
  const db = newDb();
  const frozen = freezeLegacyWrites(db as unknown as D1Database, () => {
    assert.fail("onBlocked must not fire for a SELECT");
  });
  const row = await frozen.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  assert.equal(row?.c, 0);
});

test("freezeLegacyWrites: never blocks writes against a v2_* table", async () => {
  const db = newDb();
  const frozen = freezeLegacyWrites(db as unknown as D1Database, () => {
    assert.fail("onBlocked must not fire for a v2_* table");
  });
  await frozen
    .prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (1,1,1,'solo','active','x','x')")
    .run();
  const row = await frozen.prepare("SELECT COUNT(*) AS c FROM v2_accounts").first<{ c: number }>();
  assert.equal(row?.c, 1);
});

test("withLegacyFreeze: returns env unchanged when the flag is off (default)", () => {
  const db = newDb() as unknown as D1Database;
  const env = { DB: db, CUTOVER_LEGACY_FROZEN: "0" };
  assert.equal(withLegacyFreeze(env, () => {}), env);
});

test("withLegacyFreeze: wraps DB when the flag is on, leaving everything else untouched", () => {
  const db = newDb() as unknown as D1Database;
  const env = { DB: db, CUTOVER_LEGACY_FROZEN: "1", OTHER: "kept" };
  const wrapped = withLegacyFreeze(env, () => {});
  assert.notEqual(wrapped.DB, db);
  assert.equal(wrapped.OTHER, "kept");
  assert.throws(() => wrapped.DB.prepare("INSERT INTO users (id) VALUES (1)"), LegacyWriteBlockedError);
});
