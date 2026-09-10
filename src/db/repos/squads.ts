// Squad mode — the bot in a group chat friends already use. One squad per group chat, opt-in
// membership per user, independent of the 1:1 accountability buddy.
import type { DB } from "./shared";
import { nowIso } from "./shared";

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
      `INSERT INTO squads (chatId, title, createdBy, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(chatId) DO UPDATE SET title = excluded.title`,
    )
    .bind(chatId, title, createdBy, nowIso())
    .run();
}

/** Add a member. Returns false when they were already in (so the caller can stay quiet). */
export async function joinSquad(db: DB, chatId: number, userId: number): Promise<boolean> {
  const res = await db
    .prepare("INSERT INTO squad_members (chatId, userId, joinedAt) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(chatId, userId, nowIso())
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Remove a member. Returns false when they weren't in the squad. */
export async function leaveSquad(db: DB, chatId: number, userId: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM squad_members WHERE chatId = ? AND userId = ?").bind(chatId, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function getSquad(db: DB, chatId: number): Promise<SquadRow | null> {
  const row = await db
    .prepare("SELECT chatId, title, createdBy, lastRecapWeek FROM squads WHERE chatId = ?")
    .bind(chatId)
    .first<SquadRow>();
  return row ?? null;
}

export async function listSquads(db: DB): Promise<SquadRow[]> {
  const res = await db.prepare("SELECT chatId, title, createdBy FROM squads ORDER BY chatId").all<SquadRow>();
  return res.results ?? [];
}

/** Squads that have not had their recap for `weekKey` yet, oldest first, capped at `limit`.
 * The cap is the whole point: each recap is one external subrequest, and the Workers Free plan
 * allows 50 per invocation — the sweep runs in small batches across consecutive cron ticks
 * instead of trying to fan out to every chat at once and starving the per-user reminders. */
export async function squadsDueForRecap(db: DB, weekKey: string, limit: number): Promise<SquadRow[]> {
  const res = await db
    .prepare(
      `SELECT chatId, title, createdBy FROM squads
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
  await db.prepare("UPDATE squads SET lastRecapWeek = ? WHERE chatId = ?").bind(weekKey, chatId).run();
}

/** Members of a squad with the display name and language the digest needs. */
export async function squadMembers(
  db: DB,
  chatId: number,
): Promise<{ userId: number; name: string | null; alias: string | null; lang: string }[]> {
  const res = await db
    .prepare(
      `SELECT m.userId AS userId,
              json_extract(u.profile, '$.name') AS name,
              u.alias AS alias,
              u.lang AS lang
         FROM squad_members m
         JOIN users u ON u.id = m.userId
        WHERE m.chatId = ?
        ORDER BY m.joinedAt`,
    )
    .bind(chatId)
    .all<{ userId: number; name: string | null; alias: string | null; lang: string }>();
  return res.results ?? [];
}

/** Squads this user belongs to — the fan-out list for a PR announcement. */
export async function squadsForUser(db: DB, userId: number): Promise<number[]> {
  const res = await db
    .prepare("SELECT chatId FROM squad_members WHERE userId = ?")
    .bind(userId)
    .all<{ chatId: number }>();
  return (res.results ?? []).map((r) => r.chatId);
}

/** Completed session dates for a squad, from `since` onward — the digest's only workout read.
 * Scoped by the join so it never pulls the whole table the way allWorkoutLogsSince does. */
export async function squadCompletedDates(
  db: DB,
  chatId: number,
  since: string,
  until?: string, // exclusive upper bound, for the Monday recap of the week that just ended
): Promise<{ userId: number; date: string }[]> {
  const res = await db
    .prepare(
      `SELECT w.userId AS userId, w.date AS date
         FROM workout_logs w
         JOIN squad_members m ON m.userId = w.userId AND m.chatId = ?
        WHERE w.date >= ? AND w.completed = 1` + (until ? " AND w.date < ?" : ""),
    )
    .bind(...(until ? [chatId, since, until] : [chatId, since]))
    .all<{ userId: number; date: string }>();
  return res.results ?? [];
}

/** Squads whose recap DO has never been woken (see migrations/0062) — a catch-up sweep for
 * any squad that predates the wake-on-creation code path. Bounded by `limit` for the same
 * reason the user-side wake bootstrap is self-limiting: DO calls share the caller's own
 * subrequest budget. */
export async function squadsNeedingWake(db: DB, limit: number): Promise<{ chatId: number }[]> {
  const res = await db
    .prepare("SELECT chatId FROM squads WHERE doWokenAt IS NULL ORDER BY chatId LIMIT ?")
    .bind(limit)
    .all<{ chatId: number }>();
  return res.results ?? [];
}

export async function markSquadWoken(db: DB, chatId: number): Promise<void> {
  await db.prepare("UPDATE squads SET doWokenAt = ? WHERE chatId = ?").bind(nowIso(), chatId).run();
}

/** Drop a squad and its membership — used when the bot is removed from the chat. */
export async function deleteSquad(db: DB, chatId: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM squad_members WHERE chatId = ?").bind(chatId),
    db.prepare("DELETE FROM squads WHERE chatId = ?").bind(chatId),
    db.prepare("DELETE FROM scheduler_dryrun_log WHERE source = 'squad' AND entityId = ?").bind(chatId),
  ]);
}
