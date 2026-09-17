// v2-native buddy/achievements/challenges/leaderboard/squads repo (Domain 8 of the v2 cutover —
// see docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of:
//   - the buddy/achievements/leaderboard-adjacent exports of src/db/repos/workouts.ts
//     (awardAchievement, listAchievements, friendIds, allBuddyPairs, recordBuddyDuel,
//     buddyWinCount, buddyDuelHistory, listCompetitors, competitorWorkoutDates,
//     competitorStrength, competitorBodyweights) — that file's OTHER exports (upsertStrengthRecord/
//     listStrength/PrResult/BestSet and the workout_logs CRUD) are pure workout-logging/PR
//     bookkeeping, Domain 4's scope; they were ported to src/adapters/d1/v2Workouts.ts instead —
//     see that file's own header comment, which lists this domain's exports as deliberately out
//     of its scope, confirming the split.
//   - the "---------- challenges ----------" section of src/db/repos/tracking.ts (joinChallenge/
//     ChallengeRow/activeChallenges/activeChallengeCodes/markChallengeDone/countCompletedChallenges)
//     — flagged as out of scope by src/adapters/d1/v2Tracking.ts's own header comment for the same
//     reason (challenges are gamification, not body/activity tracking).
//   - all 13 exports of src/db/repos/squads.ts (squads are fully this domain's scope).
// Same exported names/signatures throughout, so a call site switches by changing one import; same
// filters/ordering/edge cases — reads/writes v2_achievements, v2_challenges, v2_squads,
// v2_squad_members, v2_workout_sessions, v2_strength_records, v2_measurements, v2_profiles,
// v2_preferences, v2_accounts, and the new v2_buddy_duels (migrations/0080_v2_gamification_complete.sql,
// which also gave v2_squads its missing title/lastRecapWeek/doWokenAt columns — see that file's
// header comment for the full gap analysis).
//
// ---------- v2_buddies is deliberately NOT used here ----------
// migrations/0070_v2_long_tail.sql created v2_buddies (accountId, buddyAccountId, createdAt) and
// backfilled it once from legacy `users.buddyId`. It looked, at first glance, like the natural
// home for the buddy PAIRING edge (and the plan's task brief for this domain explicitly flags
// "v2_buddies (pairing is bidirectional)" as an analogous concern to v2_trainer_relationships).
// Investigating the actual write path found it is NOT: the only place a buddy pairing is ever
// SET is bot.ts's `/start buddy_<id>` deep-link handler, and that handler already calls
// v2Users.updateUser(db, id, { profile: { ...profile, buddyId } }) directly — Domain 1's code,
// already v2-native, already merged. v2Users.ts's updateUser dual-writes profile.buddyId into
// the indexed v2_profiles.buddyId column (mirroring legacy's users.buddyId dual-write, migration
// 0057) specifically so a mutuality self-join stays index-backed. v2_buddies has NO writer in the
// live v2-native call graph — only that one historical backfill. Two writers racing to keep a
// SEPARATE v2_buddies table in sync with v2_profiles.buddyId (which bot.ts's handler would still
// need to keep writing, since UserDoc.profile.buddyId is read directly by webapp/dashboard.ts —
// Domain 10, not yet migrated) would be a new correctness hazard this port must not introduce,
// and rebuilding bot.ts's pairing handler to write v2_buddies instead is a call-site redesign, not
// an import swap — out of scope for a repo-module port (same reasoning v2Trainer.ts's header
// comment gives for leaving v2Users.updateUser's own trainerId branch alone). Decision: this
// module reads the buddy edge from v2_profiles.buddyId (self-join, mirroring legacy's self-join
// on users.buddyId byte-for-byte, INCLUDING the same "stale one-sided link" edge case the legacy
// comment on allBuddyPairs already documents) and does not touch v2_buddies at all — same
// documented-and-left-alone treatment v2Tracking.ts gave v2_activity_days. Flagging this as the
// one genuine design ambiguity in this domain rather than silently guessing a bigger rewrite.
import type { ExerciseMetric, StrengthRecordDoc } from "../../types";
import { nowIso, type DB } from "../../db/repos/shared";

// ============================================================================
// Achievements
// ============================================================================

/** Insert a badge once; returns true if it was newly earned (for one-time celebration). */
export async function awardAchievement(db: DB, userId: number, code: string): Promise<boolean> {
  const r = await db
    .prepare("INSERT OR IGNORE INTO v2_achievements (accountId, code, earnedAt) VALUES (?, ?, ?)")
    .bind(userId, code, nowIso())
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function listAchievements(db: DB, userId: number): Promise<string[]> {
  const r = await db
    .prepare("SELECT code FROM v2_achievements WHERE accountId = ? ORDER BY earnedAt ASC")
    .bind(userId)
    .all<{ code: string }>();
  return (r.results ?? []).map((x) => x.code);
}

// ============================================================================
// Social graph: referrals + accountability-buddy pairs/duels
// ============================================================================

/** The user's friend graph, derived from referrals (bidirectional): the person who invited
 * them + everyone they invited. Used to scope leaderboards to a friend circle. referredBy is
 * dual-written into the indexed v2_profiles.referredBy column by v2Users.ts's updateUser (same
 * fix/reason as legacy 0056) precisely so this stays index-backed. */
export async function friendIds(db: DB, userId: number): Promise<number[]> {
  const [me, invitees] = await Promise.all([
    db.prepare("SELECT referredBy AS ref FROM v2_profiles WHERE accountId = ?").bind(userId).first<{ ref: number | null }>(),
    db.prepare("SELECT accountId AS id FROM v2_profiles WHERE referredBy = ?").bind(userId).all<{ id: number }>(),
  ]);
  const ids = new Set<number>();
  if (me?.ref) ids.add(Number(me.ref));
  for (const r of invitees.results ?? []) ids.add(r.id);
  ids.delete(userId);
  return [...ids];
}

/** How many people THIS user invited (one direction only) -- distinct from friendIds(), which
 * mixes "who invited me" and "who I invited" for leaderboard scoping. The invite feature needs
 * the one-directional count: "how many friends has your link brought in". */
export async function countReferrals(db: DB, userId: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM v2_profiles WHERE referredBy = ?").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Every mutually-paired accountability-buddy pair, each returned exactly once (userA is always
 * the smaller id) — feeds the weekly buddy-duel sweep. See this file's header comment for why
 * this reads v2_profiles.buddyId (not v2_buddies): it is the column v2Users.ts's updateUser
 * actually dual-writes, mirroring legacy's users.buddyId dual-write (0057) for the same
 * index-backed-scan reason. */
// Requires TRUE mutuality (p1.buddyId = p2.accountId AND p2.buddyId = p1.accountId), not just
// "someone has a buddyId" — same reasoning/edge-case as legacy: the pairing flow (bot.ts's
// `/start buddy_<id>` handler) has no guard against a user re-pairing with someone new while
// already paired, which can leave their OLD buddy's buddyId still pointing back at them (stale,
// one-sided). A naive `WHERE buddyId IS NOT NULL` scan would surface that stale half as if it
// were still a real pair; the self-join here only returns pairs where both sides currently agree.
export async function allBuddyPairs(db: DB): Promise<{ userA: number; userB: number }[]> {
  const r = await db
    .prepare(
      `SELECT p1.accountId AS userA, p2.accountId AS userB FROM v2_profiles p1
       JOIN v2_profiles p2 ON p1.buddyId = p2.accountId AND p2.buddyId = p1.accountId
       WHERE p1.accountId < p2.accountId`,
    )
    .all<{ userA: number; userB: number }>();
  return r.results ?? [];
}

/** Persist one week's buddy-duel result. Idempotent — the weekly sweep re-running for a week
 * it already processed (e.g. a retried cron tick) leaves the original result untouched rather
 * than double-counting or overwriting it. */
export async function recordBuddyDuel(
  db: DB,
  userA: number,
  userB: number,
  weekKey: string,
  aCount: number,
  bCount: number,
  winnerId: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_buddy_duels (userA, userB, weekKey, aCount, bCount, winnerId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userA, userB, weekKey) DO NOTHING`,
    )
    .bind(userA, userB, weekKey, aCount, bCount, winnerId, nowIso())
    .run();
}

/** Total duel weeks `userId` has won (all buddies, all-time — a user only ever has one buddy at
 * a time today, but this doesn't assume that). */
export async function buddyWinCount(db: DB, userId: number): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_buddy_duels WHERE winnerId = ?").bind(userId).first<{ c: number }>();
  return r?.c ?? 0;
}

/** A specific pair's duel history, most-recent week first — feeds currentWinStreak() and the
 * Mini App's buddy card. */
export async function buddyDuelHistory(
  db: DB,
  userA: number,
  userB: number,
  limit = 12,
): Promise<{ weekKey: string; aCount: number; bCount: number; winnerId: number | null }[]> {
  const r = await db
    .prepare("SELECT weekKey, aCount, bCount, winnerId FROM v2_buddy_duels WHERE userA = ? AND userB = ? ORDER BY weekKey DESC LIMIT ?")
    .bind(Math.min(userA, userB), Math.max(userA, userB), limit)
    .all<{ weekKey: string; aCount: number; bCount: number; winnerId: number | null }>();
  return r.results ?? [];
}

// ============================================================================
// Leaderboard: live-computed boards (v2-native equivalent of the legacy live computation)
// ============================================================================
// The leaderboards themselves (consistency/most-improved/relative-strength/total/streak/
// recent-PRs — src/domain/records.ts) are, and always have been, computed LIVE on every read from
// the raw rows below (src/features/gamification/boards.ts's computeBoards) — nothing in legacy
// ever wrote to a stored leaderboard table. v2_leaderboard_entries (migrations/0070) exists but
// has no writer anywhere in the app, legacy or v2 — it is not a projection target this port
// dropped, it is a table nobody has ever populated. Building a new scheduled rollup into it now
// would be a new feature (a stored-leaderboard architecture) nothing in the plan's brief or the
// existing call graph asks for, so this port preserves the exact live-computation architecture:
// same raw-row functions, same signatures, now reading v2-native tables.

export interface CompetitorRow {
  userId: number;
  lang: string;
  chatId: number;
  alias: string | null;
  profile: string;
}

/** All opted-in users with the fields needed to build/notify leaderboards. competeOptIn lives on
 * v2_preferences (Domain 1's v2Users.ts already reads/writes it there); profile/lang on
 * v2_profiles. */
export async function listCompetitors(db: DB): Promise<CompetitorRow[]> {
  const r = await db
    .prepare(
      `SELECT a.id AS userId, p.lang AS lang, a.chatId AS chatId, pr.alias AS alias, p.profile AS profile
       FROM v2_accounts a
       JOIN v2_preferences pr ON pr.accountId = a.id
       LEFT JOIN v2_profiles p ON p.accountId = a.id
       WHERE pr.competeOptIn = 1`,
    )
    .all<CompetitorRow>();
  return r.results ?? [];
}

/** All completed-workout dates for opted-in users (for consistency/streak/total boards).
 * v2_workout_sessions (Domain 4, migrations/0069) already carries `completed` — no blocker. */
export async function competitorWorkoutDates(db: DB): Promise<{ userId: number; date: string }[]> {
  const r = await db
    .prepare(
      `SELECT w.accountId AS userId, w.date AS date FROM v2_workout_sessions w
       JOIN v2_preferences pr ON pr.accountId = w.accountId
       WHERE pr.competeOptIn = 1 AND w.completed = 1`,
    )
    .all<{ userId: number; date: string }>();
  return r.results ?? [];
}

interface V2StrengthRow {
  accountId: number;
  exercise: string;
  bestWeight: number;
  bestReps: number;
  bestSeconds?: number;
  bestMeters?: number;
  metric?: string;
  history: string;
  updatedAt: string;
}

function toStrength(r: V2StrengthRow): StrengthRecordDoc {
  let history: StrengthRecordDoc["history"] = [];
  try { history = JSON.parse(r.history); } catch { history = []; }
  return {
    userId: r.accountId,
    exercise: r.exercise,
    bestWeight: r.bestWeight,
    bestReps: r.bestReps,
    bestSeconds: r.bestSeconds ?? 0,
    bestMeters: r.bestMeters ?? 0,
    metric: (r.metric as ExerciseMetric) ?? "reps",
    history,
    updatedAt: new Date(r.updatedAt),
  };
}

/** Strength records for opted-in users (for relative-strength / most-improved boards).
 * v2_strength_records exists since migrations/0079_v2_workouts_complete.sql (Domain 4, concurrent
 * with this domain) — that migration's own header comment names this function as deliberately
 * left for Domain 8 to port, which this does. */
export async function competitorStrength(db: DB): Promise<StrengthRecordDoc[]> {
  const r = await db
    .prepare(
      `SELECT s.* FROM v2_strength_records s
       JOIN v2_preferences pr ON pr.accountId = s.accountId
       WHERE pr.competeOptIn = 1`,
    )
    .all<V2StrengthRow>();
  return (r.results ?? []).map(toStrength);
}

/** Latest recorded bodyweight per opted-in user (for relative strength). v2_measurements
 * (Domain 6, migrations/0069/0076) already carries weight — no blocker. */
export async function competitorBodyweights(db: DB): Promise<Map<number, number>> {
  const r = await db
    .prepare(
      `SELECT b.accountId AS userId, b.weight AS weight, b.date AS date FROM v2_measurements b
       JOIN v2_preferences pr ON pr.accountId = b.accountId
       WHERE pr.competeOptIn = 1 AND b.weight IS NOT NULL ORDER BY b.date ASC`,
    )
    .all<{ userId: number; weight: number; date: string }>();
  const out = new Map<number, number>();
  for (const row of r.results ?? []) out.set(row.userId, row.weight); // ASC → last wins = latest
  return out;
}

// ============================================================================
// Challenges
// ============================================================================

export async function joinChallenge(db: DB, userId: number, code: string, startDate: string, endDate: string): Promise<void> {
  await db
    .prepare("INSERT INTO v2_challenges (accountId, code, startDate, endDate, joinedAt) VALUES (?, ?, ?, ?, ?)")
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
    .prepare(
      "SELECT id, accountId AS userId, code, startDate, endDate, completedAt FROM v2_challenges WHERE accountId = ? AND completedAt IS NULL AND endDate >= ? ORDER BY id ASC",
    )
    .bind(userId, today)
    .all<ChallengeRow>();
  return r.results ?? [];
}

/** Codes the user currently has an open (not-yet-ended, not-completed) challenge for. */
export async function activeChallengeCodes(db: DB, userId: number, today: string): Promise<Set<string>> {
  return new Set((await activeChallenges(db, userId, today)).map((c) => c.code));
}

export async function markChallengeDone(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE v2_challenges SET completedAt = ? WHERE id = ? AND completedAt IS NULL").bind(nowIso(), id).run();
}

export async function countCompletedChallenges(db: DB, userId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_challenges WHERE accountId = ? AND completedAt IS NOT NULL")
    .bind(userId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// ============================================================================
// Squads — one squad per group chat, opt-in membership per user, independent of the 1:1
// accountability buddy. v2_squads.id is always set equal to chatId (the convention every prior
// backfill — 0069/0070/0071/0080 — already used, since legacy `squads` is keyed by chatId
// itself), so every function below addresses both v2_squads and v2_squad_members by chatId
// directly rather than looking up a separate autoincrement id.
// ============================================================================

export interface SquadRow {
  chatId: number;
  title: string | null;
  createdBy: number;
  lastRecapWeek: string | null;
}

/** Register (or refresh the title of) the squad for a group chat. */
export async function upsertSquad(db: DB, chatId: number, title: string | null, createdBy: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_squads (id, chatId, title, createdByAccountId, createdAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chatId) DO UPDATE SET title = excluded.title`,
    )
    .bind(chatId, chatId, title, createdBy, nowIso())
    .run();
}

/** Add a member. Returns false when they were already in (so the caller can stay quiet). */
export async function joinSquad(db: DB, chatId: number, userId: number): Promise<boolean> {
  const res = await db
    .prepare("INSERT INTO v2_squad_members (squadId, accountId, joinedAt) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(chatId, userId, nowIso())
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Remove a member. Returns false when they weren't in the squad. */
export async function leaveSquad(db: DB, chatId: number, userId: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM v2_squad_members WHERE squadId = ? AND accountId = ?").bind(chatId, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function getSquad(db: DB, chatId: number): Promise<SquadRow | null> {
  const row = await db
    .prepare("SELECT chatId, title, createdByAccountId AS createdBy, lastRecapWeek FROM v2_squads WHERE chatId = ?")
    .bind(chatId)
    .first<SquadRow>();
  return row ?? null;
}

export async function listSquads(db: DB): Promise<SquadRow[]> {
  const res = await db
    .prepare("SELECT chatId, title, createdByAccountId AS createdBy FROM v2_squads ORDER BY chatId")
    .all<SquadRow>();
  return res.results ?? [];
}

/** Squads that have not had their recap for `weekKey` yet, oldest first, capped at `limit`.
 * The cap is the whole point: each recap is one external subrequest, and the Workers Free plan
 * allows 50 per invocation — the sweep runs in small batches across consecutive cron ticks
 * instead of trying to fan out to every chat at once and starving the per-user reminders. */
export async function squadsDueForRecap(db: DB, weekKey: string, limit: number): Promise<SquadRow[]> {
  const res = await db
    .prepare(
      `SELECT chatId, title, createdByAccountId AS createdBy FROM v2_squads
        WHERE lastRecapWeek IS NULL OR lastRecapWeek <> ?
        ORDER BY chatId LIMIT ?`,
    )
    .bind(weekKey, limit)
    .all<SquadRow>();
  return res.results ?? [];
}

/** Mark a squad as recapped for `weekKey`. Written even when the post itself failed for a
 * transient reason — a retry storm into a group chat is worse than a missed weekly recap. */
export async function markSquadRecapped(db: DB, chatId: number, weekKey: string): Promise<void> {
  await db.prepare("UPDATE v2_squads SET lastRecapWeek = ? WHERE chatId = ?").bind(weekKey, chatId).run();
}

/** Members of a squad with the display name and language the digest needs. */
export async function squadMembers(
  db: DB,
  chatId: number,
): Promise<{ userId: number; name: string | null; alias: string | null; lang: string }[]> {
  const res = await db
    .prepare(
      `SELECT m.accountId AS userId,
              json_extract(p.profile, '$.name') AS name,
              pr.alias AS alias,
              p.lang AS lang
         FROM v2_squad_members m
         JOIN v2_profiles p ON p.accountId = m.accountId
         JOIN v2_preferences pr ON pr.accountId = m.accountId
        WHERE m.squadId = ?
        ORDER BY m.joinedAt`,
    )
    .bind(chatId)
    .all<{ userId: number; name: string | null; alias: string | null; lang: string }>();
  return res.results ?? [];
}

/** Squads this user belongs to — the fan-out list for a PR announcement. */
export async function squadsForUser(db: DB, userId: number): Promise<number[]> {
  const res = await db
    .prepare("SELECT squadId AS chatId FROM v2_squad_members WHERE accountId = ?")
    .bind(userId)
    .all<{ chatId: number }>();
  return (res.results ?? []).map((r) => r.chatId);
}

/** Completed session dates for a squad, from `since` onward — the digest's only workout read.
 * Scoped by the join so it never pulls the whole table the way a bare date-range scan would. */
export async function squadCompletedDates(
  db: DB,
  chatId: number,
  since: string,
  until?: string, // exclusive upper bound, for the Monday recap of the week that just ended
): Promise<{ userId: number; date: string }[]> {
  const res = await db
    .prepare(
      `SELECT w.accountId AS userId, w.date AS date
         FROM v2_workout_sessions w
         JOIN v2_squad_members m ON m.accountId = w.accountId AND m.squadId = ?
        WHERE w.date >= ? AND w.completed = 1` + (until ? " AND w.date < ?" : ""),
    )
    .bind(...(until ? [chatId, since, until] : [chatId, since]))
    .all<{ userId: number; date: string }>();
  return res.results ?? [];
}

/** Squads whose recap DO has never been woken (see migrations/0062_squad_do_woken.sql, ported
 * to v2_squads.doWokenAt by migrations/0080) — a catch-up sweep for any squad that predates the
 * wake-on-creation code path. Bounded by `limit` for the same reason the user-side wake
 * bootstrap is self-limiting: DO calls share the caller's own subrequest budget. */
export async function squadsNeedingWake(db: DB, limit: number): Promise<{ chatId: number }[]> {
  const res = await db
    .prepare("SELECT chatId FROM v2_squads WHERE doWokenAt IS NULL ORDER BY chatId LIMIT ?")
    .bind(limit)
    .all<{ chatId: number }>();
  return res.results ?? [];
}

export async function markSquadWoken(db: DB, chatId: number): Promise<void> {
  await db.prepare("UPDATE v2_squads SET doWokenAt = ? WHERE chatId = ?").bind(nowIso(), chatId).run();
}

/** Drop a squad and its membership — used when the bot is removed from the chat. One atomic
 * batch, same as legacy: a crash between the deletes must never leave v2_squad_members rows
 * pointing at a squadId that no longer has a v2_squads parent (squadsForUser/squadMembers would
 * then surface a "member of" a squad that getSquad() reports as gone). scheduler_dryrun_log has
 * no v2_* counterpart (it's purely observational DO dry-run infra — migrations/0060's own header
 * comment says it is safe to prune and nothing reads it back — not part of this or any product
 * domain in the migration plan's inventory), so that DELETE stays targeting the legacy table. */
export async function deleteSquad(db: DB, chatId: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM v2_squad_members WHERE squadId = ?").bind(chatId),
    db.prepare("DELETE FROM v2_squads WHERE chatId = ?").bind(chatId),
    db.prepare("DELETE FROM scheduler_dryrun_log WHERE source = 'squad' AND entityId = ?").bind(chatId),
  ]);
}
