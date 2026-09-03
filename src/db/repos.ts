import type {
  AiKind,
  AiProvider,
  AiUsageDoc,
  BankPlan,
  BodyLogDoc,
  BodyMeasurements,
  CatalogExercise,
  ClientCardDoc,
  ClientQuestionDoc,
  ClientRequestDoc,
  DailyCheckinDoc,
  ExerciseMetric,
  ExerciseTranslation,
  ExerciseVideo,
  InjuryDoc,
  Lang,
  MealPlanDoc,
  NutritionLogDoc,
  NutritionTargets,
  MealEntry,
  PlanAdjustmentDoc,
  PlanBankEntry,
  PlanDoc,
  ProgressionRate,
  Role,
  SessionDoc,
  StepLogDoc,
  StrengthRecordDoc,
  TrainerDoc,
  TrainerProfileInput,
  TrainerReviewDoc,
  UserDoc,
  UserProfile,
  Weekday,
  WorkoutLogDoc,
} from "../types";

type DB = D1Database;
const nowIso = () => new Date().toISOString();

/** Build a partial-UPDATE SET clause from a patch and a column spec. Only keys present
 * (!== undefined) in `patch` are emitted; `[col, ser?]` maps a patch key to its SQL column
 * and an optional value serializer (e.g. bool→int, object→JSON). Returns SET fragments and
 * their bound values in matching order. */
function buildUpdate<T extends Record<string, unknown>>(
  patch: T,
  spec: { [K in keyof T]?: [col: string, ser?: (v: NonNullable<T[K]>) => unknown] },
): { sets: string[]; vals: unknown[] } {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key in spec) {
    const v = patch[key];
    if (v === undefined) continue;
    const entry = spec[key]!;
    sets.push(`${entry[0]} = ?`);
    vals.push(entry[1] ? entry[1](v as NonNullable<T[Extract<keyof T, string>]>) : v);
  }
  return { sets, vals };
}

// ---------- row mappers ----------

interface UserRow {
  id: number;
  chatId: number;
  username: string | null;
  lang: string;
  onboarded: number;
  role: string | null;
  trainerId: number | null;
  competeOptIn: number | null;
  alias: string | null;
  profile: string;
  nutrition: string | null;
  session: string;
  reminders: string | null;
  progression_rate: string | null;
  blocked: number | null;
  botBlocked: number | null;
  flagged: number | null;
  lastSeenAt: string | null;
  vacationUntil: string | null;
  comebackDone: string | null;
  inactiveAskedAt: string | null;
  inactiveReply: string | null;
  createdAt: string;
  updatedAt: string;
}

function toUser(r: UserRow): UserDoc {
  return {
    _id: r.id,
    chatId: r.chatId,
    username: r.username ?? undefined,
    lang: r.lang as Lang,
    onboarded: !!r.onboarded,
    role: (r.role as Role) ?? "solo",
    trainerId: r.trainerId ?? undefined,
    competeOptIn: !!r.competeOptIn,
    alias: r.alias ?? undefined,
    profile: JSON.parse(r.profile),
    nutrition: r.nutrition ? (JSON.parse(r.nutrition) as NutritionTargets) : undefined,
    session: JSON.parse(r.session),
    reminders: r.reminders ? JSON.parse(r.reminders) : undefined,
    progressionRate: (r.progression_rate as ProgressionRate) ?? "normal",
    blocked: !!r.blocked,
    botBlocked: !!r.botBlocked,
    flagged: !!r.flagged,
    lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt) : undefined,
    vacationUntil: r.vacationUntil ? new Date(r.vacationUntil) : undefined,
    comebackDone: r.comebackDone ? new Date(r.comebackDone) : undefined,
    inactiveAskedAt: r.inactiveAskedAt ? new Date(r.inactiveAskedAt) : undefined,
    inactiveReply: r.inactiveReply ?? undefined,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

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

interface WorkoutRow {
  userId: number;
  date: string;
  weekday: number | null;
  exercises: string;
  completed: number;
  notes: string | null;
  createdAt: string;
}

function toWorkout(r: WorkoutRow): WorkoutLogDoc {
  return {
    userId: r.userId,
    date: r.date,
    weekday: (r.weekday ?? 1) as Weekday,
    exercises: JSON.parse(r.exercises),
    completed: !!r.completed,
    notes: r.notes ?? undefined,
    createdAt: new Date(r.createdAt),
  };
}

interface StrengthRow {
  userId: number;
  exercise: string;
  bestWeight: number;
  bestReps: number;
  bestSeconds?: number;
  bestMeters?: number;
  metric?: string;
  history: string;
  updatedAt: string;
}

function toStrength(r: StrengthRow): StrengthRecordDoc {
  return {
    userId: r.userId,
    exercise: r.exercise,
    bestWeight: r.bestWeight,
    bestReps: r.bestReps,
    bestSeconds: r.bestSeconds ?? 0,
    bestMeters: r.bestMeters ?? 0,
    metric: (r.metric as StrengthRecordDoc["metric"]) ?? "reps",
    history: JSON.parse(r.history),
    updatedAt: new Date(r.updatedAt),
  };
}

interface BodyRow {
  userId: number;
  date: string;
  weight: number | null;
  measurements: string | null;
  createdAt: string;
}

function toBody(r: BodyRow): BodyLogDoc {
  return {
    userId: r.userId,
    date: r.date,
    weight: r.weight ?? undefined,
    measurements: r.measurements ? JSON.parse(r.measurements) : undefined,
    createdAt: new Date(r.createdAt),
  };
}

// ---------- users ----------

export async function getUser(db: DB, userId: number): Promise<UserDoc | null> {
  const r = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
  return r ? toUser(r) : null;
}

/** Batched user fetch — one `WHERE id IN (...)` instead of N `getUser` calls in a loop.
 * Returns a Map keyed by user id (missing ids simply absent). */
export async function getUsersByIds(db: DB, ids: number[]): Promise<Map<number, UserDoc>> {
  const out = new Map<number, UserDoc>();
  const uniq = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (!uniq.length) return out;
  const placeholders = uniq.map(() => "?").join(",");
  const r = await db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).bind(...uniq).all<UserRow>();
  for (const row of r.results ?? []) { const u = toUser(row); out.set(u._id, u); }
  return out;
}

export async function getOrCreateUser(
  db: DB,
  userId: number,
  chatId: number,
  lang: Lang,
  firstName?: string,
): Promise<UserDoc> {
  const now = nowIso();
  const profile = JSON.stringify(firstName ? { name: firstName } : {});
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, chatId, lang, onboarded, profile, nutrition, session, sessionMode, createdAt, updatedAt)
       VALUES (?, ?, ?, 0, ?, NULL, ?, 'idle', ?, ?)`,
    )
    .bind(userId, chatId, lang, profile, JSON.stringify({ mode: "idle" }), now, now)
    .run();
  return (await getUser(db, userId))!;
}

export async function updateUser(
  db: DB,
  userId: number,
  patch: Partial<Omit<UserDoc, "_id">>,
): Promise<void> {
  const { sets, vals } = buildUpdate(patch, {
    chatId: ["chatId"],
    username: ["username"],
    lang: ["lang"],
    onboarded: ["onboarded", (v) => (v ? 1 : 0)],
    role: ["role"],
    trainerId: ["trainerId"],
    competeOptIn: ["competeOptIn", (v) => (v ? 1 : 0)],
    alias: ["alias"],
    profile: ["profile", (v) => JSON.stringify(v)],
    nutrition: ["nutrition", (v) => JSON.stringify(v)],
    session: ["session", (v) => JSON.stringify(v)],
    reminders: ["reminders", (v) => JSON.stringify(v)],
    progressionRate: ["progression_rate"],
    blocked: ["blocked", (v) => (v ? 1 : 0)],
    botBlocked: ["botBlocked", (v) => (v ? 1 : 0)],
    lastSeenAt: ["lastSeenAt", (v) => (v as Date).toISOString()],
    vacationUntil: ["vacationUntil", (v) => (v as Date).toISOString()],
    comebackDone: ["comebackDone", (v) => (v as Date).toISOString()],
    inactiveAskedAt: ["inactiveAskedAt", (v) => (v as Date).toISOString()],
    inactiveReply: ["inactiveReply"],
  });
  // Dual-write session.mode/retryAfter into indexed columns so the every-minute scheduler
  // sweeps stay index-backed (the session JSON remains the source of truth — see 0037).
  if (patch.session !== undefined) {
    sets.push("sessionMode = ?", "sessionRetryAfter = ?");
    vals.push(patch.session.mode, patch.session.retryAfter ?? null);
  }
  sets.push("updatedAt = ?");
  vals.push(nowIso(), userId);
  await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function listOnboardedUsers(db: DB): Promise<UserDoc[]> {
  const r = await db.prepare("SELECT * FROM users WHERE onboarded = 1").all<UserRow>();
  return (r.results ?? []).map(toUser);
}

// The four every-minute recovery sweeps below filter on the indexed sessionMode /
// sessionRetryAfter columns (dual-written by updateUser, backfilled by 0037) instead of
// json_extract(session, ...) — the JSON path forced a full user-table scan per query.

export async function listRetryUsers(db: DB, now: string): Promise<UserDoc[]> {
  const r = await db
    .prepare("SELECT * FROM users WHERE sessionRetryAfter IS NOT NULL AND sessionRetryAfter <= ?")
    .bind(now)
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Cheap one-row gate for the every-minute onboarding-recovery sweeps: superset of the rows
 * listRetryUsers / listPlanPendingUsers / listOnboardingOwedReply could return. When 0, the
 * cron skips all three SELECTs (the common idle case), collapsing ~3 queries/tick into 1. */
export async function pendingRecoveryCount(db: DB): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM users
       WHERE onboarded = 0 AND (sessionRetryAfter IS NOT NULL OR sessionMode IN ('onboarding','plan_pending'))`,
    )
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Users whose interview finished but whose plan generation hasn't landed yet (died mid-call
 * or failed). The scheduler retries these so a finished interview always converges to a plan. */
export async function listPlanPendingUsers(db: DB, before: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `SELECT * FROM users WHERE onboarded = 0 AND sessionMode = 'plan_pending'
       AND updatedAt < ?`,
    )
    .bind(before)
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

/** All users still in the onboarding interview (for the owner status/failure report). */
export async function listOnboardingUsers(db: DB): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `SELECT * FROM users WHERE onboarded = 0 AND sessionMode = 'onboarding'
       ORDER BY updatedAt DESC`,
    )
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

// Everyone who hasn't finished onboarding and is still reachable — the manual "finish your
// interview" ping targets these (any session mode, not just 'onboarding').
export async function listIncompleteOnboarding(db: DB): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `SELECT * FROM users WHERE onboarded = 0
       AND (botBlocked IS NULL OR botBlocked = 0) AND (blocked IS NULL OR blocked = 0)
       ORDER BY updatedAt DESC`,
    )
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Onboarding users the bot OWES a reply but never sent one — the webhook isolate died
 * mid AI-call, so neither the answer nor a retryAfter was written. Candidates: still
 * onboarding, no pending retry, last activity older than `before` (so we don't race an
 * in-flight reply). Caller filters to those whose last transcript turn is from the user. */
export async function listOnboardingOwedReply(db: DB, before: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `SELECT * FROM users WHERE onboarded = 0
       AND sessionMode = 'onboarding'
       AND sessionRetryAfter IS NULL
       AND updatedAt < ?`,
    )
    .bind(before)
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Users stuck in onboarding with no pending retryAfter — awaiting a human reply.
 * lastNudge lives in the reminders column to avoid sending the same nudge twice per day. */
export async function listStuckOnboardingUsers(db: DB, today: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `SELECT * FROM users WHERE onboarded = 0
       AND sessionMode = 'onboarding'
       AND sessionRetryAfter IS NULL
       AND (json_extract(reminders,'$.lastNudge') IS NULL OR json_extract(reminders,'$.lastNudge') != ?)`,
    )
    .bind(today)
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Non-onboarded users grouped by their current session mode — the owner funnel view. */
export async function nonOnboardedByMode(db: DB): Promise<{ mode: string; n: number }[]> {
  const r = await db
    .prepare("SELECT COALESCE(sessionMode, '?') AS mode, COUNT(*) AS n FROM users WHERE onboarded = 0 GROUP BY sessionMode ORDER BY n DESC")
    .all<{ mode: string; n: number }>();
  return r.results ?? [];
}

export async function countUsers(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countOnboarded(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE onboarded = 1").first<{ c: number }>();
  return r?.c ?? 0;
}

/** Moderation counts for the owner report: owner-banned users and users who blocked the bot. */
export async function countModeration(db: DB): Promise<{ blocked: number; botBlocked: number }> {
  const r = await db
    .prepare("SELECT SUM(blocked) AS b, SUM(botBlocked) AS bb FROM users")
    .first<{ b: number | null; bb: number | null }>();
  return { blocked: r?.b ?? 0, botBlocked: r?.bb ?? 0 };
}

/** New signups since `sinceIso` (by createdAt). */
export async function countUsersCreatedSince(db: DB, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE createdAt >= ?")
    .bind(sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countActiveSince(db: DB, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE updatedAt >= ?")
    .bind(sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Users last active in [fromIso, toExclusiveIso) — for the churn window (was active, now silent).
export async function countActiveBetween(db: DB, fromIso: string, toExclusiveIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE updatedAt >= ? AND updatedAt < ?")
    .bind(fromIso, toExclusiveIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Onboarded users who were active in the prior week but went silent this week (churn risk).
export async function listChurnedUsers(db: DB, priorFromIso: string, thisWeekIso: string): Promise<{ id: number; name: string }[]> {
  const r = await db
    .prepare(
      `SELECT id, profile FROM users
       WHERE onboarded = 1 AND blocked = 0 AND botBlocked = 0
         AND updatedAt >= ? AND updatedAt < ?`,
    )
    .bind(priorFromIso, thisWeekIso)
    .all<{ id: number; profile: string }>();
  return (r.results ?? []).map((x) => {
    let name = "";
    try { name = (JSON.parse(x.profile) as UserProfile).name || ""; } catch { /* ignore */ }
    return { id: x.id, name };
  });
}

// ---------- plans ----------

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

// ---------- plan bank (pre-generated, zero-AI) ----------

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

/** Engagement counts since a cutoff date (YYYY-MM-DD) for the owner report's product-pulse KPIs. */
export async function engagementSince(db: DB, cutoffDate: string): Promise<{ workouts: number; completed: number; checkins: number; nutrition: number }> {
  const one = async (sql: string) => (await db.prepare(sql).bind(cutoffDate).first<{ c: number }>())?.c ?? 0;
  const [workouts, completed, checkins, nutrition] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM workout_logs WHERE date >= ?"),
    one("SELECT COUNT(*) AS c FROM workout_logs WHERE date >= ? AND completed = 1"),
    one("SELECT COUNT(*) AS c FROM daily_checkins WHERE date >= ?"),
    one("SELECT COUNT(*) AS c FROM nutrition_logs WHERE date >= ?"),
  ]);
  return { workouts, completed, checkins, nutrition };
}

/** Total weekly-progression rows since `cutoff` (ISO) — how many silent micro-adjustments fired. */
export async function countAdjustmentsSince(db: DB, cutoff: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM plan_adjustments WHERE ts >= ?").bind(cutoff).first<{ c: number }>();
  return r?.c ?? 0;
}

/** Telemetry: record how a plan/meal was served, or a progression transition. `kind` is
 * 'workout' | 'meal' | 'level_up' | 'goal_switch' | 'plateau_swap'. Best-effort. */
export async function recordPlanSource(db: DB, userId: number, kind: string, source: "bank" | "template" | "ai"): Promise<void> {
  await db
    .prepare("INSERT INTO plan_source_logs (userId, kind, source, ts) VALUES (?, ?, ?, ?)")
    .bind(userId, kind, source, nowIso())
    .run();
}

/** Counts of plan sources since `cutoff` (ISO), for the owner report / Gemini-offload check. */
export async function countPlanSourcesSince(db: DB, cutoff: string): Promise<{ kind: string; source: string; c: number }[]> {
  try {
    const r = await db
      .prepare("SELECT kind, source, COUNT(*) AS c FROM plan_source_logs WHERE ts >= ? GROUP BY kind, source")
      .bind(cutoff)
      .all<{ kind: string; source: string; c: number }>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

/** Batch fetch UK (or other lang) translations for many exercise ids in one query. */
export async function getExerciseTranslations(
  db: DB,
  exerciseIds: string[],
  lang: string,
): Promise<Map<string, ExerciseTranslation>> {
  const out = new Map<string, ExerciseTranslation>();
  if (!exerciseIds.length) return out;
  const placeholders = exerciseIds.map(() => "?").join(",");
  const r = await db
    .prepare(
      `SELECT exerciseId, name, instructions, safety_info FROM exercise_translations
       WHERE lang = ? AND exerciseId IN (${placeholders})`,
    )
    .bind(lang, ...exerciseIds)
    .all<{ exerciseId: string; name: string; instructions: string; safety_info: string }>();
  for (const row of r.results ?? []) {
    out.set(row.exerciseId, { name: row.name, instructions: row.instructions, safetyInfo: row.safety_info });
  }
  return out;
}

// ---------- strength ----------

export interface PrResult {
  isPR: boolean; // beat a previous best (not the first-ever record)
  prevWeight?: number;
  prevReps?: number;
}

/** Best set of one exercise in a session, on whichever axis the exercise is measured. */
export interface BestSet {
  metric: ExerciseMetric;
  weight: number;
  reps: number;
  seconds?: number;
  meters?: number;
}

export async function upsertStrengthRecord(
  db: DB,
  userId: number,
  exercise: string,
  best: BestSet,
  date: string,
  rpe?: number,
): Promise<PrResult> {
  const now = nowIso();
  const { metric, weight, reps, seconds = 0, meters = 0 } = best;
  const entry = {
    date,
    weight,
    reps,
    ...(seconds > 0 ? { seconds } : {}),
    ...(meters > 0 ? { meters } : {}),
    ...(typeof rpe === "number" ? { rpe } : {}),
  };
  const row = await db
    .prepare("SELECT bestWeight, bestReps, bestSeconds, bestMeters, history FROM strength_records WHERE userId = ? AND exercise = ?")
    .bind(userId, exercise)
    .first<{ bestWeight: number; bestReps: number; bestSeconds: number; bestMeters: number; history: string }>();
  if (!row) {
    await db
      .prepare(
        "INSERT INTO strength_records (userId, exercise, bestWeight, bestReps, bestSeconds, bestMeters, metric, history, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(userId, exercise, weight, reps, seconds, meters, metric, JSON.stringify([entry]), now)
      .run();
    return { isPR: false };
  }
  const history = JSON.parse(row.history) as { date: string; weight: number; reps: number; seconds?: number; meters?: number; rpe?: number }[];
  history.push(entry);
  // "Better" and PR-worthiness are judged on the exercise's native axis. Time/distance PRs count
  // even at bodyweight; weight×reps PRs require external load (bodyweight reps don't rank).
  let better: boolean;
  let isPR: boolean;
  if (metric === "time") {
    better = seconds > (row.bestSeconds ?? 0);
    isPR = better && (row.bestSeconds ?? 0) > 0;
  } else if (metric === "distance") {
    better = meters > (row.bestMeters ?? 0);
    isPR = better && (row.bestMeters ?? 0) > 0;
  } else {
    better = weight > row.bestWeight || (weight === row.bestWeight && reps > row.bestReps);
    isPR = better && weight > 0;
  }
  await db
    .prepare(
      "UPDATE strength_records SET bestWeight = ?, bestReps = ?, bestSeconds = ?, bestMeters = ?, metric = ?, history = ?, updatedAt = ? WHERE userId = ? AND exercise = ?",
    )
    .bind(
      metric === "reps" && better ? weight : row.bestWeight,
      metric === "reps" && better ? reps : row.bestReps,
      metric === "time" && better ? seconds : (row.bestSeconds ?? 0),
      metric === "distance" && better ? meters : (row.bestMeters ?? 0),
      metric,
      JSON.stringify(history),
      now,
      userId,
      exercise,
    )
    .run();
  return { isPR, prevWeight: row.bestWeight, prevReps: row.bestReps };
}

export async function listStrength(db: DB, userId: number, limit?: number): Promise<StrengthRecordDoc[]> {
  const sql = `SELECT * FROM strength_records WHERE userId = ? ORDER BY bestWeight DESC${limit ? " LIMIT ?" : ""}`;
  const stmt = limit ? db.prepare(sql).bind(userId, limit) : db.prepare(sql).bind(userId);
  const r = await stmt.all<StrengthRow>();
  return (r.results ?? []).map(toStrength);
}

// ---------- workout logs ----------

export async function upsertWorkoutLog(
  db: DB,
  userId: number,
  date: string,
  weekday: Weekday,
  exercises: WorkoutLogDoc["exercises"],
  completed: boolean,
  notes?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workout_logs (userId, date, weekday, exercises, completed, notes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET
         weekday = excluded.weekday, exercises = excluded.exercises,
         completed = excluded.completed, notes = excluded.notes`,
    )
    .bind(userId, date, weekday, JSON.stringify(exercises), completed ? 1 : 0, notes ?? null, nowIso())
    .run();
}

export async function getWorkoutLog(db: DB, userId: number, date: string): Promise<WorkoutLogDoc | null> {
  const r = await db
    .prepare("SELECT * FROM workout_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<WorkoutRow>();
  return r ? toWorkout(r) : null;
}

/** ALL users' nutrition-log (userId, date) pairs on/after `sinceDate` — bulk compliance
 * counting for the trainer dashboard without a query per client. */
export async function allNutritionDatesSince(db: DB, sinceDate: string): Promise<{ userId: number; date: string }[]> {
  const r = await db
    .prepare("SELECT userId, date FROM nutrition_logs WHERE date >= ?")
    .bind(sinceDate)
    .all<{ userId: number; date: string }>();
  return r.results ?? [];
}

/** ALL users' workout logs on/after `sinceDate` — bulk prefetch of "today's log" (covering
 * every local timezone's today) for the hourly scheduler pass. */
export async function allWorkoutLogsSince(db: DB, sinceDate: string): Promise<WorkoutLogDoc[]> {
  const r = await db.prepare("SELECT * FROM workout_logs WHERE date >= ?").bind(sinceDate).all<WorkoutRow>();
  return (r.results ?? []).map(toWorkout);
}

export async function recentWorkoutLogs(db: DB, userId: number, limit: number): Promise<WorkoutLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM workout_logs WHERE userId = ? ORDER BY date DESC LIMIT ?")
    .bind(userId, limit)
    .all<WorkoutRow>();
  return (r.results ?? []).map(toWorkout);
}

export async function workoutLogsSince(db: DB, userId: number, cutoff: string): Promise<WorkoutLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM workout_logs WHERE userId = ? AND date >= ?")
    .bind(userId, cutoff)
    .all<WorkoutRow>();
  return (r.results ?? []).map(toWorkout);
}

export async function countWorkoutsSince(db: DB, cutoff: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM workout_logs WHERE date >= ?")
    .bind(cutoff)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countCompletedWorkouts(db: DB, userId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM workout_logs WHERE userId = ? AND completed = 1")
    .bind(userId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// All-users completed workouts in [from, toExclusive) — for the owner report's week-over-week trend.
export async function countCompletedWorkoutsBetween(db: DB, from: string, toExclusive: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM workout_logs WHERE completed = 1 AND date >= ? AND date < ?")
    .bind(from, toExclusive)
    .first<{ c: number }>();
  return r?.c ?? 0;
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

// ---------- bot records (leaderboards + achievements) ----------

/** Insert a badge once; returns true if it was newly earned (for one-time celebration). */
export async function awardAchievement(db: DB, userId: number, code: string): Promise<boolean> {
  const r = await db
    .prepare("INSERT OR IGNORE INTO achievements (userId, code, earnedAt) VALUES (?, ?, ?)")
    .bind(userId, code, nowIso())
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function listAchievements(db: DB, userId: number): Promise<string[]> {
  const r = await db
    .prepare("SELECT code FROM achievements WHERE userId = ? ORDER BY earnedAt ASC")
    .bind(userId)
    .all<{ code: string }>();
  return (r.results ?? []).map((x) => x.code);
}

export interface CompetitorRow {
  userId: number;
  lang: string;
  chatId: number;
  alias: string | null;
  profile: string;
}

/** The user's friend graph, derived from referrals (bidirectional): the person who invited
 * them + everyone they invited. Used to scope leaderboards to a friend circle. */
export async function friendIds(db: DB, userId: number): Promise<number[]> {
  const [me, invitees] = await Promise.all([
    db.prepare("SELECT json_extract(profile,'$.referredBy') AS ref FROM users WHERE id = ?").bind(userId).first<{ ref: number | null }>(),
    db.prepare("SELECT id FROM users WHERE json_extract(profile,'$.referredBy') = ?").bind(userId).all<{ id: number }>(),
  ]);
  const ids = new Set<number>();
  if (me?.ref) ids.add(Number(me.ref));
  for (const r of invitees.results ?? []) ids.add(r.id);
  ids.delete(userId);
  return [...ids];
}

/** All opted-in users with the fields needed to build/notify leaderboards. */
export async function listCompetitors(db: DB): Promise<CompetitorRow[]> {
  const r = await db
    .prepare("SELECT id AS userId, lang, chatId, alias, profile FROM users WHERE competeOptIn = 1")
    .all<CompetitorRow>();
  return r.results ?? [];
}

/** All completed-workout dates for opted-in users (for consistency/streak/total boards). */
export async function competitorWorkoutDates(db: DB): Promise<{ userId: number; date: string }[]> {
  const r = await db
    .prepare(
      "SELECT w.userId AS userId, w.date AS date FROM workout_logs w JOIN users u ON u.id = w.userId WHERE u.competeOptIn = 1 AND w.completed = 1",
    )
    .all<{ userId: number; date: string }>();
  return r.results ?? [];
}

/** Strength records for opted-in users (for relative-strength / most-improved boards). */
export async function competitorStrength(db: DB): Promise<StrengthRecordDoc[]> {
  const r = await db
    .prepare(
      "SELECT s.* FROM strength_records s JOIN users u ON u.id = s.userId WHERE u.competeOptIn = 1",
    )
    .all<StrengthRow>();
  return (r.results ?? []).map(toStrength);
}

/** Latest recorded bodyweight per opted-in user (for relative strength). */
export async function competitorBodyweights(db: DB): Promise<Map<number, number>> {
  const r = await db
    .prepare(
      "SELECT b.userId AS userId, b.weight AS weight, b.date AS date FROM body_logs b JOIN users u ON u.id = b.userId WHERE u.competeOptIn = 1 AND b.weight IS NOT NULL ORDER BY b.date ASC",
    )
    .all<{ userId: number; weight: number; date: string }>();
  const out = new Map<number, number>();
  for (const row of r.results ?? []) out.set(row.userId, row.weight); // ASC → last wins = latest
  return out;
}

// ---------- exercise catalog (API Ninjas, seeded) ----------

interface ExerciseRow {
  id: string;
  name: string;
  type: string | null;
  muscle: string;
  difficulty: string | null;
  equipments: string;
  instructions: string;
  safety_info: string;
}

function toCatalogExercise(r: ExerciseRow): CatalogExercise {
  return {
    id: r.id,
    name: r.name,
    type: r.type ?? undefined,
    muscle: r.muscle,
    difficulty: r.difficulty ?? undefined,
    equipments: r.equipments ? JSON.parse(r.equipments) : [],
    instructions: r.instructions,
    safetyInfo: r.safety_info,
  };
}

export async function countExercises(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM exercises").first<{ c: number }>();
  return r?.c ?? 0;
}

export async function getCatalogExercise(db: DB, id: string): Promise<CatalogExercise | null> {
  const r = await db.prepare("SELECT * FROM exercises WHERE id = ?").bind(id).first<ExerciseRow>();
  return r ? toCatalogExercise(r) : null;
}

// Returns a random exercise of higher difficulty for the given muscle, excluding excluded ids.
// beginner → intermediate → advanced → expert (tries each level in order, returns first match).
export async function findHarderExercise(
  db: DB,
  muscle: string,
  currentDifficulty: string,
  excludeIds: string[],
): Promise<CatalogExercise | null> {
  const order = ["beginner", "intermediate", "advanced", "expert"];
  const currentIdx = order.indexOf(currentDifficulty);
  // Try each difficulty level above the current one.
  for (let i = Math.max(currentIdx + 1, 1); i < order.length; i++) {
    const pick = await randomExerciseAt(db, muscle, order[i], excludeIds);
    if (pick) return pick;
  }
  return null;
}

// Pick a random exercise from the (small, index-bounded) muscle+difficulty bucket. The
// RANDOM() sort touches only that bucket's rows; without it SQLite returns the same
// deterministic first rows and most of the catalog becomes unreachable for swaps.
async function randomExerciseAt(
  db: DB,
  muscle: string,
  level: string,
  excludeIds: string[],
): Promise<CatalogExercise | null> {
  const notIn = excludeIds.length ? `AND id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  const sql = `SELECT * FROM exercises WHERE muscle = ?
    AND name NOT LIKE '%Russian%'
    AND difficulty = ?
    ${notIn}
    ORDER BY RANDOM() LIMIT 16`;
  const r = await db.prepare(sql).bind(muscle, level, ...excludeIds).all<ExerciseRow>();
  const rows = r.results ?? [];
  if (!rows.length) return null;
  return toCatalogExercise(rows[Math.floor(Math.random() * rows.length)]);
}

// Returns a random exercise of lower difficulty for the given muscle, excluding excluded ids.
export async function findEasierExercise(
  db: DB,
  muscle: string,
  currentDifficulty: string,
  excludeIds: string[],
): Promise<CatalogExercise | null> {
  const order = ["beginner", "intermediate", "advanced", "expert"];
  const currentIdx = order.indexOf(currentDifficulty);
  for (let i = Math.max(currentIdx - 1, 0); i >= 0; i--) {
    const pick = await randomExerciseAt(db, muscle, order[i], excludeIds);
    if (pick) return pick;
  }
  return null;
}

// Search by name, matching on ALL significant query WORDS (token-AND), so an imperfect
// translation ("rear delt fly") still matches a fuller catalog name ("Rear Delt Machine
// Fly"). When `lang` is given, each word may match the English name OR the cached
// translation. Falls back to a whole-phrase LIKE when there are no usable tokens.
export async function searchExercisesByName(
  db: DB,
  query: string,
  limit = 5,
  lang?: string,
): Promise<CatalogExercise[]> {
  const tokens = query
    .toLowerCase()
    .replace(/[%_]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .slice(0, 5);
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (lang) binds.push(lang); // JOIN param comes first
  const terms = tokens.length ? tokens : [query.replace(/[%_]/g, "").trim()];
  for (const term of terms) {
    const like = `%${term}%`;
    if (lang) {
      conds.push("(e.name LIKE ? OR t.name LIKE ?)");
      binds.push(like, like);
    } else {
      conds.push("e.name LIKE ?");
      binds.push(like);
    }
  }
  conds.push("e.name NOT LIKE '%Russian%'");
  binds.push(limit);
  const order =
    "ORDER BY CASE e.difficulty WHEN 'beginner' THEN 0 WHEN 'intermediate' THEN 1 ELSE 2 END LIMIT ?";
  const sql = lang
    ? `SELECT DISTINCT e.* FROM exercises e LEFT JOIN exercise_translations t ON t.exerciseId = e.id AND t.lang = ? WHERE ${conds.join(" AND ")} ${order}`
    : `SELECT e.* FROM exercises e WHERE ${conds.join(" AND ")} ${order}`;
  const r = await db.prepare(sql).bind(...binds).all<ExerciseRow>();
  return (r.results ?? []).map(toCatalogExercise);
}

// Candidate exercises for the given API muscle enums, up to `perMuscle` each (compounds/
// beginner-friendly first), capped at `total`. Beginners exclude `expert` difficulty.
export async function listCandidatesByMuscles(
  db: DB,
  muscles: string[],
  opts: { level?: string; perMuscle?: number; total?: number } = {},
): Promise<CatalogExercise[]> {
  if (!muscles.length) return [];
  const perMuscle = opts.perMuscle ?? 8;
  const total = opts.total ?? 40;
  const allowExpert = opts.level === "advanced" || opts.level === "intermediate";
  // One round-trip for all muscles (ordered by difficulty), then bucket per-muscle in JS to keep
  // the original per-muscle cap and input muscle ordering.
  const placeholders = muscles.map(() => "?").join(", ");
  const sql = `SELECT * FROM exercises WHERE muscle IN (${placeholders})
     AND name NOT LIKE '%Russian%'
     ${allowExpert ? "" : "AND (difficulty IS NULL OR difficulty != 'expert')"}
     ORDER BY CASE difficulty WHEN 'beginner' THEN 0 WHEN 'intermediate' THEN 1 ELSE 2 END`;
  const r = await db.prepare(sql).bind(...muscles).all<ExerciseRow>();
  const byMuscle = new Map<string, CatalogExercise[]>();
  for (const row of r.results ?? []) {
    const ex = toCatalogExercise(row);
    const bucket = byMuscle.get(ex.muscle) ?? [];
    if (bucket.length < perMuscle) {
      bucket.push(ex);
      byMuscle.set(ex.muscle, bucket);
    }
  }
  const out: CatalogExercise[] = [];
  for (const m of muscles) {
    for (const ex of byMuscle.get(m) ?? []) {
      out.push(ex);
      if (out.length >= total) return out;
    }
  }
  return out;
}

export async function upsertExercise(db: DB, e: CatalogExercise): Promise<void> {
  await db
    .prepare(
      `INSERT INTO exercises (id, name, type, muscle, difficulty, equipments, instructions, safety_info, fetchedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, type = excluded.type, muscle = excluded.muscle,
         difficulty = excluded.difficulty, equipments = excluded.equipments,
         instructions = excluded.instructions, safety_info = excluded.safety_info,
         fetchedAt = excluded.fetchedAt`,
    )
    .bind(e.id, e.name, e.type ?? null, e.muscle, e.difficulty ?? null, JSON.stringify(e.equipments), e.instructions, e.safetyInfo, nowIso())
    .run();
}

export async function getExerciseTranslation(
  db: DB,
  exerciseId: string,
  lang: string,
): Promise<ExerciseTranslation | null> {
  // Exercise-name translations are seeded for "uk" only; Russian speakers read Ukrainian
  // exercise names far better than the English canonical, so ru borrows the uk translations.
  if (lang === "ru") lang = "uk";
  const r = await db
    .prepare("SELECT name, instructions, safety_info FROM exercise_translations WHERE exerciseId = ? AND lang = ?")
    .bind(exerciseId, lang)
    .first<{ name: string; instructions: string; safety_info: string }>();
  return r ? { name: r.name, instructions: r.instructions, safetyInfo: r.safety_info } : null;
}

// Batched localized-name lookup by exerciseId — for render-time fallback so a plan that stored an
// English name still displays in the user's language when a translation exists.
export async function getExerciseTranslationNames(db: DB, ids: string[], lang: string): Promise<Map<string, string>> {
  if (lang === "ru") lang = "uk"; // ru borrows uk exercise-name translations (see getExerciseTranslation)
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const placeholders = uniq.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT exerciseId, name FROM exercise_translations WHERE lang = ? AND name <> '' AND exerciseId IN (${placeholders})`)
    .bind(lang, ...uniq)
    .all<{ exerciseId: string; name: string }>();
  for (const row of r.results ?? []) out.set(row.exerciseId, row.name);
  return out;
}

export async function upsertExerciseTranslation(
  db: DB,
  exerciseId: string,
  lang: string,
  tr: ExerciseTranslation,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO exercise_translations (exerciseId, lang, name, instructions, safety_info, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(exerciseId, lang) DO UPDATE SET
         name = excluded.name, instructions = excluded.instructions, safety_info = excluded.safety_info`,
    )
    .bind(exerciseId, lang, tr.name, tr.instructions, tr.safetyInfo, nowIso())
    .run();
}

// ---------- food name translations (cache) ----------

/** Localized names for the given English food names (lowercased keys). Returns en→name map. */
export async function getFoodTranslations(db: DB, names: string[], lang: string): Promise<Map<string, string>> {
  const keys = [...new Set(names.map((n) => n.toLowerCase().trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!keys.length) return map;
  const placeholders = keys.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT en, name FROM food_translations WHERE lang = ? AND en IN (${placeholders})`)
    .bind(lang, ...keys)
    .all<{ en: string; name: string }>();
  for (const row of r.results ?? []) map.set(row.en, row.name);
  return map;
}

/** Cache localized food names. `items` keys are English names (any case); stored lowercased. */
export async function upsertFoodTranslations(db: DB, lang: string, items: { en: string; name: string }[]): Promise<void> {
  const rows = items.filter((it) => it.en && it.name);
  if (!rows.length) return;
  const now = nowIso();
  const batch = rows.map((it) =>
    db
      .prepare(
        `INSERT INTO food_translations (en, lang, name, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(en, lang) DO UPDATE SET name = excluded.name`,
      )
      .bind(it.en.toLowerCase().trim(), lang, it.name, now),
  );
  await db.batch(batch);
}

// ---------- exercise technique videos (YouTube shorts cache) ----------

interface ExerciseVideoRow {
  normalized_name: string;
  exercise_name: string;
  youtube_video_id: string | null;
  youtube_url: string | null;
  youtube_title: string | null;
  channel_name: string | null;
  thumbnail_url: string | null;
  locked: number;
}

function toExerciseVideo(r: ExerciseVideoRow): ExerciseVideo {
  return {
    normalizedName: r.normalized_name,
    exerciseName: r.exercise_name,
    videoId: r.youtube_video_id,
    url: r.youtube_url,
    title: r.youtube_title,
    channelName: r.channel_name,
    thumbnailUrl: r.thumbnail_url,
    locked: !!r.locked,
  };
}

// Single lookup. Returns the row (incl. negative-cache entries where url is null) or undefined
// when the exercise has never been searched — the caller uses that to decide whether to search.
export async function getExerciseVideo(db: DB, key: string): Promise<ExerciseVideo | undefined> {
  const r = await db
    .prepare("SELECT * FROM exercise_videos WHERE normalized_name = ?")
    .bind(key.trim().toLowerCase())
    .first<ExerciseVideoRow>();
  return r ? toExerciseVideo(r) : undefined;
}

// Batched lookup for render prefetch. Keys present in the result Map have a row (value may be a
// negative-cache entry with url=null); keys absent from the Map have never been searched.
export async function getExerciseVideos(db: DB, keys: string[]): Promise<Map<string, ExerciseVideo>> {
  const out = new Map<string, ExerciseVideo>();
  const norm = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (!norm.length) return out;
  const placeholders = norm.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT * FROM exercise_videos WHERE normalized_name IN (${placeholders})`)
    .bind(...norm)
    .all<ExerciseVideoRow>();
  for (const row of r.results ?? []) out.set(row.normalized_name, toExerciseVideo(row));
  return out;
}

// Auto upsert (from search / backfill / refresh). A locked manual override is never overwritten:
// ON CONFLICT only updates when the existing row has locked = 0.
export async function upsertExerciseVideo(db: DB, v: ExerciseVideo): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO exercise_videos
         (normalized_name, exercise_name, youtube_video_id, youtube_url, youtube_title, channel_name, thumbnail_url, locked, set_by, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
       ON CONFLICT(normalized_name) DO UPDATE SET
         exercise_name = excluded.exercise_name,
         youtube_video_id = excluded.youtube_video_id,
         youtube_url = excluded.youtube_url,
         youtube_title = excluded.youtube_title,
         channel_name = excluded.channel_name,
         thumbnail_url = excluded.thumbnail_url,
         updatedAt = excluded.updatedAt
       WHERE exercise_videos.locked = 0`,
    )
    .bind(
      v.normalizedName.trim().toLowerCase(),
      v.exerciseName,
      v.videoId,
      v.url,
      v.title,
      v.channelName,
      v.thumbnailUrl,
      now,
      now,
    )
    .run();
}

// Manual override by a trainer/owner — unconditional upsert that locks the row so refresh and
// background backfill leave it alone.
export async function setManualVideo(
  db: DB,
  key: string,
  exerciseName: string,
  video: { videoId: string; url: string },
  setBy: number,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO exercise_videos
         (normalized_name, exercise_name, youtube_video_id, youtube_url, youtube_title, channel_name, thumbnail_url, locked, set_by, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, ?)
       ON CONFLICT(normalized_name) DO UPDATE SET
         exercise_name = excluded.exercise_name,
         youtube_video_id = excluded.youtube_video_id,
         youtube_url = excluded.youtube_url,
         youtube_title = NULL,
         channel_name = NULL,
         thumbnail_url = NULL,
         locked = 1,
         set_by = excluded.set_by,
         updatedAt = excluded.updatedAt`,
    )
    .bind(key.trim().toLowerCase(), exerciseName, video.videoId, video.url, setBy, now, now)
    .run();
}

// ---------- per-user video overrides (a user's own link, not shared) ----------

interface UserVideoRow {
  normalized_name: string;
  exercise_name: string;
  youtube_video_id: string;
  youtube_url: string;
}

// Set/replace a user's personal video override for one exercise.
export async function setUserVideo(
  db: DB,
  userId: number,
  key: string,
  exerciseName: string,
  video: { videoId: string; url: string },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO user_exercise_videos
         (userId, normalized_name, exercise_name, youtube_video_id, youtube_url, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, normalized_name) DO UPDATE SET
         exercise_name = excluded.exercise_name,
         youtube_video_id = excluded.youtube_video_id,
         youtube_url = excluded.youtube_url,
         updatedAt = excluded.updatedAt`,
    )
    .bind(userId, key.trim().toLowerCase(), exerciseName, video.videoId, video.url, now, now)
    .run();
}

// Remove a user's override (reverts to the shared/global video).
export async function deleteUserVideo(db: DB, userId: number, key: string): Promise<boolean> {
  const r = await db
    .prepare("DELETE FROM user_exercise_videos WHERE userId = ? AND normalized_name = ?")
    .bind(userId, key.trim().toLowerCase())
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// Batched lookup of a user's overrides, shaped like ExerciseVideo so render can merge them in.
export async function getUserVideos(db: DB, userId: number, keys: string[]): Promise<Map<string, ExerciseVideo>> {
  const out = new Map<string, ExerciseVideo>();
  const norm = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (!norm.length) return out;
  const placeholders = norm.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT * FROM user_exercise_videos WHERE userId = ? AND normalized_name IN (${placeholders})`)
    .bind(userId, ...norm)
    .all<UserVideoRow>();
  for (const row of r.results ?? []) {
    out.set(row.normalized_name, {
      normalizedName: row.normalized_name,
      exerciseName: row.exercise_name,
      videoId: row.youtube_video_id,
      url: row.youtube_url,
      title: null,
      channelName: null,
      thumbnailUrl: null,
      locked: true,
    });
  }
  return out;
}

// Distinct catalog exercise names — the universe of exercises /refreshvideos iterates over.
export async function listAllCatalogNames(db: DB): Promise<string[]> {
  const r = await db
    .prepare("SELECT name FROM exercises WHERE name NOT LIKE '%Russian%' ORDER BY name")
    .all<{ name: string }>();
  return (r.results ?? []).map((x) => x.name);
}

// ---------- nutrition logs ----------

export async function appendMeals(
  db: DB,
  userId: number,
  date: string,
  meals: MealEntry[],
): Promise<MealEntry[]> {
  const now = nowIso();
  const row = await db
    .prepare("SELECT meals FROM nutrition_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ meals: string }>();
  const all: MealEntry[] = row ? [...(JSON.parse(row.meals) as MealEntry[]), ...meals] : [...meals];
  if (row) {
    await db
      .prepare("UPDATE nutrition_logs SET meals = ?, updatedAt = ? WHERE userId = ? AND date = ?")
      .bind(JSON.stringify(all), now, userId, date)
      .run();
  } else {
    await db
      .prepare("INSERT INTO nutrition_logs (userId, date, meals, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, date, JSON.stringify(all), now, now)
      .run();
  }
  return all;
}

// Overwrite a day's meals (used by in-place edits). Deletes the row if the list is empty.
export async function setDayMeals(db: DB, userId: number, date: string, meals: MealEntry[]): Promise<void> {
  if (!meals.length) {
    await db.prepare("DELETE FROM nutrition_logs WHERE userId = ? AND date = ?").bind(userId, date).run();
    return;
  }
  const now = nowIso();
  const res = await db.prepare("UPDATE nutrition_logs SET meals = ?, updatedAt = ? WHERE userId = ? AND date = ?")
    .bind(JSON.stringify(meals), now, userId, date).run();
  if (!res.meta.changes) {
    await db.prepare("INSERT INTO nutrition_logs (userId, date, meals, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, date, JSON.stringify(meals), now, now).run();
  }
}

// Recent distinct foods (for one-tap re-log), most-recent first, deduped by name.
export async function getRecentFoods(db: DB, userId: number, sinceDate: string, limit = 12): Promise<MealEntry[]> {
  const r = await db
    .prepare("SELECT meals FROM nutrition_logs WHERE userId = ? AND date >= ? ORDER BY date DESC")
    .bind(userId, sinceDate)
    .all<{ meals: string }>();
  const seen = new Set<string>();
  const out: MealEntry[] = [];
  for (const row of r.results ?? []) {
    let meals: MealEntry[] = [];
    try { meals = JSON.parse(row.meals) as MealEntry[]; } catch { /* skip bad row */ }
    for (const m of meals) {
      const key = (m.desc || "").toLowerCase().replace(/[~(]?\s*\d.*$/u, "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function getDayMeals(db: DB, userId: number, date: string): Promise<MealEntry[]> {
  const row = await db
    .prepare("SELECT meals FROM nutrition_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ meals: string }>();
  return row ? (JSON.parse(row.meals) as MealEntry[]) : [];
}

// Remove one logged item by index from a day; deletes the row if it becomes empty. Returns the rest.
export async function deleteMealItem(db: DB, userId: number, date: string, index: number): Promise<MealEntry[]> {
  const meals = await getDayMeals(db, userId, date);
  if (index < 0 || index >= meals.length) return meals;
  meals.splice(index, 1);
  if (meals.length) {
    await db.prepare("UPDATE nutrition_logs SET meals = ?, updatedAt = ? WHERE userId = ? AND date = ?")
      .bind(JSON.stringify(meals), nowIso(), userId, date).run();
  } else {
    await db.prepare("DELETE FROM nutrition_logs WHERE userId = ? AND date = ?").bind(userId, date).run();
  }
  return meals;
}

export async function nutritionLogsSince(db: DB, userId: number, cutoff: string): Promise<NutritionLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM nutrition_logs WHERE userId = ? AND date >= ?")
    .bind(userId, cutoff)
    .all<{ userId: number; date: string; meals: string; createdAt: string; updatedAt: string }>();
  return (r.results ?? []).map((row) => ({
    userId: row.userId,
    date: row.date,
    meals: JSON.parse(row.meals),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }));
}

// ---------- body logs ----------

export async function saveBaselineBody(
  db: DB,
  userId: number,
  date: string,
  weight: number | undefined,
  measurements: BodyMeasurements | undefined,
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO body_logs (userId, date, weight, measurements, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, date, weight ?? null, measurements ? JSON.stringify(measurements) : null, nowIso())
    .run();
}

export async function upsertBodyLog(
  db: DB,
  userId: number,
  date: string,
  patch: { weight?: number; measurements?: BodyMeasurements },
): Promise<void> {
  const row = await db
    .prepare("SELECT weight, measurements FROM body_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ weight: number | null; measurements: string | null }>();
  if (row) {
    const newWeight = patch.weight !== undefined ? patch.weight : row.weight;
    const existing = row.measurements ? (JSON.parse(row.measurements) as BodyMeasurements) : {};
    const newMeas = patch.measurements ? { ...existing, ...patch.measurements } : existing;
    await db
      .prepare("UPDATE body_logs SET weight = ?, measurements = ? WHERE userId = ? AND date = ?")
      .bind(newWeight ?? null, Object.keys(newMeas).length ? JSON.stringify(newMeas) : null, userId, date)
      .run();
  } else {
    await db
      .prepare("INSERT INTO body_logs (userId, date, weight, measurements, createdAt) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, date, patch.weight ?? null, patch.measurements ? JSON.stringify(patch.measurements) : null, nowIso())
      .run();
  }
}

export async function bodyLogsByUser(db: DB, userId: number): Promise<BodyLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM body_logs WHERE userId = ? ORDER BY date ASC")
    .bind(userId)
    .all<BodyRow>();
  return (r.results ?? []).map(toBody);
}

// ---------- step logs ----------

export async function upsertStepLog(db: DB, userId: number, date: string, steps: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO step_logs (userId, date, steps, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET steps = excluded.steps`,
    )
    .bind(userId, date, steps, nowIso())
    .run();
}

export async function getStepLog(db: DB, userId: number, date: string): Promise<number | null> {
  const r = await db
    .prepare("SELECT steps FROM step_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ steps: number }>();
  return r ? r.steps : null;
}

export async function stepLogsSince(db: DB, userId: number, cutoff: string): Promise<StepLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM step_logs WHERE userId = ? AND date >= ? ORDER BY date ASC")
    .bind(userId, cutoff)
    .all<{ userId: number; date: string; steps: number; createdAt: string }>();
  return (r.results ?? []).map((x) => ({
    userId: x.userId,
    date: x.date,
    steps: x.steps,
    createdAt: new Date(x.createdAt),
  }));
}

// ---------- water logs ----------

export async function addWater(db: DB, userId: number, date: string, deltaMl: number): Promise<number> {
  await db
    .prepare(
      `INSERT INTO water_logs (userId, date, ml, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET ml = MAX(0, ml + ?)`,
    )
    .bind(userId, date, Math.max(0, deltaMl), nowIso(), deltaMl)
    .run();
  return (await getWater(db, userId, date)) ?? 0;
}

export async function setWater(db: DB, userId: number, date: string, ml: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO water_logs (userId, date, ml, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET ml = excluded.ml`,
    )
    .bind(userId, date, Math.max(0, ml), nowIso())
    .run();
}

export async function getWater(db: DB, userId: number, date: string): Promise<number | null> {
  const r = await db
    .prepare("SELECT ml FROM water_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ ml: number }>();
  return r ? r.ml : null;
}

/** Daily water totals in [cutoff, today], ascending. Used for challenge progress. */
export async function waterLogsSince(db: DB, userId: number, cutoff: string): Promise<{ date: string; ml: number }[]> {
  const r = await db
    .prepare("SELECT date, ml FROM water_logs WHERE userId = ? AND date >= ? ORDER BY date ASC")
    .bind(userId, cutoff)
    .all<{ date: string; ml: number }>();
  return r.results ?? [];
}

// ---------- challenges ----------

export async function joinChallenge(db: DB, userId: number, code: string, startDate: string, endDate: string): Promise<void> {
  await db
    .prepare("INSERT INTO challenges (userId, code, startDate, endDate, joinedAt) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, code, startDate, endDate, nowIso())
    .run();
}

export interface ChallengeRow {
  id: number;
  userId: number;
  code: string;
  startDate: string;
  endDate: string;
  completedAt: string | null;
}

/** In-progress challenges whose window hasn't closed yet (endDate >= today, not completed). */
export async function activeChallenges(db: DB, userId: number, today: string): Promise<ChallengeRow[]> {
  const r = await db
    .prepare("SELECT id, userId, code, startDate, endDate, completedAt FROM challenges WHERE userId = ? AND completedAt IS NULL AND endDate >= ? ORDER BY id ASC")
    .bind(userId, today)
    .all<ChallengeRow>();
  return r.results ?? [];
}

/** Codes the user currently has an open (not-yet-ended, not-completed) challenge for. */
export async function activeChallengeCodes(db: DB, userId: number, today: string): Promise<Set<string>> {
  return new Set((await activeChallenges(db, userId, today)).map((c) => c.code));
}

export async function markChallengeDone(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE challenges SET completedAt = ? WHERE id = ? AND completedAt IS NULL").bind(nowIso(), id).run();
}

export async function countCompletedChallenges(db: DB, userId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM challenges WHERE userId = ? AND completedAt IS NOT NULL")
    .bind(userId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// ---------- injuries ----------

interface InjuryRow {
  id: number; userId: number; area: string; severity: string; status: string;
  reportedAt: string; checkAfter: string; lastAskedAt: string | null; swaps: string; resolvedAt: string | null;
  // NOTE: column added by migration 0046. Older rows read as NULL → treat as empty array.
  checkinsHistory?: string | null;
}
function toInjury(r: InjuryRow): InjuryDoc {
  let swaps: InjuryDoc["swaps"] = [];
  try { swaps = JSON.parse(r.swaps || "[]"); } catch { swaps = []; }
  let checkinsHistory: InjuryDoc["checkinsHistory"] = [];
  try { checkinsHistory = JSON.parse(r.checkinsHistory || "[]"); } catch { checkinsHistory = []; }
  return {
    id: r.id, userId: r.userId, area: r.area, severity: r.severity,
    status: r.status === "recovered" ? "recovered" : "active",
    reportedAt: r.reportedAt, checkAfter: r.checkAfter, lastAskedAt: r.lastAskedAt, swaps, resolvedAt: r.resolvedAt,
    checkinsHistory,
  };
}

// Append a pain check-in (date + 0..10 score) to an active injury's history.
export async function appendInjuryCheckin(db: DB, id: number, entry: { date: string; score: number }): Promise<void> {
  const inj = await getInjury(db, id);
  if (!inj) return;
  // Idempotency: if a check-in for that same date already exists, replace the score instead of duplicating.
  const rest = inj.checkinsHistory.filter((h) => h.date !== entry.date);
  const next = [...rest, entry].sort((a, b) => a.date.localeCompare(b.date));
  await db.prepare("UPDATE injuries SET checkinsHistory = ? WHERE id = ?").bind(JSON.stringify(next), id).run();
}

export async function createInjury(
  db: DB,
  inj: { userId: number; area: string; severity: string; checkAfter: string; swaps: InjuryDoc["swaps"] },
): Promise<number> {
  const now = nowIso();
  const r = await db
    .prepare("INSERT INTO injuries (userId, area, severity, status, reportedAt, checkAfter, swaps) VALUES (?, ?, ?, 'active', ?, ?, ?) RETURNING id")
    .bind(inj.userId, inj.area, inj.severity, now, inj.checkAfter, JSON.stringify(inj.swaps))
    .first<{ id: number }>();
  return r?.id ?? 0;
}

export async function getInjury(db: DB, id: number): Promise<InjuryDoc | null> {
  const r = await db.prepare("SELECT * FROM injuries WHERE id = ?").bind(id).first<InjuryRow>();
  return r ? toInjury(r) : null;
}

export async function listActiveInjuries(db: DB, userId: number): Promise<InjuryDoc[]> {
  const r = await db.prepare("SELECT * FROM injuries WHERE userId = ? AND status = 'active' ORDER BY id DESC").bind(userId).all<InjuryRow>();
  return (r.results ?? []).map(toInjury);
}

export async function getActiveInjuryByArea(db: DB, userId: number, area: string): Promise<InjuryDoc | null> {
  const r = await db.prepare("SELECT * FROM injuries WHERE userId = ? AND area = ? AND status = 'active'").bind(userId, area).first<InjuryRow>();
  return r ? toInjury(r) : null;
}

/** Active injuries whose follow-up is due and not yet asked today. */
export async function listInjuriesDue(db: DB, userId: number, today: string): Promise<InjuryDoc[]> {
  const r = await db
    .prepare("SELECT * FROM injuries WHERE userId = ? AND status = 'active' AND checkAfter <= ? AND (lastAskedAt IS NULL OR lastAskedAt != ?)")
    .bind(userId, today, today)
    .all<InjuryRow>();
  return (r.results ?? []).map(toInjury);
}

export async function updateInjury(
  db: DB,
  id: number,
  fields: { area: string; severity: string; checkAfter: string; swaps: InjuryDoc["swaps"] },
): Promise<void> {
  await db
    .prepare("UPDATE injuries SET area = ?, severity = ?, status = 'active', reportedAt = ?, checkAfter = ?, lastAskedAt = NULL, swaps = ?, resolvedAt = NULL WHERE id = ?")
    .bind(fields.area, fields.severity, nowIso(), fields.checkAfter, JSON.stringify(fields.swaps), id)
    .run();
}

export async function markInjuryAsked(db: DB, id: number, today: string): Promise<void> {
  await db.prepare("UPDATE injuries SET lastAskedAt = ? WHERE id = ?").bind(today, id).run();
}

export async function extendInjury(db: DB, id: number, checkAfter: string): Promise<void> {
  await db.prepare("UPDATE injuries SET checkAfter = ?, lastAskedAt = NULL WHERE id = ?").bind(checkAfter, id).run();
}

export async function resolveInjury(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE injuries SET status = 'recovered', resolvedAt = ? WHERE id = ?").bind(nowIso(), id).run();
}

// ---------- sessions (trainer↔client bookings) ----------

interface SessionRow {
  id: number; trainerId: number; clientId: number; date: string; hour: number;
  kind: string; status: string; proposedBy: string; note: string | null; remindedAt: string | null; createdAt: string;
  tz: string | null; meetingLink: string | null; groupId: string | null;
}
function toSession(r: SessionRow): SessionDoc {
  return {
    id: r.id, trainerId: r.trainerId, clientId: r.clientId, date: r.date, hour: r.hour,
    kind: r.kind === "online" ? "online" : "offline",
    status: r.status as SessionDoc["status"],
    proposedBy: r.proposedBy === "trainer" ? "trainer" : "client",
    note: r.note, remindedAt: r.remindedAt, createdAt: r.createdAt,
    tz: r.tz ?? null, meetingLink: r.meetingLink ?? null,
    ...(r.groupId ? { groupId: r.groupId } : {}),
  };
}

export async function createSession(
  db: DB,
  s: { trainerId: number; clientId: number; date: string; hour: number; kind?: string; proposedBy: "trainer" | "client"; note?: string; tz?: string; groupId?: string },
): Promise<number> {
  const r = await db
    .prepare("INSERT INTO sessions (trainerId, clientId, date, hour, kind, status, proposedBy, note, tz, groupId, createdAt) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?) RETURNING id")
    .bind(s.trainerId, s.clientId, s.date, s.hour, s.kind ?? "offline", s.proposedBy, s.note ?? null, s.tz ?? null, s.groupId ?? null, nowIso())
    .first<{ id: number }>();
  return r?.id ?? 0;
}

/** Book the SAME slot for several clients at once (group / semi-private). Creates one proposed
 * session per client sharing a groupId; each client confirms/declines independently. Returns the
 * created session ids paired with their clientId (caller pushes the per-client invites). */
export async function createGroupSessions(
  db: DB,
  trainerId: number,
  clientIds: number[],
  date: string,
  hour: number,
  tz?: string,
): Promise<{ clientId: number; id: number }[]> {
  const groupId = crypto.randomUUID();
  const out: { clientId: number; id: number }[] = [];
  for (const clientId of clientIds) {
    const id = await createSession(db, { trainerId, clientId, date, hour, proposedBy: "trainer", tz, groupId });
    if (id) out.push({ clientId, id });
  }
  return out;
}

export async function setSessionLink(db: DB, id: number, link: string): Promise<void> {
  await db.prepare("UPDATE sessions SET meetingLink = ? WHERE id = ?").bind(link, id).run();
}

export async function getSession(db: DB, id: number): Promise<SessionDoc | null> {
  const r = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();
  return r ? toSession(r) : null;
}

/** Change a session's status, optionally only from an expected status. Returns true if it changed. */
export async function setSessionStatus(db: DB, id: number, status: string, fromStatus?: string | string[]): Promise<boolean> {
  let sql = "UPDATE sessions SET status = ? WHERE id = ?";
  const binds: unknown[] = [status, id];
  if (fromStatus) {
    const list = Array.isArray(fromStatus) ? fromStatus : [fromStatus];
    sql += ` AND status IN (${list.map(() => "?").join(", ")})`;
    binds.push(...list);
  }
  const r = await db.prepare(sql).bind(...binds).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Sessions for a user (role picks the column) within [fromDate, toDate], excluding declined/cancelled. */
export async function sessionsBetween(db: DB, userId: number, role: "trainer" | "client", fromDate: string, toDate: string): Promise<SessionDoc[]> {
  const col = role === "trainer" ? "trainerId" : "clientId";
  const r = await db
    .prepare(`SELECT * FROM sessions WHERE ${col} = ? AND date >= ? AND date <= ? AND status IN ('proposed','confirmed','done') ORDER BY date ASC, hour ASC`)
    .bind(userId, fromDate, toDate)
    .all<SessionRow>();
  return (r.results ?? []).map(toSession);
}

/** Next confirmed sessions from today onward. */
export async function upcomingSessionsFor(db: DB, userId: number, role: "trainer" | "client", today: string, limit = 5): Promise<SessionDoc[]> {
  const col = role === "trainer" ? "trainerId" : "clientId";
  const r = await db
    .prepare(`SELECT * FROM sessions WHERE ${col} = ? AND date >= ? AND status = 'confirmed' ORDER BY date ASC, hour ASC LIMIT ?`)
    .bind(userId, today, limit)
    .all<SessionRow>();
  return (r.results ?? []).map(toSession);
}

/** Confirmed sessions on a specific date for a user (day card / trainer day list). */
export async function sessionsOnDate(db: DB, userId: number, role: "trainer" | "client", date: string): Promise<SessionDoc[]> {
  const col = role === "trainer" ? "trainerId" : "clientId";
  const r = await db
    .prepare(`SELECT * FROM sessions WHERE ${col} = ? AND date = ? AND status IN ('proposed','confirmed') ORDER BY hour ASC`)
    .bind(userId, date)
    .all<SessionRow>();
  return (r.results ?? []).map(toSession);
}

/** Flip past confirmed sessions to done. Returns the affected (trainer, client) pairs so the
 * caller can decrement prepaid session packages (client_billing). */
export async function markPastSessionsDone(db: DB, today: string): Promise<{ trainerId: number; clientId: number }[]> {
  const r = await db
    .prepare("SELECT trainerId, clientId FROM sessions WHERE status = 'confirmed' AND date < ?")
    .bind(today)
    .all<{ trainerId: number; clientId: number }>();
  await db.prepare("UPDATE sessions SET status = 'done' WHERE status = 'confirmed' AND date < ?").bind(today).run();
  return r.results ?? [];
}

// ---------- trainer client notes ----------

export async function getClientNote(db: DB, trainerId: number, clientId: number): Promise<string | null> {
  const r = await db
    .prepare("SELECT note FROM client_notes WHERE trainerId = ? AND clientId = ?")
    .bind(trainerId, clientId)
    .first<{ note: string }>();
  return r ? r.note : null;
}

export async function setClientNote(db: DB, trainerId: number, clientId: number, note: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO client_notes (trainerId, clientId, note, updatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(trainerId, clientId) DO UPDATE SET note = excluded.note, updatedAt = excluded.updatedAt`,
    )
    .bind(trainerId, clientId, note, nowIso())
    .run();
}

// ---------- trainer client cards (health / personal notes / birthday) ----------

export async function getClientCard(db: DB, trainerId: number, clientId: number): Promise<ClientCardDoc | null> {
  // try/catch protects the deploy-before-migrate window when client_cards doesn't exist yet.
  try {
    const r = await db
      .prepare("SELECT trainerId, clientId, healthNotes, personalNotes, birthday, updatedAt FROM client_cards WHERE trainerId = ? AND clientId = ?")
      .bind(trainerId, clientId)
      .first<ClientCardDoc>();
    return r ?? null;
  } catch {
    return null;
  }
}

/** Upsert one card field; keys absent from the patch keep their stored value. */
export async function setClientCard(
  db: DB,
  trainerId: number,
  clientId: number,
  patch: { healthNotes?: string | null; personalNotes?: string | null; birthday?: string | null },
): Promise<void> {
  const cur = await getClientCard(db, trainerId, clientId);
  const healthNotes = patch.healthNotes !== undefined ? patch.healthNotes : (cur?.healthNotes ?? null);
  const personalNotes = patch.personalNotes !== undefined ? patch.personalNotes : (cur?.personalNotes ?? null);
  const birthday = patch.birthday !== undefined ? patch.birthday : (cur?.birthday ?? null);
  await db
    .prepare(
      `INSERT INTO client_cards (trainerId, clientId, healthNotes, personalNotes, birthday, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(trainerId, clientId) DO UPDATE SET healthNotes = excluded.healthNotes, personalNotes = excluded.personalNotes, birthday = excluded.birthday, updatedAt = excluded.updatedAt`,
    )
    .bind(trainerId, clientId, healthNotes, personalNotes, birthday, nowIso())
    .run();
}

// ---------- feedback ----------

export async function insertFeedback(
  db: DB,
  f: { userId: number; username?: string; text: string; date: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO feedback (userId, username, text, date, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(f.userId, f.username ?? null, f.text, f.date, nowIso())
    .run();
}

export async function countFeedbackSince(db: DB, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM feedback WHERE createdAt >= ?")
    .bind(sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function recentFeedback(
  db: DB,
  limit: number,
): Promise<{ userId: number; username?: string; text: string; date: string }[]> {
  const r = await db
    .prepare("SELECT userId, username, text, date FROM feedback ORDER BY createdAt DESC LIMIT ?")
    .bind(limit)
    .all<{ userId: number; username: string | null; text: string; date: string }>();
  return (r.results ?? []).map((x) => ({
    userId: x.userId,
    username: x.username ?? undefined,
    text: x.text,
    date: x.date,
  }));
}

export async function listUsersBrief(
  db: DB,
  limit?: number,
): Promise<{ id: number; name: string; username?: string; onboarded: boolean; updatedAt: string; lastSeenAt?: string; trainerId?: number; blocked: boolean; botBlocked: boolean; profile: UserProfile }[]> {
  // No limit → every user (owner report lists all). With a limit → most-recently-active first.
  const sql = "SELECT id, onboarded, profile, updatedAt, lastSeenAt, trainerId, username, blocked, botBlocked FROM users ORDER BY updatedAt DESC" + (limit ? " LIMIT ?" : "");
  const stmt = limit ? db.prepare(sql).bind(limit) : db.prepare(sql);
  const r = await stmt
    .all<{ id: number; onboarded: number; profile: string; updatedAt: string; lastSeenAt: string | null; trainerId: number | null; username: string | null; blocked: number | null; botBlocked: number | null }>();
  return (r.results ?? []).map((x) => {
    let profile: UserProfile = {};
    try {
      profile = JSON.parse(x.profile) as UserProfile;
    } catch {
      /* ignore */
    }
    return { id: x.id, name: profile.name || "", username: x.username ?? undefined, onboarded: !!x.onboarded, updatedAt: x.updatedAt, lastSeenAt: x.lastSeenAt ?? undefined, trainerId: x.trainerId ?? undefined, blocked: !!x.blocked, botBlocked: !!x.botBlocked, profile };
  });
}

/** All-time logged-event counts per user (workouts, check-ins, nutrition logs, step logs).
 * Four GROUP BY queries total — independent of user count — for the owner report. */
export async function eventCountsByUser(
  db: DB,
): Promise<Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>> {
  const q = (sql: string) => db.prepare(sql).all<{ userId: number; c: number }>();
  const [w, c, n, s] = await Promise.all([
    // Completed only — a skip writes a workout_logs row with completed=0 and must NOT count as a workout.
    q("SELECT userId, COUNT(*) AS c FROM workout_logs WHERE completed = 1 GROUP BY userId"),
    q("SELECT userId, COUNT(*) AS c FROM daily_checkins GROUP BY userId"),
    q("SELECT userId, COUNT(*) AS c FROM nutrition_logs GROUP BY userId"),
    q("SELECT userId, COUNT(*) AS c FROM step_logs GROUP BY userId"),
  ]);
  const map = new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>();
  const get = (id: number) => {
    let e = map.get(id);
    if (!e) { e = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 }; map.set(id, e); }
    return e;
  };
  for (const r of w.results ?? []) get(r.userId).workouts = r.c;
  for (const r of c.results ?? []) get(r.userId).checkins = r.c;
  for (const r of n.results ?? []) get(r.userId).nutrition = r.c;
  for (const r of s.results ?? []) get(r.userId).steps = r.c;
  return map;
}

// ---------- ai usage ----------

/** Prepared-statement builder so the AI orchestrator can flush all per-attempt telemetry
 * in ONE db.batch round-trip instead of awaiting two INSERTs per provider attempt. */
export function aiUsageStmt(db: DB, u: Omit<AiUsageDoc, "ts">): D1PreparedStatement {
  return db
    .prepare("INSERT INTO ai_usage (userId, provider, kind, model, ok, date, ts) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(u.userId ?? null, u.provider, u.kind, u.model, u.ok ? 1 : 0, u.date, nowIso());
}

export async function aiUsageSince(
  db: DB,
  sinceIso: string,
): Promise<{ provider: string; kind: string; ok: boolean }[]> {
  const r = await db
    .prepare("SELECT provider, kind, ok FROM ai_usage WHERE ts >= ?")
    .bind(sinceIso)
    .all<{ provider: string; kind: string; ok: number }>();
  return (r.results ?? []).map((x) => ({ provider: x.provider, kind: x.kind, ok: !!x.ok }));
}

// ---------- ai call logs (per-attempt telemetry) ----------

/** Prepared-statement builder — see aiUsageStmt. */
export function aiCallStmt(
  db: DB,
  c: { userId?: number; provider: AiProvider; kind: AiKind; latencyMs: number; tokens?: number; wasFallback: boolean },
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO ai_call_logs (userId, provider, kind, latency_ms, tokens, was_fallback, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(c.userId ?? null, c.provider, c.kind, Math.round(c.latencyMs), c.tokens ?? null, c.wasFallback ? 1 : 0, nowIso());
}

export async function aiCallStatsSince(
  db: DB,
  sinceIso: string,
): Promise<{ provider: string; calls: number; fallbacks: number; avgLatencyMs: number; tokens: number }[]> {
  const r = await db
    .prepare(
      `SELECT provider,
              COUNT(*) AS calls,
              SUM(was_fallback) AS fallbacks,
              AVG(latency_ms) AS avgLatency,
              COALESCE(SUM(tokens), 0) AS tokens
       FROM ai_call_logs WHERE ts >= ? GROUP BY provider`,
    )
    .bind(sinceIso)
    .all<{ provider: string; calls: number; fallbacks: number; avgLatency: number; tokens: number }>();
  return (r.results ?? []).map((x) => ({
    provider: x.provider,
    calls: x.calls,
    fallbacks: x.fallbacks ?? 0,
    avgLatencyMs: Math.round(x.avgLatency ?? 0),
    tokens: x.tokens ?? 0,
  }));
}

// ---------- meal plans (AI nutritionist) + USDA/OFF lookup cache ----------

export async function saveMealPlan(db: DB, plan: MealPlanDoc): Promise<void> {
  await db
    .prepare(
      `INSERT INTO meal_plans (userId, week, days, targets, generatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userId, week) DO UPDATE SET days = excluded.days, targets = excluded.targets, generatedAt = excluded.generatedAt`,
    )
    .bind(plan.userId, plan.week, JSON.stringify(plan.days), JSON.stringify(plan.targets), nowIso())
    .run();
}

export async function getMealPlan(db: DB, userId: number, week = 0): Promise<MealPlanDoc | null> {
  const r = await db
    .prepare("SELECT * FROM meal_plans WHERE userId = ? AND week = ?")
    .bind(userId, week)
    .first<{ userId: number; week: number; days: string; targets: string; generatedAt: string }>();
  return r
    ? { userId: r.userId, week: r.week, days: JSON.parse(r.days), targets: JSON.parse(r.targets), generatedAt: new Date(r.generatedAt) }
    : null;
}

export async function getFoodCache(db: DB, query: string): Promise<unknown | null> {
  const r = await db.prepare("SELECT per100g FROM food_cache WHERE query = ?").bind(query.toLowerCase()).first<{ per100g: string }>();
  return r ? JSON.parse(r.per100g) : null;
}

export async function putFoodCache(db: DB, query: string, per100g: unknown): Promise<void> {
  await db
    .prepare("INSERT INTO food_cache (query, per100g, ts) VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET per100g = excluded.per100g, ts = excluded.ts")
    .bind(query.toLowerCase(), JSON.stringify(per100g), nowIso())
    .run();
}

// ---------- per-user food macro corrections ----------

export async function getUserFoodCorrection(db: DB, userId: number, query: string): Promise<{ kcal: number; protein: number; fats: number; carbs: number } | null> {
  const r = await db
    .prepare("SELECT per100g FROM food_corrections WHERE userId = ? AND query = ?")
    .bind(userId, query.trim().toLowerCase())
    .first<{ per100g: string }>();
  return r ? (JSON.parse(r.per100g) as { kcal: number; protein: number; fats: number; carbs: number }) : null;
}

export async function putUserFoodCorrection(db: DB, userId: number, query: string, per100g: { kcal: number; protein: number; fats: number; carbs: number }): Promise<void> {
  await db
    .prepare("INSERT INTO food_corrections (userId, query, per100g, ts) VALUES (?, ?, ?, ?) ON CONFLICT(userId, query) DO UPDATE SET per100g = excluded.per100g, ts = excluded.ts")
    .bind(userId, query.trim().toLowerCase(), JSON.stringify(per100g), nowIso())
    .run();
}

// ---------- error logs (AI failures for the owner report) ----------

export async function recordError(
  db: DB,
  e: { userId?: number; kind: string; errorType: string; message?: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO error_logs (userId, kind, errorType, message, ts) VALUES (?, ?, ?, ?, ?)")
    .bind(e.userId ?? null, e.kind, e.errorType, e.message?.slice(0, 200) ?? null, nowIso())
    .run();
}

export async function errorStatsSince(
  db: DB,
  sinceIso: string,
): Promise<{ kind: string; errorType: string; n: number }[]> {
  const r = await db
    .prepare("SELECT kind, errorType, COUNT(*) AS n FROM error_logs WHERE ts >= ? GROUP BY kind, errorType ORDER BY n DESC")
    .bind(sinceIso)
    .all<{ kind: string; errorType: string; n: number }>();
  return (r.results ?? []).map((x) => ({ kind: x.kind, errorType: x.errorType, n: x.n }));
}

export async function recentErrors(
  db: DB,
  sinceIso: string,
  limit = 6,
): Promise<{ kind: string; errorType: string; message: string | null; ts: string }[]> {
  const r = await db
    .prepare("SELECT kind, errorType, message, ts FROM error_logs WHERE ts >= ? ORDER BY ts DESC LIMIT ?")
    .bind(sinceIso, limit)
    .all<{ kind: string; errorType: string; message: string | null; ts: string }>();
  return r.results ?? [];
}

// ---------- daily check-ins (subjective wellbeing) ----------

export async function recordDailyCheckin(
  db: DB,
  userId: number,
  date: string,
  energy: number,
  sleep: number,
  stress: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_checkins (userId, date, energy, sleep, stress, createdAt) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET energy = excluded.energy, sleep = excluded.sleep, stress = excluded.stress`,
    )
    .bind(userId, date, energy, sleep, stress, nowIso())
    .run();
}

export async function getDailyCheckin(db: DB, userId: number, date: string): Promise<DailyCheckinDoc | null> {
  const r = await db
    .prepare("SELECT * FROM daily_checkins WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ userId: number; date: string; energy: number; sleep: number; stress: number; createdAt: string }>();
  return r ? { ...r, createdAt: new Date(r.createdAt) } : null;
}

export async function dailyCheckinsSince(db: DB, userId: number, cutoff: string): Promise<DailyCheckinDoc[]> {
  const r = await db
    .prepare("SELECT * FROM daily_checkins WHERE userId = ? AND date >= ? ORDER BY date")
    .bind(userId, cutoff)
    .all<{ userId: number; date: string; energy: number; sleep: number; stress: number; createdAt: string }>();
  return (r.results ?? []).map((x) => ({ ...x, createdAt: new Date(x.createdAt) }));
}

/** All of a user's logged activity since `cutoff`, fetched in ONE parallel round-trip. Report
 * (`cmdReport`) and export (`buildExportMd`) built the identical 6-7 read fan-out separately —
 * this collapses that duplication so a new logged metric is added in exactly one place. */
export interface ActivitySnapshot {
  workouts: WorkoutLogDoc[];
  nutrition: NutritionLogDoc[];
  strength: StrengthRecordDoc[];
  body: BodyLogDoc[];
  steps: StepLogDoc[];
  water: { date: string; ml: number }[];
  checkins: DailyCheckinDoc[];
}
export async function loadActivityWindow(
  db: DB,
  userId: number,
  cutoff: string,
  opts: { strengthLimit?: number } = {},
): Promise<ActivitySnapshot> {
  const [workouts, nutrition, strength, body, steps, water, checkins] = await Promise.all([
    workoutLogsSince(db, userId, cutoff),
    nutritionLogsSince(db, userId, cutoff),
    listStrength(db, userId, opts.strengthLimit),
    bodyLogsByUser(db, userId),
    stepLogsSince(db, userId, cutoff),
    waterLogsSince(db, userId, cutoff),
    dailyCheckinsSince(db, userId, cutoff),
  ]);
  return { workouts, nutrition, strength, body, steps, water, checkins };
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

// ---------- combined recent context (for the data-grounded coach) ----------

export async function getRecentContext(
  db: DB,
  userId: number,
  days = 7,
): Promise<{ workouts: WorkoutLogDoc[]; nutrition: NutritionLogDoc[] }> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [workouts, nutrition] = await Promise.all([
    workoutLogsSince(db, userId, cutoff),
    nutritionLogsSince(db, userId, cutoff),
  ]);
  return { workouts, nutrition };
}

export async function setProgressionRate(db: DB, userId: number, rate: ProgressionRate): Promise<void> {
  await db.prepare("UPDATE users SET progression_rate = ? WHERE id = ?").bind(rate, userId).run();
}

// ---------- config / owner ----------

export async function getOwnerChatId(db: DB): Promise<number | undefined> {
  const r = await db
    .prepare("SELECT ownerChatId FROM config WHERE id = 'config'")
    .first<{ ownerChatId: number | null }>();
  return r?.ownerChatId ?? undefined;
}

export async function setOwnerChatId(db: DB, chatId: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO config (id, ownerChatId) VALUES ('config', ?) ON CONFLICT(id) DO UPDATE SET ownerChatId = excluded.ownerChatId",
    )
    .bind(chatId)
    .run();
}

// Owner-alert dedup state ({ "<alertKey>": "<iso>" }) — throttles proactive alerts.
export async function getAlertState(db: DB): Promise<Record<string, string>> {
  const r = await db.prepare("SELECT alertState FROM config WHERE id = 'config'").first<{ alertState: string | null }>();
  if (!r?.alertState) return {};
  try { return JSON.parse(r.alertState) as Record<string, string>; } catch { return {}; }
}

export async function setAlertState(db: DB, state: Record<string, string>): Promise<void> {
  await db
    .prepare("INSERT INTO config (id, alertState) VALUES ('config', ?) ON CONFLICT(id) DO UPDATE SET alertState = excluded.alertState")
    .bind(JSON.stringify(state))
    .run();
}

// ---------- admin audit log + client flag ----------

export async function recordAudit(db: DB, actorId: number, action: string, targetId?: number, detail?: string): Promise<void> {
  await db
    .prepare("INSERT INTO admin_audit (ts, actorId, action, targetId, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(nowIso(), actorId, action, targetId ?? null, detail?.slice(0, 200) ?? null)
    .run();
}

export async function recentAudit(db: DB, limit = 10): Promise<{ ts: string; actorId: number; action: string; targetId: number | null; detail: string | null }[]> {
  const r = await db
    .prepare("SELECT ts, actorId, action, targetId, detail FROM admin_audit ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<{ ts: string; actorId: number; action: string; targetId: number | null; detail: string | null }>();
  return r.results ?? [];
}

export async function setUserFlag(db: DB, userId: number, flagged: boolean): Promise<void> {
  await db.prepare("UPDATE users SET flagged = ? WHERE id = ?").bind(flagged ? 1 : 0, userId).run();
}

// ---------- roles: trainers, clients, requests, questions, messages ----------

const csvToArr = (s: string | null): string[] | undefined => {
  if (!s) return undefined;
  const a = s.split(",").map((x) => x.trim()).filter(Boolean);
  return a.length ? a : undefined;
};
const arrToCsv = (a?: string[]): string | null => (a && a.length ? a.join(",") : null);

function toTrainer(r: {
  trainerId: number; status: string; inviteCode: string | null; name: string;
  bio: string | null; accepting: number; createdAt: string; approvedAt: string | null;
  specialization: string | null; tags: string | null; certifications: string | null;
  experienceYears: number | null; approach: string | null; priceOnline: number | null;
  priceOffline: number | null; currency: string | null; city: string | null;
  contact: string | null; languages: string | null; photoFileId: string | null;
  profileComplete: number; ratingSum: number; ratingCount: number; maxClients: number | null; isInstructor: number | null;
}): TrainerDoc {
  return {
    trainerId: r.trainerId,
    status: r.status as TrainerDoc["status"],
    inviteCode: r.inviteCode ?? undefined,
    name: r.name,
    bio: r.bio ?? undefined,
    accepting: !!r.accepting,
    createdAt: new Date(r.createdAt),
    approvedAt: r.approvedAt ? new Date(r.approvedAt) : undefined,
    specialization: r.specialization ?? undefined,
    tags: csvToArr(r.tags),
    certifications: r.certifications ?? undefined,
    experienceYears: r.experienceYears ?? undefined,
    approach: r.approach ?? undefined,
    priceOnline: r.priceOnline ?? undefined,
    priceOffline: r.priceOffline ?? undefined,
    currency: (r.currency as TrainerDoc["currency"]) ?? undefined,
    city: r.city ?? undefined,
    contact: r.contact ?? undefined,
    languages: csvToArr(r.languages),
    photoFileId: r.photoFileId ?? undefined,
    profileComplete: !!r.profileComplete,
    ratingCount: r.ratingCount ?? 0,
    ratingAvg: r.ratingCount ? r.ratingSum / r.ratingCount : undefined,
    maxClients: r.maxClients ?? undefined,
    isInstructor: !!r.isInstructor,
  };
}

function toReview(r: {
  id: number; trainerId: number; clientId: number; rating: number; text: string | null; createdAt: string;
}): TrainerReviewDoc {
  return {
    id: r.id,
    trainerId: r.trainerId,
    clientId: r.clientId,
    rating: r.rating,
    text: r.text ?? undefined,
    createdAt: new Date(r.createdAt),
  };
}

export async function setRole(db: DB, userId: number, role: Role): Promise<void> {
  await db.prepare("UPDATE users SET role = ?, updatedAt = ? WHERE id = ?").bind(role, nowIso(), userId).run();
}

export async function applyTrainer(db: DB, trainerId: number, p: TrainerProfileInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO trainers
         (trainerId, status, name, bio, accepting, createdAt,
          specialization, tags, certifications, experienceYears, approach,
          priceOnline, priceOffline, currency, city, contact, languages, photoFileId, profileComplete)
       VALUES (?, 'pending', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(trainerId) DO UPDATE SET
         status='pending', name=excluded.name, bio=excluded.bio,
         specialization=excluded.specialization, tags=excluded.tags,
         certifications=excluded.certifications, experienceYears=excluded.experienceYears,
         approach=excluded.approach, priceOnline=excluded.priceOnline,
         priceOffline=excluded.priceOffline, currency=excluded.currency,
         city=excluded.city, contact=excluded.contact, languages=excluded.languages,
         photoFileId=excluded.photoFileId, profileComplete=excluded.profileComplete`,
    )
    .bind(
      trainerId,
      (p.name ?? "Trainer").slice(0, 80),
      p.bio ?? null,
      nowIso(),
      p.specialization ?? null,
      arrToCsv(p.tags),
      p.certifications ?? null,
      p.experienceYears ?? null,
      p.approach ?? null,
      p.priceOnline ?? null,
      p.priceOffline ?? null,
      p.currency ?? null,
      p.city ?? null,
      p.contact ?? null,
      arrToCsv(p.languages),
      p.photoFileId ?? null,
      p.profileComplete ? 1 : 0,
    )
    .run();
}

export async function getTrainer(db: DB, trainerId: number): Promise<TrainerDoc | null> {
  const r = await db.prepare("SELECT * FROM trainers WHERE trainerId = ?").bind(trainerId).first<Parameters<typeof toTrainer>[0]>();
  return r ? toTrainer(r) : null;
}

export async function getTrainerByCode(db: DB, code: string): Promise<TrainerDoc | null> {
  const r = await db
    .prepare("SELECT * FROM trainers WHERE inviteCode = ? AND status = 'approved'")
    .bind(code)
    .first<Parameters<typeof toTrainer>[0]>();
  return r ? toTrainer(r) : null;
}

export async function approveTrainer(db: DB, trainerId: number, inviteCode: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE trainers SET status='approved', inviteCode=?, approvedAt=? WHERE trainerId=?")
      .bind(inviteCode, nowIso(), trainerId),
    db.prepare("UPDATE users SET role='trainer', updatedAt=? WHERE id=?").bind(nowIso(), trainerId),
  ]);
}

export async function rejectTrainer(db: DB, trainerId: number): Promise<void> {
  await db.prepare("UPDATE trainers SET status='rejected' WHERE trainerId=?").bind(trainerId).run();
}

export async function updateTrainer(
  db: DB,
  trainerId: number,
  patch: Partial<TrainerProfileInput> & { accepting?: boolean; maxClients?: number | null; isInstructor?: boolean },
): Promise<void> {
  const { sets, vals } = buildUpdate(patch, {
    name: ["name"],
    bio: ["bio"],
    accepting: ["accepting", (v) => (v ? 1 : 0)],
    maxClients: ["maxClients"],
    isInstructor: ["isInstructor", (v) => (v ? 1 : 0)],
    specialization: ["specialization"],
    tags: ["tags", (v) => arrToCsv(v)],
    certifications: ["certifications"],
    experienceYears: ["experienceYears"],
    approach: ["approach"],
    priceOnline: ["priceOnline"],
    priceOffline: ["priceOffline"],
    currency: ["currency"],
    city: ["city"],
    contact: ["contact"],
    languages: ["languages", (v) => arrToCsv(v)],
    photoFileId: ["photoFileId"],
    profileComplete: ["profileComplete", (v) => (v ? 1 : 0)],
  });
  if (!sets.length) return;
  vals.push(trainerId);
  await db.prepare(`UPDATE trainers SET ${sets.join(", ")} WHERE trainerId = ?`).bind(...vals).run();
}

export async function listOpenTrainers(
  db: DB,
  opts: { tag?: string; lang?: string; limit?: number } = {},
): Promise<TrainerDoc[]> {
  const limit = opts.limit ?? 30;
  const where = ["status='approved'", "accepting=1", "profileComplete=1"];
  const binds: unknown[] = [];
  // Bounded LIKE on ",csv," avoids partial-code collisions between tag/language codes.
  if (opts.tag) {
    where.push("(',' || tags || ',') LIKE ?");
    binds.push(`%,${opts.tag},%`);
  }
  if (opts.lang) {
    where.push("(',' || languages || ',') LIKE ?");
    binds.push(`%,${opts.lang},%`);
  }
  binds.push(limit);
  const r = await db
    .prepare(
      `SELECT * FROM trainers WHERE ${where.join(" AND ")}
       ORDER BY (ratingCount > 0) DESC, (ratingSum * 1.0 / MAX(ratingCount, 1)) DESC, approvedAt DESC
       LIMIT ?`,
    )
    .bind(...binds)
    .all<Parameters<typeof toTrainer>[0]>();
  return (r.results ?? []).map(toTrainer);
}

// ---------- trainer reviews ----------

export async function addOrUpdateReview(
  db: DB,
  trainerId: number,
  clientId: number,
  rating: number,
  text?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO trainer_reviews (trainerId, clientId, rating, text, createdAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(trainerId, clientId) DO UPDATE SET
         rating=excluded.rating, text=excluded.text, createdAt=excluded.createdAt`,
    )
    .bind(trainerId, clientId, rating, text ?? null, nowIso())
    .run();
  // Recompute the denormalized aggregate from source rows (correct even on edits).
  const agg = await db
    .prepare("SELECT COALESCE(SUM(rating),0) AS s, COUNT(*) AS c FROM trainer_reviews WHERE trainerId = ?")
    .bind(trainerId)
    .first<{ s: number; c: number }>();
  await db
    .prepare("UPDATE trainers SET ratingSum = ?, ratingCount = ? WHERE trainerId = ?")
    .bind(agg?.s ?? 0, agg?.c ?? 0, trainerId)
    .run();
}

export async function listReviews(db: DB, trainerId: number, limit = 3): Promise<TrainerReviewDoc[]> {
  const r = await db
    .prepare("SELECT * FROM trainer_reviews WHERE trainerId = ? ORDER BY createdAt DESC LIMIT ?")
    .bind(trainerId, limit)
    .all<Parameters<typeof toReview>[0]>();
  return (r.results ?? []).map(toReview);
}

/** A client may review a trainer only if currently linked or previously accepted by them. */
export async function canReview(db: DB, trainerId: number, clientId: number): Promise<boolean> {
  const linked = await db
    .prepare("SELECT 1 AS x FROM users WHERE id = ? AND trainerId = ? LIMIT 1")
    .bind(clientId, trainerId)
    .first<{ x: number }>();
  if (linked) return true;
  const past = await db
    .prepare("SELECT 1 AS x FROM client_requests WHERE clientId = ? AND trainerId = ? AND status = 'accepted' LIMIT 1")
    .bind(clientId, trainerId)
    .first<{ x: number }>();
  return !!past;
}

export async function linkClient(db: DB, clientId: number, trainerId: number): Promise<void> {
  await db.prepare("UPDATE users SET role='client', trainerId=?, updatedAt=? WHERE id=?")
    .bind(trainerId, nowIso(), clientId).run();
}

export async function unlinkClient(db: DB, clientId: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE users SET role='solo', trainerId=NULL, updatedAt=? WHERE id=?").bind(nowIso(), clientId),
    db.prepare("UPDATE plans SET active=0 WHERE userId=? AND active=1").bind(clientId),
  ]);
}

export async function listClients(db: DB, trainerId: number): Promise<UserDoc[]> {
  const r = await db.prepare("SELECT * FROM users WHERE trainerId = ? AND role='client'").bind(trainerId).all<UserRow>();
  return (r.results ?? []).map(toUser);
}

export async function listTrainerUsers(db: DB): Promise<UserDoc[]> {
  const r = await db.prepare("SELECT * FROM users WHERE role='trainer'").all<UserRow>();
  return (r.results ?? []).map(toUser);
}

export async function countByRole(db: DB, role: Role): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = ?").bind(role).first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countClientsOf(db: DB, trainerId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role='client' AND trainerId = ?")
    .bind(trainerId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function pendingTrainerApplications(db: DB): Promise<{ trainerId: number; name: string }[]> {
  const r = await db
    .prepare("SELECT trainerId, name FROM trainers WHERE status='pending' ORDER BY createdAt")
    .all<{ trainerId: number; name: string }>();
  return r.results ?? [];
}

export async function countPendingClientRequests(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM client_requests WHERE status='pending'").first<{ c: number }>();
  return r?.c ?? 0;
}

export async function pendingRequestsAll(db: DB, limit = 20): Promise<ClientRequestDoc[]> {
  const r = await db
    .prepare("SELECT * FROM client_requests WHERE status='pending' ORDER BY createdAt DESC LIMIT ?")
    .bind(limit)
    .all<{ id: number; clientId: number; trainerId: number; note: string | null; status: string; createdAt: string }>();
  return (r.results ?? []).map((x) => ({
    id: x.id, clientId: x.clientId, trainerId: x.trainerId,
    note: x.note ?? undefined, status: x.status as ClientRequestDoc["status"], createdAt: new Date(x.createdAt),
  }));
}

/** A client only if they belong to this trainer (authorization). */
export async function getClientForTrainer(db: DB, trainerId: number, clientId: number): Promise<UserDoc | null> {
  const u = await getUser(db, clientId);
  return u && u.trainerId === trainerId && u.role === "client" ? u : null;
}

// --- client requests (pairing handshake) ---

function toRequest(r: {
  id: number; clientId: number; trainerId: number; note: string | null; status: string; createdAt: string;
}): ClientRequestDoc {
  return {
    id: r.id, clientId: r.clientId, trainerId: r.trainerId,
    note: r.note ?? undefined, status: r.status as ClientRequestDoc["status"], createdAt: new Date(r.createdAt),
  };
}

export async function createRequest(db: DB, clientId: number, trainerId: number, note?: string): Promise<number> {
  // Cancel any prior pending request from this client first.
  await db.prepare("UPDATE client_requests SET status='cancelled' WHERE clientId=? AND status='pending'").bind(clientId).run();
  const r = await db
    .prepare("INSERT INTO client_requests (clientId, trainerId, note, status, createdAt) VALUES (?, ?, ?, 'pending', ?)")
    .bind(clientId, trainerId, note ?? null, nowIso())
    .run();
  return Number(r.meta?.last_row_id ?? 0);
}

export async function getRequest(db: DB, id: number): Promise<ClientRequestDoc | null> {
  const r = await db.prepare("SELECT * FROM client_requests WHERE id = ?").bind(id).first<Parameters<typeof toRequest>[0]>();
  return r ? toRequest(r) : null;
}

export async function pendingRequestsForTrainer(db: DB, trainerId: number): Promise<ClientRequestDoc[]> {
  const r = await db
    .prepare("SELECT * FROM client_requests WHERE trainerId=? AND status='pending' ORDER BY createdAt")
    .bind(trainerId)
    .all<Parameters<typeof toRequest>[0]>();
  return (r.results ?? []).map(toRequest);
}

export async function pendingRequestForClient(db: DB, clientId: number): Promise<ClientRequestDoc | null> {
  const r = await db
    .prepare("SELECT * FROM client_requests WHERE clientId=? AND status='pending' ORDER BY createdAt DESC LIMIT 1")
    .bind(clientId)
    .first<Parameters<typeof toRequest>[0]>();
  return r ? toRequest(r) : null;
}

export async function setRequestStatus(db: DB, id: number, status: ClientRequestDoc["status"]): Promise<void> {
  await db.prepare("UPDATE client_requests SET status=? WHERE id=?").bind(status, id).run();
}

// --- client questions (AI-suggested reply flow) ---

function toQuestion(r: {
  id: number; clientId: number; trainerId: number; text: string; aiDraft: string | null; status: string; createdAt: string;
}): ClientQuestionDoc {
  return {
    id: r.id, clientId: r.clientId, trainerId: r.trainerId, text: r.text,
    aiDraft: r.aiDraft ?? undefined, status: r.status as ClientQuestionDoc["status"], createdAt: new Date(r.createdAt),
  };
}

export async function createQuestion(db: DB, clientId: number, trainerId: number, text: string, aiDraft?: string): Promise<number> {
  const r = await db
    .prepare("INSERT INTO client_questions (clientId, trainerId, text, aiDraft, status, createdAt) VALUES (?, ?, ?, ?, 'pending', ?)")
    .bind(clientId, trainerId, text, aiDraft ?? null, nowIso())
    .run();
  return Number(r.meta?.last_row_id ?? 0);
}

export async function getQuestion(db: DB, id: number): Promise<ClientQuestionDoc | null> {
  const r = await db.prepare("SELECT * FROM client_questions WHERE id = ?").bind(id).first<Parameters<typeof toQuestion>[0]>();
  return r ? toQuestion(r) : null;
}

export async function setQuestionStatus(db: DB, id: number, status: ClientQuestionDoc["status"]): Promise<void> {
  await db.prepare("UPDATE client_questions SET status=? WHERE id=?").bind(status, id).run();
}

export async function setQuestionDraft(db: DB, id: number, aiDraft: string): Promise<void> {
  await db.prepare("UPDATE client_questions SET aiDraft = ? WHERE id = ?").bind(aiDraft, id).run();
}

/** A trainer's question history (any status), newest first — the Q&A archive view. */
export async function listQuestionsForTrainer(db: DB, trainerId: number, limit = 20): Promise<ClientQuestionDoc[]> {
  const r = await db
    .prepare("SELECT * FROM client_questions WHERE trainerId = ? ORDER BY id DESC LIMIT ?")
    .bind(trainerId, limit)
    .all<Parameters<typeof toQuestion>[0]>();
  return (r.results ?? []).map(toQuestion);
}

export async function insertMessage(db: DB, fromId: number, toId: number, text: string): Promise<void> {
  await db.prepare("INSERT INTO messages (fromId, toId, text, createdAt) VALUES (?, ?, ?, ?)")
    .bind(fromId, toId, text, nowIso()).run();
}

// ---------- dedup / housekeeping ----------

export async function markUpdateSeen(db: DB, updateId: number): Promise<boolean> {
  try {
    const r = await db
      .prepare("INSERT OR IGNORE INTO seen_updates (id, createdAt) VALUES (?, ?)")
      .bind(updateId, nowIso())
      .run();
    return (r.meta?.changes ?? 0) > 0; // 0 changes → duplicate
  } catch (err) {
    console.error("markUpdateSeen error (processing anyway)", err);
    return true;
  }
}

export async function pruneSeenUpdates(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM seen_updates WHERE createdAt < ?").bind(beforeIso).run();
}

// Telemetry tables grow unbounded (every AI call / error / button tap writes a row); D1 free
// tier caps the DB at 5 GB. Weekly sweep drops rows older than the retention window.
export async function pruneOldLogs(db: DB, beforeIso: string, beforeDay: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM ai_call_logs WHERE ts < ?").bind(beforeIso),
    db.prepare("DELETE FROM error_logs WHERE ts < ?").bind(beforeIso),
    db.prepare("DELETE FROM ai_usage WHERE ts < ?").bind(beforeIso),
    db.prepare("DELETE FROM event_counts WHERE day < ?").bind(beforeDay),
  ]);
}

// ---------- delete / health ----------

export async function deleteUserData(db: DB, userId: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    db.prepare("DELETE FROM plans WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM workout_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM nutrition_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM strength_records WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM body_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM step_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM progress_photos WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM water_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM challenges WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM injuries WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM sessions WHERE trainerId = ? OR clientId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_notes WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_cards WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM daily_checkins WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM plan_adjustments WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM achievements WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM meal_plans WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM user_exercise_videos WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM event_counts WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM feedback WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM trainers WHERE trainerId = ?").bind(userId),
    db.prepare("DELETE FROM trainer_reviews WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_requests WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM client_questions WHERE clientId = ? OR trainerId = ?").bind(userId, userId),
    db.prepare("DELETE FROM messages WHERE fromId = ? OR toId = ?").bind(userId, userId),
    // Per-user telemetry — /deleteme means ALL personal rows, not just product data.
    // (admin_audit is intentionally kept: it's the owner's action trail, not user data.)
    db.prepare("DELETE FROM ai_usage WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM ai_call_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM error_logs WHERE userId = ?").bind(userId),
    db.prepare("DELETE FROM plan_source_logs WHERE userId = ?").bind(userId),
  ]);
}

// ---------- trainer program templates ----------

export interface TrainerTemplateMeta {
  id: number;
  name: string;
  createdAt: string;
}

export async function saveTrainerTemplate(db: DB, trainerId: number, name: string, plan: BankPlan): Promise<number> {
  const r = await db
    .prepare("INSERT INTO trainer_templates (trainerId, name, plan, createdAt) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(trainerId, name, JSON.stringify(plan), nowIso())
    .first<{ id: number }>();
  return r?.id ?? 0;
}

export async function listTrainerTemplates(db: DB, trainerId: number, limit = 20): Promise<TrainerTemplateMeta[]> {
  const r = await db
    .prepare("SELECT id, name, createdAt FROM trainer_templates WHERE trainerId = ? ORDER BY id DESC LIMIT ?")
    .bind(trainerId, limit)
    .all<TrainerTemplateMeta>();
  return r.results ?? [];
}

export async function getTrainerTemplate(db: DB, trainerId: number, id: number): Promise<{ name: string; plan: BankPlan } | null> {
  const r = await db
    .prepare("SELECT name, plan FROM trainer_templates WHERE id = ? AND trainerId = ?")
    .bind(id, trainerId)
    .first<{ name: string; plan: string }>();
  return r ? { name: r.name, plan: JSON.parse(r.plan) as BankPlan } : null;
}

export async function deleteTrainerTemplate(db: DB, trainerId: number, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM trainer_templates WHERE id = ? AND trainerId = ?").bind(id, trainerId).run();
  return (r.meta?.changes ?? 0) > 0;
}

// ---------- shared programs (share-a-program: link + public library) ----------

export async function createSharedProgram(db: DB, code: string, ownerId: number, name: string, plan: BankPlan, isPublic: boolean): Promise<void> {
  await db
    .prepare("INSERT INTO shared_programs (code, ownerId, name, plan, isPublic, takenCount, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .bind(code, ownerId, name, JSON.stringify(plan), isPublic ? 1 : 0, nowIso())
    .run();
}

export async function getSharedProgram(db: DB, code: string): Promise<{ code: string; ownerId: number; name: string; plan: BankPlan } | null> {
  const r = await db
    .prepare("SELECT code, ownerId, name, plan FROM shared_programs WHERE code = ?")
    .bind(code)
    .first<{ code: string; ownerId: number; name: string; plan: string }>();
  return r ? { code: r.code, ownerId: r.ownerId, name: r.name, plan: JSON.parse(r.plan) as BankPlan } : null;
}

export async function listPublicPrograms(db: DB, limit = 20): Promise<{ code: string; name: string; takenCount: number }[]> {
  const r = await db
    .prepare("SELECT code, name, takenCount FROM shared_programs WHERE isPublic = 1 ORDER BY takenCount DESC, createdAt DESC LIMIT ?")
    .bind(limit)
    .all<{ code: string; name: string; takenCount: number }>();
  return r.results ?? [];
}

export async function bumpSharedTaken(db: DB, code: string): Promise<void> {
  await db.prepare("UPDATE shared_programs SET takenCount = takenCount + 1 WHERE code = ?").bind(code).run();
}

// ---------- client billing (bookkeeping only — no payment processing) ----------

export interface ClientBilling {
  trainerId: number;
  clientId: number;
  paidUntil: string | null;
  sessionsLeft: number | null;
  nudgedAt: string | null;
}

export async function getClientBilling(db: DB, trainerId: number, clientId: number): Promise<ClientBilling | null> {
  const r = await db
    .prepare("SELECT trainerId, clientId, paidUntil, sessionsLeft, nudgedAt FROM client_billing WHERE trainerId = ? AND clientId = ?")
    .bind(trainerId, clientId)
    .first<ClientBilling>();
  return r ?? null;
}

/** Upsert one billing field; extending/refilling resets the nudge dedup so the next expiry nudges again. */
export async function setClientBilling(
  db: DB,
  trainerId: number,
  clientId: number,
  patch: { paidUntil?: string | null; sessionsLeft?: number | null },
): Promise<void> {
  const cur = await getClientBilling(db, trainerId, clientId);
  const paidUntil = patch.paidUntil !== undefined ? patch.paidUntil : (cur?.paidUntil ?? null);
  const sessionsLeft = patch.sessionsLeft !== undefined ? patch.sessionsLeft : (cur?.sessionsLeft ?? null);
  await db
    .prepare(
      `INSERT INTO client_billing (trainerId, clientId, paidUntil, sessionsLeft, nudgedAt, updatedAt) VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT(trainerId, clientId) DO UPDATE SET paidUntil = excluded.paidUntil, sessionsLeft = excluded.sessionsLeft, nudgedAt = NULL, updatedAt = excluded.updatedAt`,
    )
    .bind(trainerId, clientId, paidUntil, sessionsLeft, nowIso())
    .run();
}

/** Decrement the prepaid-session counter when a session is marked done (floors at 0). */
export async function decrementSessionsLeft(db: DB, trainerId: number, clientId: number): Promise<void> {
  await db
    .prepare("UPDATE client_billing SET sessionsLeft = sessionsLeft - 1, updatedAt = ? WHERE trainerId = ? AND clientId = ? AND sessionsLeft > 0")
    .bind(nowIso(), trainerId, clientId)
    .run();
}

/** Billing rows whose paid period expired or session package ran out, not yet nudged. */
export async function listBillingDue(db: DB, today: string): Promise<ClientBilling[]> {
  const r = await db
    .prepare(
      `SELECT trainerId, clientId, paidUntil, sessionsLeft, nudgedAt FROM client_billing
       WHERE nudgedAt IS NULL AND ((paidUntil IS NOT NULL AND paidUntil < ?) OR sessionsLeft = 0)`,
    )
    .bind(today)
    .all<ClientBilling>();
  return r.results ?? [];
}

export async function markBillingNudged(db: DB, trainerId: number, clientId: number, dateIso: string): Promise<void> {
  await db.prepare("UPDATE client_billing SET nudgedAt = ? WHERE trainerId = ? AND clientId = ?").bind(dateIso, trainerId, clientId).run();
}

/** All billing rows of one trainer — the finance summary view. */
export async function listBillingForTrainer(db: DB, trainerId: number): Promise<ClientBilling[]> {
  const r = await db
    .prepare("SELECT trainerId, clientId, paidUntil, sessionsLeft, nudgedAt FROM client_billing WHERE trainerId = ?")
    .bind(trainerId)
    .all<ClientBilling>();
  return r.results ?? [];
}

/** Sessions of this trainer marked done on/after `sinceDate` (finance summary). */
export async function countSessionsDoneSince(db: DB, trainerId: number, sinceDate: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM sessions WHERE trainerId = ? AND status = 'done' AND date >= ?")
    .bind(trainerId, sinceDate)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// ---------- AI response cache (identical prompts skip the provider chain) ----------

export async function getAiCache(db: DB, key: string): Promise<string | null> {
  const r = await db
    .prepare("SELECT response FROM ai_cache WHERE key = ? AND expiresAt > ?")
    .bind(key, nowIso())
    .first<{ response: string }>();
  return r?.response ?? null;
}

/** Prepared-statement builder so the orchestrator can piggyback the cache write onto its
 * one-batch telemetry flush (no extra round trip). */
export function aiCacheStmt(db: DB, key: string, response: string, ttlMs: number): D1PreparedStatement {
  return db
    .prepare("INSERT OR REPLACE INTO ai_cache (key, response, expiresAt) VALUES (?, ?, ?)")
    .bind(key, response, new Date(Date.now() + ttlMs).toISOString());
}

export async function pruneAiCache(db: DB): Promise<void> {
  await db.prepare("DELETE FROM ai_cache WHERE expiresAt <= ?").bind(nowIso()).run();
}

// ---------- rest timers (one pending nudge per user, delivered by the minute cron) ----------

export async function setRestTimer(db: DB, userId: number, chatId: number, dueAtIso: string, lang: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rest_timers (userId, chatId, dueAt, lang) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET chatId = excluded.chatId, dueAt = excluded.dueAt, lang = excluded.lang`,
    )
    .bind(userId, chatId, dueAtIso, lang)
    .run();
}

export async function dueRestTimers(db: DB, nowIso: string, limit = 20): Promise<{ userId: number; chatId: number; lang: string }[]> {
  const r = await db
    .prepare("SELECT userId, chatId, lang FROM rest_timers WHERE dueAt <= ? LIMIT ?")
    .bind(nowIso, limit)
    .all<{ userId: number; chatId: number; lang: string }>();
  return r.results ?? [];
}

export async function deleteRestTimers(db: DB, userIds: number[]): Promise<void> {
  if (!userIds.length) return;
  await db
    .prepare(`DELETE FROM rest_timers WHERE userId IN (${userIds.map(() => "?").join(",")})`)
    .bind(...userIds)
    .run();
}

// ---------- engagement: activity signal + usage counters ----------

export async function setLastSeen(db: DB, userId: number, iso: string): Promise<void> {
  await db.prepare("UPDATE users SET lastSeenAt = ? WHERE id = ?").bind(iso, userId).run();
}

export async function bumpEvent(db: DB, userId: number, event: string, day: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO event_counts (userId, event, day, n) VALUES (?, ?, ?, 1)
       ON CONFLICT(userId, event, day) DO UPDATE SET n = n + 1`,
    )
    .bind(userId, event, day)
    .run();
}

export async function eventStatsSince(db: DB, sinceDay: string, limit = 20): Promise<{ event: string; n: number }[]> {
  const r = await db
    .prepare("SELECT event, SUM(n) AS n FROM event_counts WHERE day >= ? GROUP BY event ORDER BY n DESC LIMIT ?")
    .bind(sinceDay, limit)
    .all<{ event: string; n: number }>();
  return r.results ?? [];
}

/** One user's all-time activity counts — feeds the XP/level math (domain/gamification). */
export async function userStatCounts(
  db: DB,
  userId: number,
): Promise<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number }> {
  const r = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM workout_logs WHERE userId = ?1 AND completed = 1) AS workouts,
        (SELECT COUNT(*) FROM nutrition_logs WHERE userId = ?1) AS nutrition,
        (SELECT COUNT(*) FROM daily_checkins WHERE userId = ?1) AS checkins,
        (SELECT COUNT(*) FROM step_logs WHERE userId = ?1) AS steps,
        (SELECT COUNT(*) FROM achievements WHERE userId = ?1) AS badges`,
    )
    .bind(userId)
    .first<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number }>();
  return r ?? { workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 };
}

/** Distinct active users per day (from usage counters) — owner dashboard DAU chart. */
export async function dailyActiveUsers(db: DB, sinceDay: string): Promise<{ date: string; n: number }[]> {
  const r = await db
    .prepare("SELECT day AS date, COUNT(DISTINCT userId) AS n FROM event_counts WHERE day >= ? GROUP BY day ORDER BY day ASC")
    .bind(sinceDay)
    .all<{ date: string; n: number }>();
  return r.results ?? [];
}

/** One user's recent usage counters, newest first — owner per-user event timeline. */
export async function recentEventsForUser(db: DB, userId: number, limit = 30): Promise<{ event: string; day: string; n: number }[]> {
  const r = await db
    .prepare("SELECT event, day, n FROM event_counts WHERE userId = ? ORDER BY day DESC, n DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ event: string; day: string; n: number }>();
  return r.results ?? [];
}

// ---------- vacation / pause mode ----------

export async function setVacation(db: DB, userId: number, untilIso: string): Promise<void> {
  await db.prepare("UPDATE users SET vacationUntil = ?, updatedAt = ? WHERE id = ?").bind(untilIso, nowIso(), userId).run();
}

export async function clearVacation(db: DB, userId: number): Promise<void> {
  await db.prepare("UPDATE users SET vacationUntil = NULL, updatedAt = ? WHERE id = ?").bind(nowIso(), userId).run();
}

export async function markComebackDone(db: DB, userId: number, iso: string): Promise<void> {
  await db.prepare("UPDATE users SET comebackDone = ? WHERE id = ?").bind(iso, userId).run();
}

// Users whose vacation just ended and who haven't been welcomed back yet.
export async function listVacationEnded(db: DB, nowIsoStr: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `SELECT * FROM users
       WHERE vacationUntil IS NOT NULL AND vacationUntil <= ?
         AND (comebackDone IS NULL OR comebackDone < vacationUntil)
         AND blocked = 0`,
    )
    .bind(nowIsoStr)
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

// ---------- inactivity (owner-confirmed cleanup ONLY — never auto) ----------

// Cleanup candidates: ANY user (no role/vacation/owner exclusions) who is either inactive
// (lastSeenAt — falling back to createdAt — older than the cutoff) OR has explicitly replied
// "leaving" (shown even if they just tapped, since any tap bumps lastSeenAt). Blocked (owner-banned)
// users are handled by their own ban flow and stay out. (_now kept for signature stability.)
export async function listInactive(db: DB, cutoffIso: string, _now: string, limit = 50): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `SELECT * FROM users
       WHERE blocked = 0
         AND (COALESCE(lastSeenAt, createdAt) < ? OR inactiveReply = 'leaving')
       ORDER BY (inactiveReply = 'leaving') DESC, COALESCE(lastSeenAt, createdAt) ASC
       LIMIT ?`,
    )
    .bind(cutoffIso, limit)
    .all<UserRow>();
  return (r.results ?? []).map(toUser);
}

export async function countInactive(db: DB, cutoffIso: string, _now: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE blocked = 0 AND COALESCE(lastSeenAt, createdAt) < ?")
    .bind(cutoffIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Reset the inactivity-ask state (user tapped "I'm still here") so a future lull can re-ask.
export async function clearInactiveAsk(db: DB, userId: number): Promise<void> {
  await db.prepare("UPDATE users SET inactiveAskedAt = NULL, inactiveReply = NULL WHERE id = ?").bind(userId).run();
}

export async function pingDb(db: DB): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return r?.ok === 1;
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

// ── Settings (key-value store for one-time flags / scheduled tasks) ───────────
export async function getSetting(db: DB, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSetting(db: DB, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function deleteSetting(db: DB, key: string): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
}

// Cron mutual-exclusion: the scheduled handler runs in waitUntil (detached), so a heavy run can
// outlive its minute and the next cron starts a SECOND concurrent run → both read the same
// un-flushed reminder dedup and send the SAME message twice (the "identical messages" spam).
// A fresh lock (< ttl) means another run is active → skip this tick. Stale lock (crashed run) expires.
export async function acquireScheduleLock(db: DB, nowMs: number, ttlMs: number): Promise<boolean> {
  const cur = await getSetting(db, "schedule_lock");
  const ts = cur ? Number(cur) : 0;
  if (ts && nowMs - ts < ttlMs) return false;
  await setSetting(db, "schedule_lock", String(nowMs));
  return true;
}

export async function releaseScheduleLock(db: DB): Promise<void> {
  await setSetting(db, "schedule_lock", "0");
}

// ---------------- progress photos (Mini App gallery; bytes proxied via /api/photo) ----------------

export interface ProgressPhotoRow { id: number; userId: number; fileId: string; takenAt: string }

export async function addProgressPhoto(db: DB, userId: number, fileId: string): Promise<void> {
  await db.prepare("INSERT INTO progress_photos (userId, fileId, takenAt) VALUES (?, ?, ?)").bind(userId, fileId, nowIso()).run();
}

export async function listProgressPhotos(db: DB, userId: number, limit = 24): Promise<ProgressPhotoRow[]> {
  const r = await db
    .prepare("SELECT id, userId, fileId, takenAt FROM progress_photos WHERE userId = ? ORDER BY takenAt DESC LIMIT ?")
    .bind(userId, limit)
    .all<ProgressPhotoRow>();
  return r.results ?? [];
}

export async function getProgressPhoto(db: DB, id: number): Promise<ProgressPhotoRow | null> {
  return (await db.prepare("SELECT id, userId, fileId, takenAt FROM progress_photos WHERE id = ?").bind(id).first<ProgressPhotoRow>()) ?? null;
}

/** Dashboard extras in ONE D1 roundtrip (db.batch): all-time stat counts, earned badge codes,
 * today's water total and steps. Four separate queries collapsed on the hot /api/dashboard
 * path — same rows read, one network round-trip and three fewer subrequests. */
export async function dashboardExtrasBatch(
  db: DB,
  userId: number,
  today: string,
): Promise<{
  statCounts: { workouts: number; nutrition: number; checkins: number; steps: number; badges: number };
  achievements: string[];
  waterMl: number;
  steps: number;
}> {
  const [counts, ach, water, step] = await db.batch([
    db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM workout_logs WHERE userId = ?1 AND completed = 1) AS workouts,
          (SELECT COUNT(*) FROM nutrition_logs WHERE userId = ?1) AS nutrition,
          (SELECT COUNT(*) FROM daily_checkins WHERE userId = ?1) AS checkins,
          (SELECT COUNT(*) FROM step_logs WHERE userId = ?1) AS steps,
          (SELECT COUNT(*) FROM achievements WHERE userId = ?1) AS badges`,
      )
      .bind(userId),
    db.prepare("SELECT code FROM achievements WHERE userId = ? ORDER BY earnedAt ASC").bind(userId),
    db.prepare("SELECT ml FROM water_logs WHERE userId = ? AND date = ?").bind(userId, today),
    db.prepare("SELECT steps FROM step_logs WHERE userId = ? AND date = ?").bind(userId, today),
  ]);
  const c = (counts.results?.[0] ?? {}) as Partial<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number }>;
  return {
    statCounts: {
      workouts: c.workouts ?? 0,
      nutrition: c.nutrition ?? 0,
      checkins: c.checkins ?? 0,
      steps: c.steps ?? 0,
      badges: c.badges ?? 0,
    },
    achievements: ((ach.results ?? []) as { code: string }[]).map((x) => x.code),
    waterMl: ((water.results?.[0] as { ml?: number } | undefined)?.ml) ?? 0,
    steps: ((step.results?.[0] as { steps?: number } | undefined)?.steps) ?? 0,
  };
}
