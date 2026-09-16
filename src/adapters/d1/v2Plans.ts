// v2-native workout-plans repo (Domain 3 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of src/db/repos/plans.ts +
// src/db/repos/planChangeLog.ts: same exported names/signatures (so a call site switches by
// changing one import), same filters/ordering/edge cases — but reads/writes ONLY
// v2_plans/v2_plan_days/v2_plan_exercises/v2_plan_adjustments/v2_plan_changes/v2_plan_bank (see
// migrations/0078_v2_plans_complete.sql for the completeness pass that gave these tables the
// columns this module needs and fixed a live UNIQUE(accountId, version) collision bug — read
// that migration's header comment before touching version assignment below).
//
// Schema note: legacy `plans.split` is one JSON blob (day + nested exercises); v2 normalizes
// that into v2_plan_days/v2_plan_exercises child rows, with `catalogId`/`name`/`sets`/
// `startWeight`/`technique`/`metric`/`supersetGroup`/`weightMode` (exercise) and `weekday`/
// `muscleGroup`/`warmup` (day) promoted to real columns for querying (e.g. plan_lint's
// existingCatalogIds check), and a `meta` column holding the ORIGINAL day/exercise JSON object
// verbatim (exercises stripped from day meta) as a lossless escape hatch for every optional
// PlanDay/PlanExercise field that has no dedicated column (sessionType/durationMin/coolDown;
// isKeyLift/muscles/canonicalName/rpe/rir/rest/tempo/heartRateZone/movementPattern/role/
// warmupScheme) — same "hot column + full JSON blob" split as v2Users.ts's v2_profiles.profile.
//
// `version` is a real per-account plan-generation counter (assigned via a correlated
// `COALESCE(MAX(version) FOR accountId), 0) + 1` subquery inside the INSERT, same
// race-avoidance shape as v2Nutrition.ts's appendMeals position assignment — see 0078's header
// comment for why this is NOT the same thing as `schemaVersion` (PLAN_SCHEMA_VERSION), which has
// its own column.
//
// Multi-row writes (plan row + its days/exercises) are NOT one single atomic transaction: the
// plan row's own INSERT must commit first to get its assigned id before day/exercise rows (whose
// ids are derived from it, `planId * 10 + weekday`) can be built. This mirrors the same
// two-phase shape v2Projection.ts's projectWorkout already uses (insert session, read back its
// id, batch the children) — each phase is atomic on its own via db.batch(), but a crash between
// phases could in principle leave a plan row with no days yet. Accepted as consistent with that
// existing precedent rather than a new risk introduced here.
import type {
  ExerciseMetric,
  PlanAdjustmentDoc,
  PlanBankEntry,
  PlanDay,
  PlanDoc,
  PlanExercise,
  ProgressionRate,
  Weekday,
} from "../../types";
import { nowIso, safeJsonParse, type DB } from "../../db/repos/shared";
import { PLAN_SCHEMA_VERSION, parsePlanDoc, parsePlanSplit, PlanValidationError } from "../../domain/plan-schema";
import { hasCriticalIssues, lintPlan, type LintIssue } from "../../domain/plan-lint";
import { existingCatalogIds } from "./v2Catalog";
import { listActiveInjuries } from "./v2Tracking";

export type PlanChangeSource = "ai_coach" | "manual" | "injury_swap" | "trainer";

export interface PlanChangeLogEntry {
  source: PlanChangeSource;
  summary: string;
  createdAt: Date;
}

interface V2PlanRow {
  id: number;
  accountId: number;
  version: number;
  schemaVersion: number | null;
  status: string;
  source: string;
  active: number;
  authoredBy: number | null;
  nutrition: string | null;
  supplements: string | null;
  methodology: string | null;
  meta: string | null;
  mesocycle: string | null;
  createdAt: string;
  updatedAt: string;
}

interface V2PlanDayRow {
  id: number;
  planId: number;
  weekday: number;
  muscleGroup: string;
  warmup: string | null;
  meta: string | null;
}

interface V2PlanExerciseRow {
  id: number;
  dayId: number;
  position: number;
  catalogId: string | null;
  name: string;
  sets: string;
  startWeight: string;
  technique: string | null;
  metric: string | null;
  supersetGroup: string | null;
  weightMode: string | null;
  meta: string | null;
}

interface V2PlanBankRow {
  id: string;
  goal: string;
  level: string;
  daysBucket: string;
  sex: string;
  equipment: string;
  variant: number;
  plan: string;
}

// Plan-level extras with no dedicated columns, packed into v2_plans.meta — same fields/shape
// legacy plans.ts's planMetaJson packs into plans.meta (mesocycle excluded: it has its own
// v2_plans column, see migrations/0078).
interface PlanMetaExtras {
  stepsTarget?: number;
  restDayNutrition?: PlanDoc["restDayNutrition"];
  movementAudit?: string;
  deloadInterval?: number;
}

function planMetaJson(plan: PlanDoc): string | null {
  const meta: PlanMetaExtras = {};
  if (typeof plan.stepsTarget === "number") meta.stepsTarget = plan.stepsTarget;
  if (plan.restDayNutrition) meta.restDayNutrition = plan.restDayNutrition;
  if (plan.movementAudit) meta.movementAudit = plan.movementAudit;
  if (typeof plan.deloadInterval === "number") meta.deloadInterval = plan.deloadInterval;
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

function toExercise(r: V2PlanExerciseRow): PlanExercise {
  const extra = safeJsonParse<Partial<PlanExercise>>(r.meta, {});
  return {
    ...extra,
    name: r.name,
    sets: r.sets,
    startWeight: r.startWeight,
    technique: r.technique ?? "",
    metric: (r.metric as ExerciseMetric) || "reps",
    exerciseId: r.catalogId ?? undefined,
    supersetGroup: r.supersetGroup ?? undefined,
    weightMode: (r.weightMode as PlanExercise["weightMode"]) ?? undefined,
  };
}

function toDay(row: V2PlanDayRow, exercises: PlanExercise[]): PlanDay {
  const extra = safeJsonParse<Partial<PlanDay>>(row.meta, {});
  return {
    ...extra,
    weekday: row.weekday as Weekday,
    muscleGroup: row.muscleGroup,
    exercises,
    warmUp: row.warmup ? safeJsonParse<string[]>(row.warmup, []) : undefined,
  };
}

// Strict: throws PlanValidationError on malformed JSON or a schema mismatch — same reasoning as
// legacy plans.ts's toPlan (a corrupted plan must surface as an error, not render as if the user
// simply has no plan). Single-user reads let this propagate; listActivePlans catches it per-row.
async function toPlan(db: DB, r: V2PlanRow): Promise<PlanDoc> {
  const days = await db.prepare("SELECT * FROM v2_plan_days WHERE planId = ? ORDER BY weekday ASC").bind(r.id).all<V2PlanDayRow>();
  const split: PlanDay[] = [];
  for (const day of days.results ?? []) {
    const exercises = await db.prepare("SELECT * FROM v2_plan_exercises WHERE dayId = ? ORDER BY position ASC").bind(day.id).all<V2PlanExerciseRow>();
    split.push(toDay(day, (exercises.results ?? []).map(toExercise)));
  }
  let nutrition: unknown, supplements: unknown;
  try {
    nutrition = r.nutrition ? JSON.parse(r.nutrition) : {};
    supplements = r.supplements ? JSON.parse(r.supplements) : [];
  } catch (err) {
    throw new PlanValidationError(
      `Plan row for account ${r.accountId} has malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      [],
    );
  }
  const meta = safeJsonParse<PlanMetaExtras>(r.meta, {});
  const plan = parsePlanDoc({
    id: r.id,
    userId: r.accountId,
    active: !!r.active,
    status: (r.status as "draft" | "active") ?? "active",
    authoredBy: r.authoredBy ?? undefined,
    split,
    nutrition,
    supplements,
    methodology: r.methodology ?? "",
    generatedAt: new Date(r.createdAt),
    schemaVersion: r.schemaVersion ?? PLAN_SCHEMA_VERSION,
    ...(typeof meta.stepsTarget === "number" ? { stepsTarget: meta.stepsTarget } : {}),
    ...(meta.restDayNutrition ? { restDayNutrition: meta.restDayNutrition } : {}),
    ...(meta.movementAudit ? { movementAudit: meta.movementAudit } : {}),
    ...(typeof meta.deloadInterval === "number" ? { deloadInterval: meta.deloadInterval } : {}),
    ...(r.mesocycle ? { mesocycle: safeJsonParse<PlanDoc["mesocycle"]>(r.mesocycle, undefined) } : {}),
  });
  return { ...plan, id: r.id };
}

/** plan_lint just before a save — fetches only what the checks need (catalog ids referenced by
 * this plan, this user's active injury swaps) rather than the whole catalog. Throws on any
 * critical issue; warnings are returned so the caller can log them without blocking the save. */
async function lintBeforeSave(db: DB, plan: PlanDoc): Promise<LintIssue[]> {
  const referencedIds = plan.split.flatMap((d) => d.exercises.map((e) => e.exerciseId).filter((id): id is string => !!id));
  const [knownCatalogIds, activeInjurySwaps] = await Promise.all([
    existingCatalogIds(db, referencedIds),
    listActiveInjuries(db, plan.userId).then((injuries) => injuries.flatMap((i) => i.swaps)),
  ]);
  const issues = lintPlan(plan, { knownCatalogIds, activeInjurySwaps });
  if (hasCriticalIssues(issues)) {
    throw new PlanValidationError(
      `Plan for user ${plan.userId} failed plan_lint: ${issues.filter((i) => i.severity === "critical").map((i) => i.code).join(", ")}`,
      [],
    );
  }
  return issues;
}

export async function getActivePlan(db: DB, userId: number): Promise<PlanDoc | null> {
  const r = await db
    .prepare("SELECT * FROM v2_plans WHERE accountId = ? AND active = 1 ORDER BY id DESC LIMIT 1")
    .bind(userId)
    .first<V2PlanRow>();
  return r ? toPlan(db, r) : null;
}

/** All users' active plans — bulk prefetch for the hourly scheduler pass. A single corrupted
 * row must NOT throw (see listActivePlans in legacy plans.ts for the full reasoning: both cron
 * call sites `.catch(() => [])` around this, so one bad plan must not drop reminders for
 * everyone) — skipped and logged instead. */
export async function listActivePlans(db: DB): Promise<PlanDoc[]> {
  const r = await db.prepare("SELECT * FROM v2_plans WHERE active = 1 ORDER BY id ASC").all<V2PlanRow>();
  const plans: PlanDoc[] = [];
  for (const row of r.results ?? []) {
    try {
      plans.push(await toPlan(db, row));
    } catch (err) {
      console.error("listActivePlans: skipping corrupted plan row", row.accountId, err);
    }
  }
  return plans;
}

export async function countActivePlans(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_plans WHERE active = 1").first<{ c: number }>();
  return r?.c ?? 0;
}

// Inserts the day/exercise child rows for a freshly-created plan row. Ids are derived from
// planId (same `planId * 10 + weekday` / `dayId * 100 + position + 1` convention
// v2Projection.ts's projectPlan already uses) so both write paths land in the same id space.
// Chunked the same way v2Projection.ts's batchInChunks is (D1 batch has a per-call statement
// ceiling) — each chunk is atomic, the whole split is not, same trade-off projectPlan accepts.
async function writeSplit(db: DB, planId: number, split: PlanDay[]): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const day of split) {
    const dayId = planId * 10 + day.weekday;
    const { exercises, ...dayRest } = day;
    statements.push(
      db
        .prepare(`INSERT INTO v2_plan_days (id, planId, weekday, name, muscleGroup, warmup, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(dayId, planId, day.weekday, day.muscleGroup, day.muscleGroup, day.warmUp ? JSON.stringify(day.warmUp) : null, JSON.stringify(dayRest)),
    );
    exercises.forEach((exercise, position) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO v2_plan_exercises (id, dayId, position, catalogId, name, sets, startWeight, technique, metric, supersetGroup, weightMode, meta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            dayId * 100 + position + 1,
            dayId,
            position,
            exercise.exerciseId ?? null,
            exercise.name,
            exercise.sets,
            exercise.startWeight,
            exercise.technique,
            exercise.metric ?? "reps",
            exercise.supersetGroup ?? null,
            exercise.weightMode ?? null,
            JSON.stringify(exercise),
          ),
      );
    });
  }
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
}

async function deleteSplit(db: DB, planId: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM v2_plan_exercises WHERE dayId IN (SELECT id FROM v2_plan_days WHERE planId = ?)").bind(planId),
    db.prepare("DELETE FROM v2_plan_days WHERE planId = ?").bind(planId),
  ]);
}

const NEXT_VERSION_SUBQUERY = "(SELECT COALESCE(MAX(version), 0) + 1 FROM v2_plans WHERE accountId = ?)";

export async function setActivePlan(db: DB, plan: PlanDoc): Promise<void> {
  await lintBeforeSave(db, plan);
  const now = nowIso();
  const results = await db.batch([
    db.prepare("UPDATE v2_plans SET active = 0 WHERE accountId = ? AND active = 1").bind(plan.userId),
    db
      .prepare(
        `INSERT INTO v2_plans (accountId, version, schemaVersion, status, source, active, authoredBy, nutrition, supplements, methodology, meta, mesocycle, createdAt, updatedAt)
         VALUES (?, ${NEXT_VERSION_SUBQUERY}, ?, 'active', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        plan.userId,
        plan.userId,
        plan.schemaVersion ?? PLAN_SCHEMA_VERSION,
        plan.authoredBy ? "trainer" : "ai",
        plan.authoredBy ?? null,
        JSON.stringify(plan.nutrition),
        JSON.stringify(plan.supplements),
        plan.methodology,
        planMetaJson(plan),
        plan.mesocycle ? JSON.stringify(plan.mesocycle) : null,
        plan.generatedAt.toISOString(),
        now,
      ),
  ]);
  const planId = Number(results[1].meta?.last_row_id ?? 0);
  await writeSplit(db, planId, plan.split);
}

// Save a trainer-authored DRAFT (not active) for a client; replaces any prior draft — same
// delete-then-insert semantics as legacy saveDraftPlan.
export async function saveDraftPlan(db: DB, plan: PlanDoc): Promise<void> {
  await lintBeforeSave(db, plan);
  const now = nowIso();
  const existing = await db
    .prepare("SELECT id FROM v2_plans WHERE accountId = ? AND status = 'draft'")
    .bind(plan.userId)
    .first<{ id: number }>();
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(db.prepare("DELETE FROM v2_plan_exercises WHERE dayId IN (SELECT id FROM v2_plan_days WHERE planId = ?)").bind(existing.id));
    statements.push(db.prepare("DELETE FROM v2_plan_days WHERE planId = ?").bind(existing.id));
    statements.push(db.prepare("DELETE FROM v2_plans WHERE id = ?").bind(existing.id));
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO v2_plans (accountId, version, schemaVersion, status, source, active, authoredBy, nutrition, supplements, methodology, meta, mesocycle, createdAt, updatedAt)
         VALUES (?, ${NEXT_VERSION_SUBQUERY}, ?, 'draft', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        plan.userId,
        plan.userId,
        plan.schemaVersion ?? PLAN_SCHEMA_VERSION,
        plan.authoredBy ? "trainer" : "ai",
        plan.authoredBy ?? null,
        JSON.stringify(plan.nutrition),
        JSON.stringify(plan.supplements),
        plan.methodology,
        planMetaJson(plan),
        plan.mesocycle ? JSON.stringify(plan.mesocycle) : null,
        plan.generatedAt.toISOString(),
        now,
      ),
  );
  const results = await db.batch(statements);
  const planId = Number(results[results.length - 1].meta?.last_row_id ?? 0);
  await writeSplit(db, planId, plan.split);
}

export async function getDraftPlan(db: DB, userId: number): Promise<PlanDoc | null> {
  const r = await db
    .prepare("SELECT * FROM v2_plans WHERE accountId = ? AND status = 'draft' ORDER BY id DESC LIMIT 1")
    .bind(userId)
    .first<V2PlanRow>();
  return r ? toPlan(db, r) : null;
}

// Persist edits to the client's draft split (trainer swap). Validates shape before writing —
// same reasoning as legacy updateDraftSplit. No-op if there's no draft (matches legacy's plain
// UPDATE, which silently affects zero rows in that case).
export async function updateDraftSplit(db: DB, userId: number, split: unknown): Promise<void> {
  const validated = parsePlanSplit(split);
  const r = await db.prepare("SELECT id FROM v2_plans WHERE accountId = ? AND status = 'draft' ORDER BY id DESC LIMIT 1").bind(userId).first<{ id: number }>();
  if (!r) return;
  await deleteSplit(db, r.id);
  await writeSplit(db, r.id, validated);
}

// Promote the client's draft to the active plan — same id, not a new row (legacy semantics:
// assignDraftPlan flips flags on the existing draft row rather than regenerating one).
export async function assignDraftPlan(db: DB, userId: number): Promise<boolean> {
  const draft = await db.prepare("SELECT id FROM v2_plans WHERE accountId = ? AND status = 'draft'").bind(userId).first<{ id: number }>();
  if (!draft) return false;
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE v2_plans SET active = 0 WHERE accountId = ? AND active = 1").bind(userId),
    db.prepare("UPDATE v2_plans SET active = 1, status = 'active', updatedAt = ? WHERE accountId = ? AND status = 'draft'").bind(now, userId),
  ]);
  return true;
}

// Discard a client's pending draft without touching the active plan.
export async function deleteDraftPlan(db: DB, userId: number): Promise<boolean> {
  const r = await db.prepare("SELECT id FROM v2_plans WHERE accountId = ? AND status = 'draft'").bind(userId).first<{ id: number }>();
  if (!r) return false;
  await deleteSplit(db, r.id);
  await db.prepare("DELETE FROM v2_plans WHERE id = ?").bind(r.id).run();
  return true;
}

/** All bank entries (small table, ~144 rows). Returns [] if the table isn't seeded yet so the
 * bot falls back to AI generation cleanly — same as legacy listPlanBank. */
export async function listPlanBank(db: DB): Promise<PlanBankEntry[]> {
  try {
    const r = await db.prepare("SELECT * FROM v2_plan_bank").all<V2PlanBankRow>();
    return (r.results ?? []).map((row) => ({
      id: row.id,
      goal: row.goal as PlanBankEntry["goal"],
      level: row.level as PlanBankEntry["level"],
      daysBucket: row.daysBucket as PlanBankEntry["daysBucket"],
      sex: row.sex as PlanBankEntry["sex"],
      equipment: row.equipment as PlanBankEntry["equipment"],
      variant: row.variant,
      plan: JSON.parse(row.plan),
    }));
  } catch {
    return []; // table missing/unseeded → caller uses AI
  }
}

// Plan status per user (active plan and/or pending draft) — for the owner report's plan column.
export async function planStatusByUser(db: DB): Promise<Map<number, { active: boolean; draft: boolean }>> {
  const r = await db
    .prepare(
      "SELECT accountId AS userId, MAX(active) AS a, MAX(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS d FROM v2_plans GROUP BY accountId",
    )
    .all<{ userId: number; a: number; d: number }>();
  const m = new Map<number, { active: boolean; draft: boolean }>();
  for (const row of r.results ?? []) m.set(row.userId, { active: !!row.a, draft: !!row.d });
  return m;
}

// ---------- plan adjustments (bi-weekly adaptive check-in) ----------

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

// setProgressionRate touches the user's account row, not a plan row — same "filed under an
// unrelated banner" reasoning legacy plans.ts's header comment gives; mirrors that by writing
// v2_accounts.progressionRate directly rather than duplicating v2Users.ts's updateUser.
export async function setProgressionRate(db: DB, userId: number, rate: ProgressionRate): Promise<void> {
  await db.prepare("UPDATE v2_accounts SET progressionRate = ? WHERE id = ?").bind(rate, userId).run();
}

export async function updateActivePlanSplit(db: DB, userId: number, split: unknown): Promise<void> {
  const validated = parsePlanSplit(split);
  const r = await db.prepare("SELECT id FROM v2_plans WHERE accountId = ? AND active = 1 ORDER BY id DESC LIMIT 1").bind(userId).first<{ id: number }>();
  if (!r) return;
  await deleteSplit(db, r.id);
  await writeSplit(db, r.id, validated);
}

/** Set/clear the mesocycle on the active plan — its own v2_plans column (migrations/0078), so
 * unlike legacy (which json_set/json_remove's it inside the `meta` blob) this is a plain
 * single-column UPDATE; no read-modify-write window either way. */
export async function updatePlanMesocycle(db: DB, userId: number, mesocycle: PlanDoc["mesocycle"] | null): Promise<void> {
  await db
    .prepare("UPDATE v2_plans SET mesocycle = ?, updatedAt = ? WHERE accountId = ? AND active = 1")
    .bind(mesocycle ? JSON.stringify(mesocycle) : null, nowIso(), userId)
    .run();
}

// ---------- AI-safety audit trail (was src/db/repos/planChangeLog.ts) ----------

export async function recordPlanChange(db: DB, userId: number, source: PlanChangeSource, summary: string): Promise<void> {
  await db
    .prepare("INSERT INTO v2_plan_changes (accountId, actorId, source, summary, createdAt) VALUES (?, NULL, ?, ?, ?)")
    .bind(userId, source, summary, nowIso())
    .run();
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
