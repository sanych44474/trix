// The Mini App's notification feed (migrations/0091). Events are recorded where they happen --
// plan assignment, trainer plan edits, messages, badges, the weekly progression -- best-effort:
// a failed feed write never fails the action itself.
import { nowIso, type DB } from "./shared";
import { t } from "../../locales/i18n";

export type InboxKind = "plan_assigned" | "plan_changed" | "message" | "badge" | "progression" | "feedback_done" | "squad_pr" | "squad_week";

export interface InboxItem {
  id: number;
  kind: InboxKind;
  params: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export async function recordInbox(db: DB, accountId: number, kind: InboxKind, params: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.prepare("INSERT INTO v2_inbox (accountId, kind, params, createdAt) VALUES (?, ?, ?, ?)")
      .bind(accountId, kind, JSON.stringify(params), nowIso()).run();
  } catch { /* the feed is best-effort; the action that triggered it already happened */ }
}

/** A badge, named in both languages now (the Mini App has no badge catalog of its own). */
export async function recordBadgeInbox(db: DB, accountId: number, code: string): Promise<void> {
  const key = `badge_${code}` as Parameters<typeof t>[1];
  const uk = t("uk", key), en = t("en", key);
  await recordInbox(db, accountId, "badge", { code, uk: uk === key ? code : uk, en: en === key ? code : en });
}

export async function listInbox(db: DB, accountId: number, limit = 40): Promise<{ items: InboxItem[]; unread: number }> {
  const [rows, unread] = await db.batch([
    db.prepare("SELECT id, kind, params, createdAt, readAt FROM v2_inbox WHERE accountId = ? ORDER BY id DESC LIMIT ?").bind(accountId, limit),
    db.prepare("SELECT COUNT(*) AS n FROM v2_inbox WHERE accountId = ? AND readAt IS NULL").bind(accountId),
  ]);
  const items = ((rows?.results ?? []) as Array<{ id: number; kind: InboxKind; params: string; createdAt: string; readAt: string | null }>).map((r) => {
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(r.params) as Record<string, unknown>; } catch { /* keep {} */ }
    return { id: r.id, kind: r.kind, params, createdAt: r.createdAt, read: r.readAt !== null };
  });
  return { items, unread: Number((unread?.results?.[0] as { n?: number } | undefined)?.n ?? 0) };
}

export async function markInboxRead(db: DB, accountId: number): Promise<void> {
  await db.prepare("UPDATE v2_inbox SET readAt = ? WHERE accountId = ? AND readAt IS NULL").bind(nowIso(), accountId).run();
}

export async function pruneInbox(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM v2_inbox WHERE createdAt < ?").bind(beforeIso).run();
}
