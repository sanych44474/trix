import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error -- plain .mjs script, no types
import { expectedSchema } from "../scripts/verify-schema.mjs";

test("expectedSchema: created minus dropped, added columns, renames", () => {
  const s = expectedSchema([
    "CREATE TABLE IF NOT EXISTS users (id INTEGER); CREATE TABLE v2_a (id INTEGER);",
    "ALTER TABLE v2_a ADD COLUMN status TEXT; -- ALTER TABLE v2_a ADD COLUMN ghost TEXT",
    "DROP TABLE IF EXISTS users; ALTER TABLE v2_a RENAME TO v2_b;",
  ]);
  assert.deepEqual(s, { tables: ["v2_b"], columns: { v2_b: ["status"] } });
});

test("expectedSchema over the real migrations: v2 tables, no dropped legacy ones, triage columns", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const s = expectedSchema(readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, dir), "utf8")));
  assert.ok(s.tables.includes("v2_feedback"));
  assert.ok(s.tables.includes("v2_inbox"));
  assert.ok(!s.tables.includes("users"));
  assert.deepEqual(s.columns.v2_feedback, ["category", "resolvedAt", "status"]);
});

test("expectedSchema matches a database built from the migrations (test harness)", async () => {
  const { newDb } = await import("./harness");
  const db = newDb();
  const dir = new URL("../migrations/", import.meta.url);
  const s = expectedSchema(readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, dir), "utf8")));
  const have = new Set(((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results ?? []).map((r) => r.name));
  const missing = (s.tables as string[]).filter((t) => !have.has(t));
  assert.deepEqual(missing, []);
  for (const [t, cols] of Object.entries(s.columns as Record<string, string[]>)) {
    const got = new Set(((await db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all<{ name: string }>()).results ?? []).map((r) => r.name));
    assert.deepEqual(cols.filter((c) => !got.has(c)), [], t);
  }
});
