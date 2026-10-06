// Feedback inbox (v2_feedback): users' feedback, the owner's triage state, and counts for reports.
import { nowIso, type DB } from "./shared";
import { classifyFeedback, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackCategory, type FeedbackStatus } from "../../domain/feedbackTriage";

export async function insertFeedback(
  db: DB,
  f: { userId: number; username?: string; text: string; date: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO v2_feedback (accountId, username, text, date, createdAt, category) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(f.userId, f.username ?? null, f.text, f.date, nowIso(), classifyFeedback(f.text))
    .run();
}

export interface FeedbackRow {
  id: number;
  userId: number;
  username?: string;
  name?: string;
  text: string;
  date: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
}

/** The owner console's feedback list (newest first), optionally by status, with counts. */
export async function listFeedback(db: DB, status: FeedbackStatus | "all", limit = 100): Promise<{ rows: FeedbackRow[]; counts: Record<FeedbackStatus, number> }> {
  const where = status === "all" ? "" : "WHERE f.status = ?";
  const stmt = db.prepare(
    `SELECT f.id, f.accountId AS userId, f.username, f.text, f.date, f.category, f.status, COALESCE(pr.name, json_extract(pr.profile, '$.name')) AS name
       FROM v2_feedback f LEFT JOIN v2_profiles pr ON pr.accountId = f.accountId ${where}
      ORDER BY f.createdAt DESC LIMIT ?`,
  );
  const r = await (status === "all" ? stmt.bind(limit) : stmt.bind(status, limit))
    .all<{ id: number; userId: number; username: string | null; text: string; date: string; category: string | null; status: string; name: string | null }>();
  const c = await db.prepare("SELECT status, COUNT(*) AS n FROM v2_feedback GROUP BY status").all<{ status: string; n: number }>();
  const counts: Record<FeedbackStatus, number> = { new: 0, done: 0, wontfix: 0 };
  for (const row of c.results ?? []) if ((FEEDBACK_STATUSES as readonly string[]).includes(row.status)) counts[row.status as FeedbackStatus] = row.n;
  return {
    rows: (r.results ?? []).map((x) => ({
      id: x.id,
      userId: x.userId,
      ...(x.username ? { username: x.username } : {}),
      ...(x.name ? { name: x.name } : {}),
      text: x.text,
      date: x.date,
      category: (FEEDBACK_CATEGORIES as readonly string[]).includes(x.category ?? "") ? (x.category as FeedbackCategory) : "other",
      status: (FEEDBACK_STATUSES as readonly string[]).includes(x.status) ? (x.status as FeedbackStatus) : "new",
    })),
    counts,
  };
}

/** Set a feedback row's status and/or category; returns the row's author and text (null if gone). */
export async function updateFeedback(
  db: DB,
  id: number,
  patch: { status?: FeedbackStatus; category?: FeedbackCategory },
): Promise<{ userId: number; text: string; status: FeedbackStatus } | null> {
  const row = await db.prepare("SELECT accountId AS userId, text, status FROM v2_feedback WHERE id = ?").bind(id).first<{ userId: number; text: string; status: string }>();
  if (!row) return null;
  if (patch.category) await db.prepare("UPDATE v2_feedback SET category = ? WHERE id = ?").bind(patch.category, id).run();
  if (patch.status) {
    await db.prepare("UPDATE v2_feedback SET status = ?, resolvedAt = ? WHERE id = ?").bind(patch.status, patch.status === "new" ? null : nowIso(), id).run();
  }
  return { userId: row.userId, text: row.text, status: (row.status as FeedbackStatus) ?? "new" };
}

export async function countFeedbackSince(db: DB, sinceIso: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_feedback WHERE createdAt >= ?")
    .bind(sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function recentFeedback(
  db: DB,
  limit: number,
): Promise<{ userId: number; username?: string; text: string; date: string }[]> {
  const r = await db
    .prepare("SELECT accountId AS userId, username, text, date FROM v2_feedback ORDER BY createdAt DESC LIMIT ?")
    .bind(limit)
    .all<{ userId: number; username: string | null; text: string; date: string }>();
  return (r.results ?? []).map((x) => ({
    userId: x.userId,
    username: x.username ?? undefined,
    text: x.text,
    date: x.date,
  }));
}

// ---------- owner report: user listing + event counts ----------
