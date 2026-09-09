// Trainer/client relationship: trainer profiles, the client-card notes trainers keep,
// role linking, the request/question pairing handshake, and program templates/sharing. Split
// out of repos.ts (god-file split, same barrel seam — `../db/repos` still re-exports everything
// here) so the whole trainer-relationship surface lives in one place instead of scattered
// across the file; behavior unchanged.
import type {
  BankPlan,
  ClientCardDoc,
  ClientQuestionDoc,
  ClientRequestDoc,
  Role,
  TrainerDoc,
  TrainerProfileInput,
  UserDoc,
} from "../../types";
import { buildUpdate, nowIso, safeJsonParse, type DB } from "./shared";
import { getUser, toUser, type UserRow } from "./users";

// ---------- trainer client notes ----------

export async function getClientNote(db: DB, trainerId: number, clientId: number): Promise<string | null> {
  const r = await db
    .prepare("SELECT note FROM client_notes WHERE trainerId = ? AND clientId = ?")
    .bind(trainerId, clientId)
    .first<{ note: string }>();
  return r ? r.note : null;
}

/** Append `value` to the note-history journal — call BEFORE overwriting a field, so the value
 * about to be replaced isn't lost. try/catch protects the deploy-before-migrate window. */
async function archiveNoteField(db: DB, trainerId: number, clientId: number, field: string, value: string): Promise<void> {
  if (!value) return; // nothing to preserve
  try {
    await db
      .prepare("INSERT INTO client_note_history (trainerId, clientId, field, value, savedAt) VALUES (?, ?, ?, ?, ?)")
      .bind(trainerId, clientId, field, value, nowIso())
      .run();
  } catch {
    /* table not migrated yet — don't block the actual note save over it */
  }
}

export interface ClientNoteHistoryEntry {
  field: string;
  value: string;
  savedAt: string;
}

/** Past values of a note field, most recent first — the CURRENT value lives in client_notes/
 * client_cards as usual; this is only what it used to be before each overwrite. */
export async function listClientNoteHistory(db: DB, trainerId: number, clientId: number, field?: string): Promise<ClientNoteHistoryEntry[]> {
  try {
    const r = field
      ? await db
          .prepare("SELECT field, value, savedAt FROM client_note_history WHERE trainerId = ? AND clientId = ? AND field = ? ORDER BY savedAt DESC")
          .bind(trainerId, clientId, field)
          .all<ClientNoteHistoryEntry>()
      : await db
          .prepare("SELECT field, value, savedAt FROM client_note_history WHERE trainerId = ? AND clientId = ? ORDER BY savedAt DESC")
          .bind(trainerId, clientId)
          .all<ClientNoteHistoryEntry>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

export async function setClientNote(db: DB, trainerId: number, clientId: number, note: string): Promise<void> {
  const prev = await getClientNote(db, trainerId, clientId);
  if (prev) await archiveNoteField(db, trainerId, clientId, "note", prev);
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
  if (patch.healthNotes !== undefined && cur?.healthNotes) await archiveNoteField(db, trainerId, clientId, "healthNotes", cur.healthNotes);
  if (patch.personalNotes !== undefined && cur?.personalNotes) await archiveNoteField(db, trainerId, clientId, "personalNotes", cur.personalNotes);
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
  profileComplete: number; maxClients: number | null; isInstructor: number | null;
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
    maxClients: r.maxClients ?? undefined,
    isInstructor: !!r.isInstructor,
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

// ---------- personal prospect invites (minimal "add a client before they've joined") ----------

export interface ProspectDoc {
  code: string;
  trainerId: number;
  name: string;
  createdAt: string;
}

export async function createProspect(db: DB, code: string, trainerId: number, name: string): Promise<void> {
  await db.prepare("INSERT INTO trainer_prospects (code, trainerId, name, createdAt) VALUES (?, ?, ?, ?)")
    .bind(code, trainerId, name, nowIso()).run();
}

export async function getProspect(db: DB, code: string): Promise<ProspectDoc | null> {
  const r = await db.prepare("SELECT code, trainerId, name, createdAt FROM trainer_prospects WHERE code = ?").bind(code).first<ProspectDoc>();
  return r ?? null;
}

/** Returns true only if THIS call actually deleted the row — the single-use claim gate.
 * DELETE is one atomic statement, so if the same code is consumed twice concurrently (a
 * duplicate Telegram webhook delivery, or two people racing the same link), exactly one caller
 * sees true and the other sees false, even though both may have read the row first via
 * getProspect(). Callers MUST check this before acting on the prospect's data. */
export async function deleteProspect(db: DB, code: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM trainer_prospects WHERE code = ?").bind(code).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Prospects still waiting to join, most recent first — for the trainer's own visibility. */
export async function listProspects(db: DB, trainerId: number): Promise<ProspectDoc[]> {
  const r = await db.prepare("SELECT code, trainerId, name, createdAt FROM trainer_prospects WHERE trainerId = ? ORDER BY createdAt DESC").bind(trainerId).all<ProspectDoc>();
  return r.results ?? [];
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
  // db.batch() runs both statements atomically (improvement #10 from the production-readiness
  // list) — as two separate awaited calls, a transient failure or worker eviction between them
  // could cancel the client's old pending request without the new one ever getting created,
  // leaving them with none at all instead of the intended exactly-one.
  const [, insertResult] = await db.batch([
    db.prepare("UPDATE client_requests SET status='cancelled' WHERE clientId=? AND status='pending'").bind(clientId),
    db
      .prepare("INSERT INTO client_requests (clientId, trainerId, note, status, createdAt) VALUES (?, ?, ?, 'pending', ?)")
      .bind(clientId, trainerId, note ?? null, nowIso()),
  ]);
  return Number(insertResult.meta?.last_row_id ?? 0);
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

export interface MessageEntry {
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
      `SELECT fromId, toId, text, createdAt FROM messages
       WHERE (fromId = ?1 AND toId = ?2) OR (fromId = ?2 AND toId = ?1)
       ORDER BY createdAt DESC, id DESC LIMIT ?3`,
    )
    .bind(trainerId, clientId, limit)
    .all<MessageEntry>();
  return (r.results ?? []).reverse();
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
  if (!r) return null;
  const plan = safeJsonParse<BankPlan | null>(r.plan, null);
  return plan ? { name: r.name, plan } : null;
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
  if (!r) return null;
  const plan = safeJsonParse<BankPlan | null>(r.plan, null);
  return plan ? { code: r.code, ownerId: r.ownerId, name: r.name, plan } : null;
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
