// Client questions (the AI-suggested reply flow) and the trainer-client message thread.
import { recordInbox } from "./v2Inbox";
import type { ClientQuestionDoc } from "../../types";
import { nowIso, type DB } from "./shared";

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
    .prepare("INSERT INTO v2_trainer_questions (clientId, trainerId, text, aiDraft, status, createdAt) VALUES (?, ?, ?, ?, 'pending', ?)")
    .bind(clientId, trainerId, text, aiDraft ?? null, nowIso())
    .run();
  return Number(r.meta?.last_row_id ?? 0);
}

export async function getQuestion(db: DB, id: number): Promise<ClientQuestionDoc | null> {
  const r = await db.prepare("SELECT * FROM v2_trainer_questions WHERE id = ?").bind(id).first<Parameters<typeof toQuestion>[0]>();
  return r ? toQuestion(r) : null;
}

export async function setQuestionStatus(db: DB, id: number, status: ClientQuestionDoc["status"]): Promise<void> {
  await db.prepare("UPDATE v2_trainer_questions SET status=? WHERE id=?").bind(status, id).run();
}

export async function setQuestionDraft(db: DB, id: number, aiDraft: string): Promise<void> {
  await db.prepare("UPDATE v2_trainer_questions SET aiDraft = ? WHERE id = ?").bind(aiDraft, id).run();
}

/** A trainer's question history (any status), newest first — the Q&A archive view. */
export async function listQuestionsForTrainer(db: DB, trainerId: number, limit = 20): Promise<ClientQuestionDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_trainer_questions WHERE trainerId = ? ORDER BY id DESC LIMIT ?")
    .bind(trainerId, limit)
    .all<Parameters<typeof toQuestion>[0]>();
  return (r.results ?? []).map(toQuestion);
}

/** The client's own side of the same archive — what they asked, and whether it's been answered. */
export async function listQuestionsForClient(db: DB, clientId: number, limit = 20): Promise<ClientQuestionDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_trainer_questions WHERE clientId = ? ORDER BY id DESC LIMIT ?")
    .bind(clientId, limit)
    .all<Parameters<typeof toQuestion>[0]>();
  return (r.results ?? []).map(toQuestion);
}

export async function insertMessage(db: DB, fromId: number, toId: number, text: string): Promise<number> {
  const row = await db.prepare("INSERT INTO v2_messages (fromAccountId, toAccountId, text, createdAt) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(fromId, toId, text, nowIso()).first<{ id: number }>();
  let from: { name: string | null } | null = null;
  try { from = await db.prepare("SELECT name FROM v2_profiles WHERE accountId = ?").bind(fromId).first<{ name: string | null }>(); } catch { /* name is optional */ }
  await recordInbox(db, toId, "message", { fromId, fromName: from?.name ?? "", preview: text.slice(0, 120) });
  return row?.id ?? 0;
}

/** The reader opened the thread with `peerId`: everything the peer sent them is now read. */
export async function markThreadRead(db: DB, readerId: number, peerId: number): Promise<void> {
  await db.prepare("UPDATE v2_messages SET readAt = ? WHERE toAccountId = ? AND fromAccountId = ? AND readAt IS NULL")
    .bind(nowIso(), readerId, peerId).run();
}

/** Unread messages per sender for one reader. */
export async function unreadBySender(db: DB, readerId: number): Promise<Record<number, number>> {
  const r = await db
    .prepare("SELECT fromAccountId AS fromId, COUNT(*) AS n FROM v2_messages WHERE toAccountId = ? AND readAt IS NULL GROUP BY fromAccountId")
    .bind(readerId)
    .all<{ fromId: number; n: number }>();
  return Object.fromEntries((r.results ?? []).map((x) => [x.fromId, x.n]));
}

/** Messages from `fromId` the reader has not opened yet, sent after `sinceIso`. */
export async function unreadFromSince(db: DB, readerId: number, fromId: number, sinceIso: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM v2_messages WHERE toAccountId = ? AND fromAccountId = ? AND readAt IS NULL AND createdAt >= ?")
    .bind(readerId, fromId, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface MessageEntry {
  id: number;
  readAt: string | null;
  fromId: number;
  toId: number;
  text: string;
  createdAt: string;
}

/** The trainer<->client message thread, oldest first — messages are otherwise write-only (sent
 * once as a Telegram push and never readable again). limit caps how far back a single fetch goes. */
export async function listMessages(db: DB, trainerId: number, clientId: number, limit = 100): Promise<MessageEntry[]> {
  const r = await db
    .prepare(
      `SELECT id, readAt, fromAccountId AS fromId, toAccountId AS toId, text, createdAt FROM v2_messages
       WHERE (fromAccountId = ?1 AND toAccountId = ?2) OR (fromAccountId = ?2 AND toAccountId = ?1)
       ORDER BY createdAt DESC, id DESC LIMIT ?3`,
    )
    .bind(trainerId, clientId, limit)
    .all<MessageEntry>();
  return (r.results ?? []).reverse();
}

// ---------- trainer program templates ----------
