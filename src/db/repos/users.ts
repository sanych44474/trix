// User identity: row mapping, lookup, profile/session updates, and the onboarding-recovery
// sweeps the every-minute cron runs. Split out of repos.ts (god-file split, same barrel seam —
// `../db/repos` still re-exports everything here); behavior unchanged.
import type { Lang, NutritionTargets, ProgressionRate, Role, UserDoc, UserProfile } from "../../types";
import { normalizeLang } from "../../locales/i18n";
import { buildUpdate, nowIso, type DB } from "./shared";

export interface UserRow {
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

export function toUser(r: UserRow): UserDoc {
  return {
    _id: r.id,
    chatId: r.chatId,
    username: r.username ?? undefined,
    // Coerced, not cast: a row written before a locale was retired must not reach t().
    lang: normalizeLang(r.lang),
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
