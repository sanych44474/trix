// AI-safety audit trail (roadmap item 7): who/what/why for a plan mutation outside the
// bi-weekly progression cycle (plan_adjustments, plans.ts) — AI-coach edits, manual add/swap,
// injury auto-swaps, trainer edits. Deliberately minimal: a write + a read, no UI surface yet.
import { nowIso, type DB } from "./shared";

export type PlanChangeSource = "ai_coach" | "manual" | "injury_swap" | "trainer";

export interface PlanChangeLogEntry {
  source: PlanChangeSource;
  summary: string;
  createdAt: Date;
}

export async function recordPlanChange(db: DB, userId: number, source: PlanChangeSource, summary: string): Promise<void> {
  await db
    .prepare("INSERT INTO plan_change_log (userId, source, summary, createdAt) VALUES (?, ?, ?, ?)")
    .bind(userId, source, summary, nowIso())
    .run();
}

export async function listPlanChanges(db: DB, userId: number, limit = 20): Promise<PlanChangeLogEntry[]> {
  const r = await db
    .prepare("SELECT source, summary, createdAt FROM plan_change_log WHERE userId = ? ORDER BY id DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ source: string; summary: string; createdAt: string }>();
  return (r.results ?? []).map((row) => ({
    source: row.source as PlanChangeSource,
    summary: row.summary,
    createdAt: new Date(row.createdAt),
  }));
}
