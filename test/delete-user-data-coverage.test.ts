// Guard test for the exact class of bug fixed in d4abb0c: deleteUserData() silently missed six
// tables added after it was first written (rest_timers, trainer_templates, shared_programs,
// trainer_prospects, food_corrections, client_note_history) because nothing forced a new
// user-identifying table to be triaged into it. This test fails the moment a new table with a
// userId/trainerId/clientId/ownerId column is added and not accounted for here, instead of
// letting it silently slip through /deleteme for however long until someone happens to notice.
//
// Static, not behavioral: it reads deleteUserData's own source and checks which tables it
// references, rather than inserting synthetic rows (schemas vary too much — NOT NULL columns,
// foreign-key-shaped fields — to seed generically). Actual delete behavior for these tables is
// covered by test/delete-user-data.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { newDb } from "./harness";

const OWNER_COLUMNS = ["userId", "trainerId", "clientId", "ownerId"];

// Tables intentionally NOT wiped by deleteUserData, with the reason a human confirmed.
const INTENTIONALLY_KEPT = new Set([
  "admin_audit", // the owner's own action trail, not the deleted user's data
]);

// Handled with different semantics than a plain DELETE — covered by their own assertions in
// test/delete-user-data.test.ts, not by a "does the source mention this table" grep.
const SPECIAL_HANDLED = new Set([
  "users",   // the row being deleted, not "cleaned"
  "plans",   // authoredBy is nulled (attribution only), not the whole row deleted
]);

test("deleteUserData: every user-identifying table is referenced, exempted, or specially handled", async () => {
  const db = newDb();
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();

  const owning: string[] = [];
  for (const { name } of tables.results ?? []) {
    if (name.startsWith("sqlite_") || name === "d1_migrations") continue;
    const cols = await db.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>();
    const colNames = (cols.results ?? []).map((c) => c.name);
    if (colNames.some((c) => OWNER_COLUMNS.includes(c))) owning.push(name);
  }
  assert.ok(owning.length > 5, "sanity check: expected to find several user-identifying tables in the real schema");

  const adminSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "db", "repos", "admin.ts"),
    "utf8",
  );
  const fnStart = adminSrc.indexOf("export async function deleteUserData");
  assert.ok(fnStart !== -1, "deleteUserData not found in admin.ts — did it move?");
  const nextFn = adminSrc.indexOf("\nexport ", fnStart + 1);
  const fnBody = adminSrc.slice(fnStart, nextFn === -1 ? undefined : nextFn);

  const unaccountedFor = owning.filter((t) => {
    if (INTENTIONALLY_KEPT.has(t) || SPECIAL_HANDLED.has(t)) return false;
    // Matches "FROM t", "UPDATE t", or "INTO t" inside a SQL string, word-bounded so e.g.
    // "plans" doesn't accidentally match "plan_adjustments".
    return !new RegExp(`\\b(FROM|UPDATE|INTO)\\s+${t}\\b`, "i").test(fnBody);
  });

  assert.deepEqual(
    unaccountedFor,
    [],
    `deleteUserData doesn't reference these user-identifying table(s): ${unaccountedFor.join(", ")}. ` +
      "Add a DELETE (or UPDATE, if the column is attribution-only) for each, or add it to " +
      "INTENTIONALLY_KEPT/SPECIAL_HANDLED above with a reason.",
  );
});
