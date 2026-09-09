// pruneOldLogs — the weekly 90-day telemetry sweep. Improvement #7 from the production-
// readiness list added messages/admin_audit/feedback/plan_source_logs/client_note_history to
// this sweep (they grew unbounded like the four original tables but were never pruned). Real
// in-memory D1 against the actual migrations, same pattern as trainer-notes.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { pruneOldLogs, getOrCreateUser } from "../src/db/repos";

const OLD = "2020-01-01T00:00:00.000Z";
const RECENT = new Date().toISOString();
const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

async function count(db: Awaited<ReturnType<typeof newDb>>, table: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return r?.c ?? 0;
}

test("pruneOldLogs: drops rows older than the cutoff from every table in the sweep, keeps recent ones", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");

  await db.batch([
    db.prepare("INSERT INTO ai_call_logs (userId, provider, kind, latency_ms, was_fallback, ts) VALUES (1,'p','k',1,0,?)").bind(OLD),
    db.prepare("INSERT INTO ai_call_logs (userId, provider, kind, latency_ms, was_fallback, ts) VALUES (1,'p','k',1,0,?)").bind(RECENT),
    db.prepare("INSERT INTO messages (fromId, toId, text, createdAt) VALUES (1,2,'old',?)").bind(OLD),
    db.prepare("INSERT INTO messages (fromId, toId, text, createdAt) VALUES (1,2,'new',?)").bind(RECENT),
    db.prepare("INSERT INTO admin_audit (ts, actorId, action) VALUES (?, 1, 'act')").bind(OLD),
    db.prepare("INSERT INTO admin_audit (ts, actorId, action) VALUES (?, 1, 'act')").bind(RECENT),
    db.prepare("INSERT INTO feedback (userId, text, date, createdAt) VALUES (1, 'old', '2020-01-01', ?)").bind(OLD),
    db.prepare("INSERT INTO feedback (userId, text, date, createdAt) VALUES (1, 'new', '2020-01-01', ?)").bind(RECENT),
    db.prepare("INSERT INTO plan_source_logs (userId, kind, source, ts) VALUES (1, 'workout', 'ai', ?)").bind(OLD),
    db.prepare("INSERT INTO plan_source_logs (userId, kind, source, ts) VALUES (1, 'workout', 'ai', ?)").bind(RECENT),
    db.prepare("INSERT INTO client_note_history (trainerId, clientId, field, value, savedAt) VALUES (1, 2, 'note', 'old', ?)").bind(OLD),
    db.prepare("INSERT INTO client_note_history (trainerId, clientId, field, value, savedAt) VALUES (1, 2, 'note', 'new', ?)").bind(RECENT),
  ]);

  await pruneOldLogs(db, cutoff, cutoff.slice(0, 10));

  for (const table of ["ai_call_logs", "messages", "admin_audit", "feedback", "plan_source_logs", "client_note_history"]) {
    assert.equal(await count(db, table), 1, `${table} should have exactly the recent row left`);
  }
});
