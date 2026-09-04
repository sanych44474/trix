// Training plans: active/draft CRUD, the pre-generated zero-AI plan bank, plan-status lookups,
// bi-weekly adaptive-progression adjustments, and split/mesocycle mutations. Split out of
// repos.ts (god-file split, same barrel seam); behavior unchanged. Several of these functions
// (setProgressionRate, updateActivePlanSplit, updatePlanMesocycle) were previously filed under
// unrelated banners elsewhere in repos.ts — moved here where they actually belong.
import type { PlanAdjustmentDoc, PlanBankEntry, PlanDoc, ProgressionRate } from "../../types";
import { nowIso, type DB } from "./shared";

interface PlanRow {
  userId: number;
  active: number;
  status: string | null;
  authoredBy: number | null;
  split: string;
  nutrition: string;
  supplements: string;
  methodology: string;
  generatedAt: string;
  meta: string | null;
}

// Plan-level extras with no dedicated columns, packed into the plans.meta JSON column.
interface PlanMeta {
  stepsTarget?: number;
  restDayNutrition?: PlanDoc["restDayNutrition"];
  movementAudit?: string;
  deloadInterval?: number;
  mesocycle?: PlanDoc["mesocycle"];
}

function planMetaJson(plan: PlanDoc): string | null {
  const meta: PlanMeta = {};
  if (typeof plan.stepsTarget === "number") meta.stepsTarget = plan.stepsTarget;
  if (plan.restDayNutrition) meta.restDayNutrition = plan.restDayNutrition;
  if (plan.movementAudit) meta.movementAudit = plan.movementAudit;
  if (typeof plan.deloadInterval === "number") meta.deloadInterval = plan.deloadInterval;
  if (plan.mesocycle) meta.mesocycle = plan.mesocycle;
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

function toPlan(r: PlanRow): PlanDoc {
  const meta: PlanMeta = r.meta ? JSON.parse(r.meta) : {};
  return {
    userId: r.userId,
    active: !!r.active,
    status: (r.status as "draft" | "active") ?? "active",
    authoredBy: r.authoredBy ?? undefined,
    split: JSON.parse(r.split),
    nutrition: JSON.parse(r.nutrition),
    supplements: JSON.parse(r.supplements),
    methodology: r.methodology,
    generatedAt: new Date(r.generatedAt),
    ...(typeof meta.stepsTarget === "number" ? { stepsTarget: meta.stepsTarget } : {}),
    ...(meta.restDayNutrition ? { restDayNutrition: meta.restDayNutrition } : {}),
    ...(meta.movementAudit ? { movementAudit: meta.movementAudit } : {}),
    ...(typeof meta.deloadInterval === "number" ? { deloadInterval: meta.deloadInterval } : {}),
    ...(meta.mesocycle ? { mesocycle: meta.mesocycle } : {}),
  };
}

export async function getActivePlan(db: DB, userId: number): Promise<PlanDoc | null> {
  const r = await db
    .prepare("SELECT * FROM plans WHERE userId = ? AND active = 1 ORDER BY id DESC LIMIT 1")
    .bind(userId)
    .first<PlanRow>();
  return r ? toPlan(r) : null;
}

/** All users' active plans in ONE query — bulk prefetch for the hourly scheduler pass
 * (replaces a getActivePlan per user). Ordered ASC so on a (shouldn't-happen) duplicate
 * the newest row wins in a Map, matching getActivePlan's ORDER BY id DESC. */
export async function listActivePlans(db: DB): Promise<PlanDoc[]> {
  const r = await db.prepare("SELECT * FROM plans WHERE active = 1 ORDER BY id ASC").all<PlanRow>();
  return (r.results ?? []).map(toPlan);
}

export async function setActivePlan(db: DB, plan: PlanDoc): Promise<void> {
  await db.batch([
    db.prepare("UPDATE plans SET active = 0 WHERE userId = ? AND active = 1").bind(plan.userId),
    db
      .prepare(
        `INSERT INTO plans (userId, active, status, authoredBy, split, nutrition, supplements, methodology, generatedAt, meta)
         VALUES (?, 1, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        plan.userId,
        plan.authoredBy ?? null,
        JSON.stringify(plan.split),
        JSON.stringify(plan.nutrition),
        JSON.stringify(plan.supplements),
        plan.methodology,
        plan.generatedAt.toISOString(),
        planMetaJson(plan),
      ),
  ]);
}

// Save a trainer-authored DRAFT (not active) for a client; replaces any prior draft.
export async function saveDraftPlan(db: DB, plan: PlanDoc): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM plans WHERE userId = ? AND status = 'draft'").bind(plan.userId),
    db
      .prepare(
        `INSERT INTO plans (userId, active, status, authoredBy, split, nutrition, supplements, methodology, generatedAt, meta)
         VALUES (?, 0, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        plan.userId,
        plan.authoredBy ?? null,
        JSON.stringify(plan.split),
        JSON.stringify(plan.nutrition),
        JSON.stringify(plan.supplements),
        plan.methodology,
        plan.generatedAt.toISOString(),
        planMetaJson(plan),
      ),
  ]);
}

export async function getDraftPlan(db: DB, userId: number): Promise<PlanDoc | null> {
  const r = await db
    .prepare("SELECT * FROM plans WHERE userId = ? AND status = 'draft' ORDER BY id DESC LIMIT 1")
    .bind(userId)
    .first<PlanRow>();
  return r ? toPlan(r) : null;
}

// Persist edits to the client's draft split (trainer swap).
export async function updateDraftSplit(db: DB, userId: number, split: unknown): Promise<void> {
  await db
    .prepare("UPDATE plans SET split = ? WHERE userId = ? AND status = 'draft'")
    .bind(JSON.stringify(split), userId)
    .run();
}

// Promote the client's draft to the active plan.
export async function assignDraftPlan(db: DB, userId: number): Promise<boolean> {
  const draft = await getDraftPlan(db, userId);
  if (!draft) return false;
  await db.batch([
    db.prepare("UPDATE plans SET active = 0 WHERE userId = ? AND active = 1").bind(userId),
    db.prepare("UPDATE plans SET active = 1, status = 'active' WHERE userId = ? AND status = 'draft'").bind(userId),
  ]);
  return true;
}

// Discard a client's pending draft without touching the active plan.
export async function deleteDraftPlan(db: DB, userId: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM plans WHERE userId = ? AND status = 'draft'").bind(userId).run();
  return (r.meta?.changes ?? 0) > 0;
}

interface PlanBankRow {
  id: string;
  goal: string;
  level: string;
  days_bucket: string;
  sex: string;
  equipment: string;
  variant: number;
  plan: string;
}

/** All bank entries (small table, ~144 rows). Returns [] if the table isn't seeded yet so the
 * bot falls back to AI generation cleanly before the migration is applied. */
export async function listPlanBank(db: DB): Promise<PlanBankEntry[]> {
  try {
    const r = await db.prepare("SELECT * FROM plan_bank").all<PlanBankRow>();
    return (r.results ?? []).map((row) => ({
      id: row.id,
      goal: row.goal as PlanBankEntry["goal"],
      level: row.level as PlanBankEntry["level"],
      daysBucket: row.days_bucket as PlanBankEntry["daysBucket"],
      sex: row.sex as PlanBankEntry["sex"],
      equipment: row.equipment as PlanBankEntry["equipment"],
      variant: row.variant,
      plan: JSON.parse(row.plan),
    }));
  } catch {
    return []; // table missing (not seeded) → caller uses AI
  }
}

// Plan status per user (active plan and/or pending draft) — for the owner report's plan column.
export async function planStatusByUser(db: DB): Promise<Map<number, { active: boolean; draft: boolean }>> {
  const r = await db
    .prepare("SELECT userId, MAX(active) AS a, MAX(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS d FROM plans GROUP BY userId")
    .all<{ userId: number; a: number; d: number }>();
  const m = new Map<number, { active: boolean; draft: boolean }>();
  for (const row of r.results ?? []) m.set(row.userId, { active: !!row.a, draft: !!row.d });
  return m;
}

// ---------- plan adjustments (bi-weekly adaptive check-in) ----------

export async function recordAdjustment(db: DB, userId: number, week: number, changes: string): Promise<void> {
  await db
    .prepare("INSERT INTO plan_adjustments (userId, week, changes, ts) VALUES (?, ?, ?, ?)")
    .bind(userId, week, changes, nowIso())
    .run();
}

/** Number of weeks since `cutoff` (ISO) that had at least one applied progression — a proxy
 * for how consistently the trainee is advancing (drives the level-up offer). */
export async function countAdjustmentWeeksSince(db: DB, userId: number, cutoff: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(DISTINCT week) AS c FROM plan_adjustments WHERE userId = ? AND ts >= ?")
    .bind(userId, cutoff)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function recentAdjustments(db: DB, userId: number, limit = 10): Promise<PlanAdjustmentDoc[]> {
  const r = await db
    .prepare("SELECT userId, week, changes, ts FROM plan_adjustments WHERE userId = ? ORDER BY ts DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ userId: number; week: number; changes: string; ts: string }>();
  return (r.results ?? []).map((x) => ({ userId: x.userId, week: x.week, changes: x.changes, ts: new Date(x.ts) }));
}

export async function setProgressionRate(db: DB, userId: number, rate: ProgressionRate): Promise<void> {
  await db.prepare("UPDATE users SET progression_rate = ? WHERE id = ?").bind(rate, userId).run();
}

export async function updateActivePlanSplit(db: DB, userId: number, split: unknown): Promise<void> {
  await db
    .prepare("UPDATE plans SET split = ? WHERE userId = ? AND active = 1")
    .bind(JSON.stringify(split), userId)
    .run();
}

/** Set/clear the mesocycle in the active plan's meta JSON (null clears it). */
export async function updatePlanMesocycle(db: DB, userId: number, mesocycle: PlanDoc["mesocycle"] | null): Promise<void> {
  const row = await db.prepare("SELECT meta FROM plans WHERE userId = ? AND active = 1").bind(userId).first<{ meta: string | null }>();
  if (!row) return;
  const meta = (row.meta ? JSON.parse(row.meta) : {}) as PlanMeta;
  if (mesocycle) meta.mesocycle = mesocycle;
  else delete meta.mesocycle;
  await db
    .prepare("UPDATE plans SET meta = ? WHERE userId = ? AND active = 1")
    .bind(Object.keys(meta).length ? JSON.stringify(meta) : null, userId)
    .run();
}
