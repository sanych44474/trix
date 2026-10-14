// Plan history: the bi-weekly adaptive check-in's adjustments and the AI-safety audit trail of
// plan changes (who changed what, from which source).
import { recordInbox } from "./v2Inbox";
import type { PlanAdjustmentDoc } from "../../types";
import { nowIso, type DB } from "./shared";

export type PlanChangeSource = "ai_coach" | "manual" | "injury_swap" | "trainer";

export interface PlanChangeLogEntry {
  source: PlanChangeSource;
  summary: string;
  createdAt: Date;
}

export async function recordAdjustment(db: DB, userId: number, week: number, changes: string): Promise<void> {
  await db
    .prepare("INSERT INTO v2_plan_adjustments (accountId, week, changes, createdAt) VALUES (?, ?, ?, ?)")
    .bind(userId, week, changes, nowIso())
    .run();
}

/** Number of weeks since `cutoff` (ISO) that had at least one applied progression — a proxy
 * for how consistently the trainee is advancing (drives the level-up offer). */
export async function countAdjustmentWeeksSince(db: DB, userId: number, cutoff: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(DISTINCT week) AS c FROM v2_plan_adjustments WHERE accountId = ? AND createdAt >= ?")
    .bind(userId, cutoff)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function recentAdjustments(db: DB, userId: number, limit = 10): Promise<PlanAdjustmentDoc[]> {
  const r = await db
    .prepare("SELECT accountId AS userId, week, changes, createdAt AS ts FROM v2_plan_adjustments WHERE accountId = ? ORDER BY createdAt DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ userId: number; week: number; changes: string; ts: string }>();
  return (r.results ?? []).map((x) => ({ userId: x.userId, week: x.week, changes: x.changes, ts: new Date(x.ts) }));
}

export async function recordPlanChange(db: DB, userId: number, source: PlanChangeSource, summary: string): Promise<void> {
  await db
    .prepare("INSERT INTO v2_plan_changes (accountId, actorId, source, summary, createdAt) VALUES (?, NULL, ?, ?, ?)")
    .bind(userId, source, summary, nowIso())
    .run();
  // The client sees their trainer's edits in the Mini App feed (their own edits they made themselves).
  if (source === "trainer") await recordInbox(db, userId, "plan_changed", { summary: summary.slice(0, 120) });
}

export async function listPlanChanges(db: DB, userId: number, limit = 20): Promise<PlanChangeLogEntry[]> {
  const r = await db
    .prepare("SELECT source, summary, createdAt FROM v2_plan_changes WHERE accountId = ? ORDER BY id DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ source: string; summary: string; createdAt: string }>();
  return (r.results ?? []).map((row) => ({
    source: row.source as PlanChangeSource,
    summary: row.summary,
    createdAt: new Date(row.createdAt),
  }));
}
