// Trainer scheduling + money (migrations/0082_v2_trainer_schedule_finance.sql). Unlike the other
// v2*.ts adapters this is NOT a port of a legacy repo: `client_billing` is frozen/dead (see
// legacyFreeze.ts) and there was never a sessions table at all, so this is v2-native from the
// start with no legacy shape to stay faithful to.
//
// Every read and write is scoped by trainerId. That is the authorization boundary for this
// domain, enforced here rather than only at the handler, so a mis-scoped call site cannot read
// or mutate another trainer's schedule even by guessing a row id.
import { nowIso, type DB } from "../../db/repos/shared";

export type SessionStatus = "planned" | "done" | "cancelled" | "no_show";
export const SESSION_STATUSES: SessionStatus[] = ["planned", "done", "cancelled", "no_show"];

export interface TrainerSession {
  id: number;
  clientId: number;
  startsAt: string;
  durationMin: number;
  status: SessionStatus;
  price: number | null;
  note: string;
}

interface SessionRow {
  id: number;
  clientId: number;
  startsAt: string;
  durationMin: number;
  status: string;
  price: number | null;
  note: string | null;
}

const toSession = (r: SessionRow): TrainerSession => ({
  id: r.id,
  clientId: r.clientId,
  startsAt: r.startsAt,
  durationMin: r.durationMin,
  status: (SESSION_STATUSES as string[]).includes(r.status) ? (r.status as SessionStatus) : "planned",
  price: r.price,
  note: r.note ?? "",
});

export interface NewSession {
  clientId: number;
  startsAt: string;
  durationMin: number;
  price: number | null;
  note: string;
}

export async function createSession(db: DB, trainerId: number, s: NewSession): Promise<number> {
  const now = nowIso();
  const res = await db
    .prepare(
      `INSERT INTO v2_trainer_sessions (trainerId, clientId, startsAt, durationMin, status, price, note, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)`,
    )
    .bind(trainerId, s.clientId, s.startsAt, s.durationMin, s.price, s.note || null, now, now)
    .run();
  return Number(res.meta.last_row_id);
}

/** Sessions in a half-open [from, to) window, soonest first — the schedule view's only read. */
export async function listSessions(db: DB, trainerId: number, from: string, to: string): Promise<TrainerSession[]> {
  const r = await db
    .prepare(
      `SELECT id, clientId, startsAt, durationMin, status, price, note FROM v2_trainer_sessions
       WHERE trainerId = ? AND startsAt >= ? AND startsAt < ? ORDER BY startsAt ASC`,
    )
    .bind(trainerId, from, to)
    .all<SessionRow>();
  return (r.results ?? []).map(toSession);
}

/** Returns false when the row doesn't exist or belongs to another trainer — never throws. */
export async function setSessionStatus(db: DB, trainerId: number, id: number, status: SessionStatus): Promise<boolean> {
  const res = await db
    .prepare("UPDATE v2_trainer_sessions SET status = ?, updatedAt = ? WHERE id = ? AND trainerId = ?")
    .bind(status, nowIso(), id, trainerId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function rescheduleSession(db: DB, trainerId: number, id: number, startsAt: string, durationMin: number): Promise<boolean> {
  const res = await db
    .prepare("UPDATE v2_trainer_sessions SET startsAt = ?, durationMin = ?, updatedAt = ? WHERE id = ? AND trainerId = ?")
    .bind(startsAt, durationMin, nowIso(), id, trainerId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteSession(db: DB, trainerId: number, id: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM v2_trainer_sessions WHERE id = ? AND trainerId = ?").bind(id, trainerId).run();
  return (res.meta.changes ?? 0) > 0;
}

export interface Payment {
  id: number;
  clientId: number;
  amount: number;
  currency: string;
  paidOn: string;
  note: string;
}

export async function recordPayment(
  db: DB,
  trainerId: number,
  p: { clientId: number; amount: number; currency: string; paidOn: string; note: string },
): Promise<number> {
  const res = await db
    .prepare("INSERT INTO v2_trainer_payments (trainerId, clientId, amount, currency, paidOn, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(trainerId, p.clientId, p.amount, p.currency, p.paidOn, p.note || null, nowIso())
    .run();
  return Number(res.meta.last_row_id);
}

export async function listPayments(db: DB, trainerId: number, from: string, to: string): Promise<Payment[]> {
  const r = await db
    .prepare(
      `SELECT id, clientId, amount, currency, paidOn, note FROM v2_trainer_payments
       WHERE trainerId = ? AND paidOn >= ? AND paidOn < ? ORDER BY paidOn DESC, id DESC`,
    )
    .bind(trainerId, from, to)
    .all<{ id: number; clientId: number; amount: number; currency: string; paidOn: string; note: string | null }>();
  return (r.results ?? []).map((row) => ({ ...row, note: row.note ?? "" }));
}

export async function deletePayment(db: DB, trainerId: number, id: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM v2_trainer_payments WHERE id = ? AND trainerId = ?").bind(id, trainerId).run();
  return (res.meta.changes ?? 0) > 0;
}

export interface ClientLedger {
  clientId: number;
  sessionsDone: number;
  sessionsPlanned: number;
  billed: number; // sum of price over DONE sessions only -- a planned session hasn't earned anything yet
  paid: number;
  balance: number; // what the client still owes; negative = they are in credit
}

/**
 * Billing deliberately counts only `done` sessions. Counting planned ones would show a trainer
 * money they haven't earned, and counting cancelled/no-show ones would invent debt -- if a
 * no-show should still be billed, the trainer marks it `done`, which is an explicit decision
 * rather than something this function guesses at.
 */
export async function clientLedgers(db: DB, trainerId: number, from: string, to: string): Promise<ClientLedger[]> {
  const [sessions, payments] = await Promise.all([
    db
      .prepare(
        `SELECT clientId, status, COALESCE(price, 0) AS price FROM v2_trainer_sessions
         WHERE trainerId = ? AND startsAt >= ? AND startsAt < ?`,
      )
      .bind(trainerId, from, to)
      .all<{ clientId: number; status: string; price: number }>(),
    db
      .prepare("SELECT clientId, amount FROM v2_trainer_payments WHERE trainerId = ? AND paidOn >= ? AND paidOn < ?")
      .bind(trainerId, from, to)
      .all<{ clientId: number; amount: number }>(),
  ]);

  const byClient = new Map<number, ClientLedger>();
  const slot = (clientId: number): ClientLedger => {
    let row = byClient.get(clientId);
    if (!row) {
      row = { clientId, sessionsDone: 0, sessionsPlanned: 0, billed: 0, paid: 0, balance: 0 };
      byClient.set(clientId, row);
    }
    return row;
  };
  for (const s of sessions.results ?? []) {
    const row = slot(s.clientId);
    if (s.status === "done") { row.sessionsDone += 1; row.billed += s.price; }
    else if (s.status === "planned") row.sessionsPlanned += 1;
  }
  for (const p of payments.results ?? []) slot(p.clientId).paid += p.amount;
  for (const row of byClient.values()) row.balance = row.billed - row.paid;
  return [...byClient.values()].sort((a, b) => b.balance - a.balance);
}
