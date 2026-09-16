// v2-native user-core/preferences/onboarding repo (Domain 1 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of src/db/repos/users.ts: same
// exported names/signatures (so a call site switches by changing one import), same filters,
// same ordering, same edge cases — but reads/writes ONLY v2_accounts/v2_profiles/v2_preferences/
// v2_onboarding (joined as needed; v2_trainer_relationships too, for UserDoc.trainerId, since
// that edge has no other home in the v2 schema — see migrations/0069_v2_core.sql).
//
// Schema note (migrations/0073_v2_users_complete.sql): v2_profiles.profile and
// v2_onboarding.session are the v2-native full-fidelity JSON blobs (mirroring legacy
// users.profile / users.session exactly) — NOT the same columns the existing shadow-parity
// projector (src/adapters/d1/v2Projection.ts's projectUserCore) writes into v2_profiles'
// extracted columns (name/timezone/sex/...) or v2_onboarding.step/answers. Those stay owned by
// the projector for other, not-yet-migrated domains' parity/dashboard reads; this module never
// reads or writes them.
import type {
  Lang,
  NutritionTargets,
  ProgressionRate,
  Role,
  UserDoc,
  UserProfile,
  UserReminders,
} from "../../types";
import { normalizeLang } from "../../locales/i18n";
import { buildUpdate, nowIso, safeJsonParse, type DB } from "../../db/repos/shared";

export interface V2UserRow {
  id: number;
  chatId: number;
  username: string | null;
  role: string | null;
  blocked: number | null;
  botBlocked: number | null;
  flagged: number | null;
  progressionRate: string | null;
  lastSeenAt: string | null;
  doWokenAt: string | null;
  vacationUntil: string | null;
  comebackDone: string | null;
  inactiveAskedAt: string | null;
  inactiveReply: string | null;
  createdAt: string;
  updatedAt: string;
  lang: string | null;
  profile: string | null;
  nutrition: string | null;
  competeOptIn: number | null;
  alias: string | null;
  userReminders: string | null;
  session: string | null;
  onboardingStatus: string | null;
  trainerId: number | null;
}

// One SELECT shape shared by every reader below. accountId is the join key everywhere (it IS
// the telegram user id — v2_accounts.id, set equal to legacyUserId at creation, see
// getOrCreateUser/projectUserCore). trainerId is a correlated scalar subquery rather than a
// JOIN so a client with more than one historical (non-active) v2_trainer_relationships row can
// never fan out these results — legacy has exactly one trainerId per user, this preserves that.
const SELECT_USER = `
  SELECT
    a.id AS id, a.chatId AS chatId, a.username AS username, a.role AS role,
    a.blocked AS blocked, a.botBlocked AS botBlocked, a.flagged AS flagged,
    a.progressionRate AS progressionRate, a.lastSeenAt AS lastSeenAt, a.doWokenAt AS doWokenAt,
    a.vacationUntil AS vacationUntil, a.comebackDone AS comebackDone,
    a.inactiveAskedAt AS inactiveAskedAt, a.inactiveReply AS inactiveReply,
    a.createdAt AS createdAt, a.updatedAt AS updatedAt,
    p.lang AS lang, p.profile AS profile, p.nutrition AS nutrition,
    pr.competeOptIn AS competeOptIn, pr.alias AS alias, pr.userReminders AS userReminders,
    o.session AS session, o.status AS onboardingStatus,
    (SELECT trainerId FROM v2_trainer_relationships WHERE clientId = a.id AND status = 'active' LIMIT 1) AS trainerId
  FROM v2_accounts a
  LEFT JOIN v2_profiles p ON p.accountId = a.id
  LEFT JOIN v2_preferences pr ON pr.accountId = a.id
  LEFT JOIN v2_onboarding o ON o.accountId = a.id
`;

export function toUser(r: V2UserRow): UserDoc {
  return {
    _id: r.id,
    chatId: r.chatId,
    username: r.username ?? undefined,
    // Coerced, not cast — same reasoning as legacy toUser() (src/db/repos/users.ts).
    lang: normalizeLang(r.lang),
    onboarded: r.onboardingStatus === "completed",
    role: (r.role as Role) ?? "solo",
    trainerId: r.trainerId ?? undefined,
    competeOptIn: !!r.competeOptIn,
    alias: r.alias ?? undefined,
    // Defensive parse, same reasoning as legacy: one malformed row must not abort the whole
    // batch a cron sweep's .map(toUser) runs.
    profile: safeJsonParse(r.profile, {} as UserProfile),
    nutrition: r.nutrition ? safeJsonParse<NutritionTargets | undefined>(r.nutrition, undefined) : undefined,
    session: safeJsonParse(r.session, { mode: "idle" as const }),
    reminders: r.userReminders ? safeJsonParse<UserReminders | undefined>(r.userReminders, undefined) : undefined,
    progressionRate: (r.progressionRate as ProgressionRate) ?? "normal",
    blocked: !!r.blocked,
    botBlocked: !!r.botBlocked,
    flagged: !!r.flagged,
    lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt) : undefined,
    doWokenAt: r.doWokenAt ? new Date(r.doWokenAt) : undefined,
    vacationUntil: r.vacationUntil ? new Date(r.vacationUntil) : undefined,
    comebackDone: r.comebackDone ? new Date(r.comebackDone) : undefined,
    inactiveAskedAt: r.inactiveAskedAt ? new Date(r.inactiveAskedAt) : undefined,
    inactiveReply: r.inactiveReply ?? undefined,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

export async function getUser(db: DB, userId: number): Promise<UserDoc | null> {
  const r = await db.prepare(`${SELECT_USER} WHERE a.id = ?`).bind(userId).first<V2UserRow>();
  return r ? toUser(r) : null;
}

/** Batched user fetch — one `WHERE id IN (...)` instead of N `getUser` calls in a loop.
 * Returns a Map keyed by user id (missing ids simply absent). */
export async function getUsersByIds(db: DB, ids: number[]): Promise<Map<number, UserDoc>> {
  const out = new Map<number, UserDoc>();
  const uniq = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (!uniq.length) return out;
  const placeholders = uniq.map(() => "?").join(",");
  const r = await db.prepare(`${SELECT_USER} WHERE a.id IN (${placeholders})`).bind(...uniq).all<V2UserRow>();
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
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt)
       VALUES (?, ?, ?, 'solo', 'active', ?, ?)`,
    ).bind(userId, userId, chatId, now, now),
    db.prepare(
      `INSERT OR IGNORE INTO v2_profiles (accountId, lang, profile, updatedAt) VALUES (?, ?, ?, ?)`,
    ).bind(userId, lang, profile, now),
    db.prepare(
      `INSERT OR IGNORE INTO v2_preferences (accountId, lang, updatedAt) VALUES (?, ?, ?)`,
    ).bind(userId, lang, now),
    db.prepare(
      `INSERT OR IGNORE INTO v2_onboarding (accountId, status, sessionMode, updatedAt) VALUES (?, 'in_progress', 'idle', ?)`,
    ).bind(userId, now),
  ]);
  return (await getUser(db, userId))!;
}

export async function updateUser(
  db: DB,
  userId: number,
  patch: Partial<Omit<UserDoc, "_id">>,
): Promise<void> {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];

  const accounts = buildUpdate(patch, {
    chatId: ["chatId"],
    username: ["username"],
    role: ["role"],
    blocked: ["blocked", (v) => (v ? 1 : 0)],
    botBlocked: ["botBlocked", (v) => (v ? 1 : 0)],
    progressionRate: ["progressionRate"],
    lastSeenAt: ["lastSeenAt", (v) => (v as Date).toISOString()],
    doWokenAt: ["doWokenAt", (v) => (v as Date).toISOString()],
    vacationUntil: ["vacationUntil", (v) => (v as Date).toISOString()],
    comebackDone: ["comebackDone", (v) => (v as Date).toISOString()],
    inactiveAskedAt: ["inactiveAskedAt", (v) => (v as Date).toISOString()],
    inactiveReply: ["inactiveReply"],
  });
  // v2_accounts.updatedAt is the single field getUser()/toUser() reads back as UserDoc.updatedAt
  // — bumped on EVERY call, mirroring legacy's one-row-one-updatedAt semantics, even when the
  // patch only touches a field that lives on another v2 table (profile/session/preferences).
  // listPlanPendingUsers/listOnboardingOwedReply key their staleness check off exactly this.
  accounts.sets.push("updatedAt = ?");
  accounts.vals.push(now, userId);
  statements.push(db.prepare(`UPDATE v2_accounts SET ${accounts.sets.join(", ")} WHERE id = ?`).bind(...accounts.vals));

  const profiles = buildUpdate(patch, {
    lang: ["lang"],
    profile: ["profile", (v) => JSON.stringify(v)],
    nutrition: ["nutrition", (v) => JSON.stringify(v)],
  });
  // Dual-write profile.referredBy/buddyId into indexed columns, same fix/reason as legacy
  // 0056/0057 — see migrations/0073_v2_users_complete.sql.
  if (patch.profile !== undefined) {
    profiles.sets.push("referredBy = ?", "buddyId = ?");
    profiles.vals.push(patch.profile.referredBy ?? null, patch.profile.buddyId ?? null);
  }
  if (profiles.sets.length) {
    profiles.sets.push("updatedAt = ?");
    profiles.vals.push(now, userId);
    statements.push(db.prepare(`UPDATE v2_profiles SET ${profiles.sets.join(", ")} WHERE accountId = ?`).bind(...profiles.vals));
  }

  const onboarding = buildUpdate(patch, {
    session: ["session", (v) => JSON.stringify(v)],
    onboarded: ["status", (v) => (v ? "completed" : "in_progress")],
  });
  // Dual-write session.mode/retryAfter into indexed columns so the every-minute scheduler
  // sweeps stay index-backed — same fix/reason as legacy 0037.
  if (patch.session !== undefined) {
    onboarding.sets.push("sessionMode = ?", "sessionRetryAfter = ?");
    onboarding.vals.push(patch.session.mode, patch.session.retryAfter ?? null);
  }
  if (onboarding.sets.length) {
    onboarding.sets.push("updatedAt = ?");
    onboarding.vals.push(now, userId);
    statements.push(db.prepare(`UPDATE v2_onboarding SET ${onboarding.sets.join(", ")} WHERE accountId = ?`).bind(...onboarding.vals));
  }

  const preferences = buildUpdate(patch, {
    competeOptIn: ["competeOptIn", (v) => (v ? 1 : 0)],
    alias: ["alias"],
    reminders: ["userReminders", (v) => JSON.stringify(v)],
  });
  if (preferences.sets.length) {
    preferences.sets.push("updatedAt = ?");
    preferences.vals.push(now, userId);
    statements.push(db.prepare(`UPDATE v2_preferences SET ${preferences.sets.join(", ")} WHERE accountId = ?`).bind(...preferences.vals));
  }

  // trainerId has no dedicated column (see SELECT_USER) — it's the single active edge in
  // v2_trainer_relationships, same delete-then-insert pattern projectUserCore already uses.
  // Legacy updateUser has no consent concept either (plain users.trainerId column), so this
  // stores an empty consent blob rather than guessing at profile.shareWithTrainer, which may
  // not even be part of this same patch.
  if (patch.trainerId !== undefined) {
    statements.push(db.prepare("DELETE FROM v2_trainer_relationships WHERE clientId = ?").bind(userId));
    if (patch.trainerId) {
      statements.push(
        db.prepare(
          `INSERT INTO v2_trainer_relationships (clientId, trainerId, status, consent, createdAt, updatedAt)
           VALUES (?, ?, 'active', '{}', ?, ?)
           ON CONFLICT(clientId, trainerId) DO UPDATE SET status = 'active', updatedAt = excluded.updatedAt`,
        ).bind(userId, patch.trainerId, now, now),
      );
    }
  }

  await db.batch(statements);
}

export async function listOnboardedUsers(db: DB): Promise<UserDoc[]> {
  const r = await db.prepare(`${SELECT_USER} WHERE o.status = 'completed'`).all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

// The four every-minute recovery sweeps below filter on the indexed v2_onboarding.sessionMode /
// sessionRetryAfter columns (dual-written by updateUser, backfilled by 0073) instead of
// json_extract(session, ...) — same reasoning as legacy 0037.

export async function listRetryUsers(db: DB, now: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(`${SELECT_USER} WHERE o.sessionRetryAfter IS NOT NULL AND o.sessionRetryAfter <= ?`)
    .bind(now)
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Cheap one-row gate for the every-minute onboarding-recovery sweeps — see legacy
 * pendingRecoveryCount for the full reasoning; same query shape, v2_onboarding-native. */
export async function pendingRecoveryCount(db: DB): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM v2_onboarding
       WHERE status != 'completed' AND (sessionRetryAfter IS NOT NULL OR sessionMode IN ('onboarding','plan_pending'))`,
    )
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Users whose interview finished but whose plan generation hasn't landed yet. */
export async function listPlanPendingUsers(db: DB, before: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(`${SELECT_USER} WHERE o.status != 'completed' AND o.sessionMode = 'plan_pending' AND a.updatedAt < ?`)
    .bind(before)
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

/** All users still in the onboarding interview (for the owner status/failure report). */
export async function listOnboardingUsers(db: DB): Promise<UserDoc[]> {
  const r = await db
    .prepare(`${SELECT_USER} WHERE o.status != 'completed' AND o.sessionMode = 'onboarding' ORDER BY a.updatedAt DESC`)
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

// Everyone who hasn't finished onboarding and is still reachable.
export async function listIncompleteOnboarding(db: DB): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `${SELECT_USER} WHERE o.status != 'completed'
       AND (a.botBlocked IS NULL OR a.botBlocked = 0) AND (a.blocked IS NULL OR a.blocked = 0)
       ORDER BY a.updatedAt DESC`,
    )
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Onboarding users the bot OWES a reply but never sent one. */
export async function listOnboardingOwedReply(db: DB, before: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `${SELECT_USER} WHERE o.status != 'completed'
       AND o.sessionMode = 'onboarding'
       AND o.sessionRetryAfter IS NULL
       AND a.updatedAt < ?`,
    )
    .bind(before)
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Users stuck in onboarding with no pending retryAfter — awaiting a human reply. */
export async function listStuckOnboardingUsers(db: DB, today: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `${SELECT_USER} WHERE o.status != 'completed'
       AND o.sessionMode = 'onboarding'
       AND o.sessionRetryAfter IS NULL
       AND (json_extract(pr.userReminders,'$.lastNudge') IS NULL OR json_extract(pr.userReminders,'$.lastNudge') != ?)`,
    )
    .bind(today)
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

/** Non-onboarded users grouped by their current session mode — the owner funnel view. */
export async function nonOnboardedByMode(db: DB): Promise<{ mode: string; n: number }[]> {
  const r = await db
    .prepare(
      "SELECT COALESCE(sessionMode, '?') AS mode, COUNT(*) AS n FROM v2_onboarding WHERE status != 'completed' GROUP BY sessionMode ORDER BY n DESC",
    )
    .all<{ mode: string; n: number }>();
  return r.results ?? [];
}

export async function countUsers(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_accounts").first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countOnboarded(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_onboarding WHERE status = 'completed'").first<{ c: number }>();
  return r?.c ?? 0;
}

/** Cohort anchor for retention_d1/d7/d30 — COALESCE so a stray second call never overwrites the
 * real first timestamp. Same reasoning as legacy stampOnboardedAt. */
export async function stampOnboardedAt(db: DB, userId: number): Promise<void> {
  await db.prepare("UPDATE v2_onboarding SET onboardedAt = COALESCE(onboardedAt, ?) WHERE accountId = ?").bind(nowIso(), userId).run();
}

/** userId -> local onboarding date (YYYY-MM-DD, UTC-sliced) for everyone onboarded that day. */
export async function usersOnboardedOn(db: DB, date: string): Promise<number[]> {
  const r = await db
    .prepare("SELECT accountId AS id FROM v2_onboarding WHERE onboardedAt IS NOT NULL AND substr(onboardedAt, 1, 10) = ?")
    .bind(date)
    .all<{ id: number }>();
  return (r.results ?? []).map((row) => row.id);
}

/** Which of `userIds` have `lastSeenAt` on exactly `date` (local slice). */
export async function usersSeenOn(db: DB, date: string, userIds: number[]): Promise<Set<number>> {
  if (!userIds.length) return new Set();
  const placeholders = userIds.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT id FROM v2_accounts WHERE substr(lastSeenAt, 1, 10) = ? AND id IN (${placeholders})`)
    .bind(date, ...userIds)
    .all<{ id: number }>();
  return new Set((r.results ?? []).map((row) => row.id));
}

/** Moderation counts for the owner report. */
export async function countModeration(db: DB): Promise<{ blocked: number; botBlocked: number }> {
  const r = await db
    .prepare("SELECT SUM(blocked) AS b, SUM(botBlocked) AS bb FROM v2_accounts")
    .first<{ b: number | null; bb: number | null }>();
  return { blocked: r?.b ?? 0, botBlocked: r?.bb ?? 0 };
}

/** New signups since `sinceIso` (by createdAt). */
export async function countUsersCreatedSince(db: DB, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_accounts WHERE createdAt >= ?")
    .bind(sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Bounded variant for a single rollup day (daily_metrics `new_users`).
export async function countCreatedBetween(db: DB, fromIso: string, toExclusiveIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_accounts WHERE createdAt >= ? AND createdAt < ?")
    .bind(fromIso, toExclusiveIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countActiveSince(db: DB, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_accounts WHERE updatedAt >= ?")
    .bind(sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Users last active in [fromIso, toExclusiveIso) — for the churn window.
export async function countActiveBetween(db: DB, fromIso: string, toExclusiveIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_accounts WHERE updatedAt >= ? AND updatedAt < ?")
    .bind(fromIso, toExclusiveIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Onboarded users who were active in the prior week but went silent this week (churn risk).
export async function listChurnedUsers(db: DB, priorFromIso: string, thisWeekIso: string): Promise<{ id: number; name: string }[]> {
  const r = await db
    .prepare(
      `SELECT a.id AS id, p.profile AS profile
       FROM v2_accounts a
       LEFT JOIN v2_profiles p ON p.accountId = a.id
       LEFT JOIN v2_onboarding o ON o.accountId = a.id
       WHERE o.status = 'completed' AND a.blocked = 0 AND a.botBlocked = 0
         AND a.updatedAt >= ? AND a.updatedAt < ?`,
    )
    .bind(priorFromIso, thisWeekIso)
    .all<{ id: number; profile: string | null }>();
  return (r.results ?? []).map((x) => {
    let name = "";
    try { name = (JSON.parse(x.profile ?? "{}") as UserProfile).name || ""; } catch { /* ignore */ }
    return { id: x.id, name };
  });
}

// ---------- vacation / pause mode ----------

export async function setVacation(db: DB, userId: number, untilIso: string): Promise<void> {
  await db.prepare("UPDATE v2_accounts SET vacationUntil = ?, updatedAt = ? WHERE id = ?").bind(untilIso, nowIso(), userId).run();
}

export async function clearVacation(db: DB, userId: number): Promise<void> {
  await db.prepare("UPDATE v2_accounts SET vacationUntil = NULL, updatedAt = ? WHERE id = ?").bind(nowIso(), userId).run();
}

export async function markComebackDone(db: DB, userId: number, iso: string): Promise<void> {
  await db.prepare("UPDATE v2_accounts SET comebackDone = ? WHERE id = ?").bind(iso, userId).run();
}

// Users whose vacation just ended and who haven't been welcomed back yet.
export async function listVacationEnded(db: DB, nowIsoStr: string): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `${SELECT_USER} WHERE a.vacationUntil IS NOT NULL AND a.vacationUntil <= ?
       AND (a.comebackDone IS NULL OR a.comebackDone < a.vacationUntil)
       AND a.blocked = 0`,
    )
    .bind(nowIsoStr)
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

// ---------- inactivity (owner-confirmed cleanup ONLY — never auto) ----------

export async function listInactive(db: DB, cutoffIso: string, _now: string, limit = 50): Promise<UserDoc[]> {
  const r = await db
    .prepare(
      `${SELECT_USER} WHERE a.blocked = 0
       AND (COALESCE(a.lastSeenAt, a.createdAt) < ? OR a.inactiveReply = 'leaving')
       ORDER BY (a.inactiveReply = 'leaving') DESC, COALESCE(a.lastSeenAt, a.createdAt) ASC
       LIMIT ?`,
    )
    .bind(cutoffIso, limit)
    .all<V2UserRow>();
  return (r.results ?? []).map(toUser);
}

export async function countInactive(db: DB, cutoffIso: string, _now: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_accounts WHERE blocked = 0 AND COALESCE(lastSeenAt, createdAt) < ?")
    .bind(cutoffIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Reset the inactivity-ask state (user tapped "I'm still here") so a future lull can re-ask.
export async function clearInactiveAsk(db: DB, userId: number): Promise<void> {
  await db.prepare("UPDATE v2_accounts SET inactiveAskedAt = NULL, inactiveReply = NULL WHERE id = ?").bind(userId).run();
}
