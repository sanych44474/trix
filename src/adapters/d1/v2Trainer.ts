// v2-native trainer-relationship repo (Domain 7 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of src/db/repos/trainer.ts: same
// exported names/signatures (so a call site switches by changing one import), same filters/
// ordering/edge cases — but reads/writes v2_trainers, v2_trainer_relationships,
// v2_trainer_requests, v2_trainer_questions, v2_trainer_templates, v2_client_cards,
// v2_client_notes, v2_client_note_history, v2_messages, v2_trainer_prospects and
// v2_shared_programs (migrations/0072_v2_tracking_trainer.sql + 0077_v2_trainer_complete.sql —
// the latter is the completeness pass that gave v2_trainers its rich-profile columns and gave
// client_note_history/shared_programs their first v2 home).
//
// Relationship-consistency invariant (the plan's "critical correctness point" for this domain):
// v2_trainer_relationships is keyed (clientId, trainerId) — a client can, in principle, have more
// than one row (one per trainer they've ever been paired with). Only ONE of those may ever be
// 'active' at a time: v2Users.ts's getUser() derives UserDoc.trainerId from a single-row
// correlated subquery filtered on status='active', and this module's listClients()/
// countClientsOf() derive the trainer-side view from the same column. If two rows for the same
// clientId were ever left 'active' (e.g. a request-accept racing a re-link), those two reads
// could disagree about who the client's trainer is. linkClient()/unlinkClient() below always
// DELETE-then-(re)INSERT the client's whole relationship row-set in ONE db.batch() — never two
// independent awaited calls — so there is no window where a partial write leaves more than one
// row, or a request's status flips without the edge actually moving. This mirrors, byte for byte,
// the delete-then-insert pattern v2Users.ts's updateUser() (trainerId branch) and
// v2Projection.ts's projectUserCore() already use against this same table, so if either of those
// two (Domain-1-owned, deliberately left as-is — see below) ever runs against a client this
// module has also touched, both leave the table in the identical shape (absence = unlinked,
// exactly one 'active' row = linked) instead of disagreeing on what "cleared" means.
//
// Domain-1/updateUser overlap: v2Users.ts's updateUser() still has its own trainerId branch, and
// v2Projection.ts's projectUserCore() still writes this table too — both predate this module and
// are explicitly called out in the migration plan as "may need to stay as-is". Decision: left
// BOTH untouched. Nothing in the bot/webapp call graph actually invokes updateUser(db, id,
// {trainerId}) with a real trainerId (grepped — only this module's own linkClient/unlinkClient
// and the test suites set it), so there is no live code path where the two writers race today;
// keeping the exact same delete-then-insert shape in both places means even a future caller that
// DID mix them would fail safe (last writer wins cleanly) rather than leave two active rows.
//
// Known pre-existing (not introduced by this port) caller-side gap: the accept-a-request flow
// (src/features/trainer/trainer.ts, src/webapp/extrasApi.ts) calls setRequestStatus(id,
// 'accepted') and linkClient(clientId, trainerId) as two separate awaited calls, same as legacy
// trainer.ts always did — a crash between them leaves the request marked accepted with the edge
// not yet created. Each call is atomic on its own (this module's job); making the pair atomic
// would require restructuring those call sites into one combined repo function, which changes
// call-site business logic rather than repointing an import — out of scope for a repo swap. Flagged
// here rather than silently "fixed" by guessing at a merged API shape the callers don't ask for.
//
// unlinkClient()'s plan-deactivation side effect targets v2_plans (updated once Domain 3 landed
// concurrently with this domain — see v2Plans.ts, which uses the identical
// `UPDATE v2_plans SET active = 0 WHERE accountId = ? AND active = 1` shape for its own
// deactivation). Same side effect legacy trainer.ts always ran against `plans`, just folded into
// this module's atomic batch.
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
import { buildUpdate, nowIso, safeJsonParse, type DB } from "../../db/repos/shared";
import { getUser, getUsersByIds } from "./v2Users";

// ---------- trainer client notes ----------

export async function getClientNote(db: DB, trainerId: number, clientId: number): Promise<string | null> {
  const r = await db
    .prepare("SELECT note FROM v2_client_notes WHERE trainerId = ? AND clientId = ?")
    .bind(trainerId, clientId)
    .first<{ note: string }>();
  return r ? r.note : null;
}

/** Append `value` to the note-history journal — call BEFORE overwriting a field, so the value
 * about to be replaced isn't lost. Returns the statement rather than running it, so callers can
 * fold it into the same batch as the overwrite (atomic: either both land or neither does). */
function archiveNoteFieldStmt(db: DB, trainerId: number, clientId: number, field: string, value: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO v2_client_note_history (trainerId, clientId, field, value, savedAt) VALUES (?, ?, ?, ?, ?)")
    .bind(trainerId, clientId, field, value, nowIso());
}

export interface ClientNoteHistoryEntry {
  field: string;
  value: string;
  savedAt: string;
}

/** Past values of a note field, most recent first — the CURRENT value lives in v2_client_notes/
 * v2_client_cards as usual; this is only what it used to be before each overwrite. */
export async function listClientNoteHistory(db: DB, trainerId: number, clientId: number, field?: string): Promise<ClientNoteHistoryEntry[]> {
  const r = field
    ? await db
        .prepare("SELECT field, value, savedAt FROM v2_client_note_history WHERE trainerId = ? AND clientId = ? AND field = ? ORDER BY savedAt DESC")
        .bind(trainerId, clientId, field)
        .all<ClientNoteHistoryEntry>()
    : await db
        .prepare("SELECT field, value, savedAt FROM v2_client_note_history WHERE trainerId = ? AND clientId = ? ORDER BY savedAt DESC")
        .bind(trainerId, clientId)
        .all<ClientNoteHistoryEntry>();
  return r.results ?? [];
}

export async function setClientNote(db: DB, trainerId: number, clientId: number, note: string): Promise<void> {
  const prev = await getClientNote(db, trainerId, clientId);
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (prev) statements.push(archiveNoteFieldStmt(db, trainerId, clientId, "note", prev));
  statements.push(
    db
      .prepare(
        `INSERT INTO v2_client_notes (trainerId, clientId, note, updatedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(trainerId, clientId) DO UPDATE SET note = excluded.note, updatedAt = excluded.updatedAt`,
      )
      .bind(trainerId, clientId, note, now),
  );
  await db.batch(statements);
}

// ---------- trainer client cards (health / personal notes / birthday) ----------

export async function getClientCard(db: DB, trainerId: number, clientId: number): Promise<ClientCardDoc | null> {
  const r = await db
    .prepare("SELECT trainerId, clientId, healthNotes, personalNotes, birthday, updatedAt FROM v2_client_cards WHERE trainerId = ? AND clientId = ?")
    .bind(trainerId, clientId)
    .first<ClientCardDoc>();
  return r ?? null;
}

/** Upsert one card field; keys absent from the patch keep their stored value. */
export async function setClientCard(
  db: DB,
  trainerId: number,
  clientId: number,
  patch: { healthNotes?: string | null; personalNotes?: string | null; birthday?: string | null },
): Promise<void> {
  const cur = await getClientCard(db, trainerId, clientId);
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (patch.healthNotes !== undefined && cur?.healthNotes) statements.push(archiveNoteFieldStmt(db, trainerId, clientId, "healthNotes", cur.healthNotes));
  if (patch.personalNotes !== undefined && cur?.personalNotes) statements.push(archiveNoteFieldStmt(db, trainerId, clientId, "personalNotes", cur.personalNotes));
  const healthNotes = patch.healthNotes !== undefined ? patch.healthNotes : (cur?.healthNotes ?? null);
  const personalNotes = patch.personalNotes !== undefined ? patch.personalNotes : (cur?.personalNotes ?? null);
  const birthday = patch.birthday !== undefined ? patch.birthday : (cur?.birthday ?? null);
  statements.push(
    db
      .prepare(
        `INSERT INTO v2_client_cards (trainerId, clientId, healthNotes, personalNotes, birthday, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(trainerId, clientId) DO UPDATE SET healthNotes = excluded.healthNotes, personalNotes = excluded.personalNotes, birthday = excluded.birthday, updatedAt = excluded.updatedAt`,
      )
      .bind(trainerId, clientId, healthNotes, personalNotes, birthday, now),
  );
  await db.batch(statements);
}

// ---------- roles: trainers, clients, requests, questions, messages ----------

const csvToArr = (s: string | null): string[] | undefined => {
  if (!s) return undefined;
  const a = s.split(",").map((x) => x.trim()).filter(Boolean);
  return a.length ? a : undefined;
};
const arrToCsv = (a?: string[]): string | null => (a && a.length ? a.join(",") : null);

interface V2TrainerRow {
  trainerId: number; status: string; inviteCode: string | null; name: string;
  bio: string | null; accepting: number; createdAt: string; approvedAt: string | null;
  specialization: string | null; tags: string | null; certifications: string | null;
  experienceYears: number | null; approach: string | null; priceOnline: number | null;
  priceOffline: number | null; currency: string | null; city: string | null;
  contact: string | null; languages: string | null; photoFileId: string | null;
  profileComplete: number; maxClients: number | null; isInstructor: number | null;
}

// accountId is v2_trainers' PK (== v2_accounts.id) — aliased to trainerId so the row shape (and
// toTrainer below) matches legacy's `trainers.trainerId` exactly.
const SELECT_TRAINER = `
  SELECT accountId AS trainerId, status, inviteCode, name, bio, accepting, createdAt, approvedAt,
    specialization, tags, certifications, experienceYears, approach, priceOnline, priceOffline,
    currency, city, contact, languages, photoFileId, profileComplete, maxClients, isInstructor
  FROM v2_trainers
`;

function toTrainer(r: V2TrainerRow): TrainerDoc {
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
  await db.prepare("UPDATE v2_accounts SET role = ?, updatedAt = ? WHERE id = ?").bind(role, nowIso(), userId).run();
}

export async function applyTrainer(db: DB, trainerId: number, p: TrainerProfileInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_trainers
         (accountId, status, name, bio, accepting, createdAt,
          specialization, tags, certifications, experienceYears, approach,
          priceOnline, priceOffline, currency, city, contact, languages, photoFileId, profileComplete)
       VALUES (?, 'pending', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET
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
  const r = await db.prepare(`${SELECT_TRAINER} WHERE accountId = ?`).bind(trainerId).first<V2TrainerRow>();
  return r ? toTrainer(r) : null;
}

export async function getTrainerByCode(db: DB, code: string): Promise<TrainerDoc | null> {
  const r = await db
    .prepare(`${SELECT_TRAINER} WHERE inviteCode = ? AND status = 'approved'`)
    .bind(code)
    .first<V2TrainerRow>();
  return r ? toTrainer(r) : null;
}

export async function approveTrainer(db: DB, trainerId: number, inviteCode: string): Promise<void> {
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE v2_trainers SET status='approved', inviteCode=?, approvedAt=? WHERE accountId=?").bind(inviteCode, now, trainerId),
    db.prepare("UPDATE v2_accounts SET role='trainer', updatedAt=? WHERE id=?").bind(now, trainerId),
  ]);
}

export async function rejectTrainer(db: DB, trainerId: number): Promise<void> {
  await db.prepare("UPDATE v2_trainers SET status='rejected' WHERE accountId=?").bind(trainerId).run();
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
  await db.prepare(`UPDATE v2_trainers SET ${sets.join(", ")} WHERE accountId = ?`).bind(...vals).run();
}

// ---------- personal prospect invites (minimal "add a client before they've joined") ----------

export interface ProspectDoc {
  code: string;
  trainerId: number;
  name: string;
  createdAt: string;
}

export async function createProspect(db: DB, code: string, trainerId: number, name: string): Promise<void> {
  await db.prepare("INSERT INTO v2_trainer_prospects (code, trainerId, name, createdAt) VALUES (?, ?, ?, ?)")
    .bind(code, trainerId, name, nowIso()).run();
}

export async function getProspect(db: DB, code: string): Promise<ProspectDoc | null> {
  const r = await db.prepare("SELECT code, trainerId, name, createdAt FROM v2_trainer_prospects WHERE code = ?").bind(code).first<ProspectDoc>();
  return r ?? null;
}

/** Returns true only if THIS call actually deleted the row — the single-use claim gate, same
 * reasoning as legacy deleteProspect: one atomic DELETE, so a duplicate Telegram webhook delivery
 * or two people racing the same link resolves to exactly one true. */
export async function deleteProspect(db: DB, code: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM v2_trainer_prospects WHERE code = ?").bind(code).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Prospects still waiting to join, most recent first — for the trainer's own visibility. */
export async function listProspects(db: DB, trainerId: number): Promise<ProspectDoc[]> {
  const r = await db.prepare("SELECT code, trainerId, name, createdAt FROM v2_trainer_prospects WHERE trainerId = ? ORDER BY createdAt DESC").bind(trainerId).all<ProspectDoc>();
  return r.results ?? [];
}

// ---------- link/unlink: the single source of truth for v2_trainer_relationships writes ----------

/** Establishes clientId's one active trainer edge, replacing any previous one atomically. See the
 * file-header comment for why this must be delete-then-insert in one batch. */
export async function linkClient(db: DB, clientId: number, trainerId: number): Promise<void> {
  const now = nowIso();
  await db.batch([
    db.prepare("DELETE FROM v2_trainer_relationships WHERE clientId = ?").bind(clientId),
    db.prepare(
      `INSERT INTO v2_trainer_relationships (clientId, trainerId, status, consent, createdAt, updatedAt)
       VALUES (?, ?, 'active', '{}', ?, ?)`,
    ).bind(clientId, trainerId, now, now),
    db.prepare("UPDATE v2_accounts SET role='client', updatedAt=? WHERE id=?").bind(now, clientId),
  ]);
}

/** Tears down clientId's edge and reverts their role, atomically with the plan-deactivation side
 * effect legacy always paired it with (see file-header comment on the legacy `plans` target). */
export async function unlinkClient(db: DB, clientId: number): Promise<void> {
  const now = nowIso();
  await db.batch([
    db.prepare("DELETE FROM v2_trainer_relationships WHERE clientId = ?").bind(clientId),
    db.prepare("UPDATE v2_accounts SET role='solo', updatedAt=? WHERE id=?").bind(now, clientId),
    // v2-native since Domain 3 (plans) landed — same shape v2Plans.ts's own deactivation uses.
    db.prepare("UPDATE v2_plans SET active = 0 WHERE accountId = ? AND active = 1").bind(clientId),
  ]);
}

export async function listClients(db: DB, trainerId: number): Promise<UserDoc[]> {
  const ids = await db
    .prepare("SELECT clientId FROM v2_trainer_relationships WHERE trainerId = ? AND status = 'active'")
    .bind(trainerId)
    .all<{ clientId: number }>();
  const clientIds = (ids.results ?? []).map((r) => r.clientId);
  if (!clientIds.length) return [];
  const map = await getUsersByIds(db, clientIds);
  // role='client' cross-check preserves legacy's exact filter (WHERE trainerId=? AND
  // role='client') in case the two ever disagree (e.g. a stale row from before a hard freeze).
  const clients = [...map.values()].filter((u) => u.role === "client");
  // Attention-first ordering, at THIS repo layer so every caller benefits (not just
  // dashboardReader.ts's buildTrainerSection, which used to be the only place this got sorted).
  // Flagged first, then by staleness (least-recently-active first) as the best proxy available
  // here: real "at risk" (missed consecutive planned workouts) needs plan + workout-history data
  // this function doesn't fetch, and adding those queries would turn an O(1) roster read into a
  // per-trainer fan-out -- buildTrainerSection already does that heavier computation for its own
  // dashboard view. A never-seen client (no lastSeenAt) sorts as maximally stale.
  return clients.sort((a, b) => {
    const flagDiff = Number(!!b.flagged) - Number(!!a.flagged);
    if (flagDiff) return flagDiff;
    return (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0);
  });
}

export async function listTrainerUsers(db: DB): Promise<UserDoc[]> {
  const ids = await db.prepare("SELECT id FROM v2_accounts WHERE role = 'trainer'").all<{ id: number }>();
  const trainerIds = (ids.results ?? []).map((r) => r.id);
  if (!trainerIds.length) return [];
  const map = await getUsersByIds(db, trainerIds);
  return [...map.values()];
}

export async function countByRole(db: DB, role: Role): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_accounts WHERE role = ?").bind(role).first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countClientsOf(db: DB, trainerId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_trainer_relationships WHERE trainerId = ? AND status = 'active'")
    .bind(trainerId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function pendingTrainerApplications(db: DB): Promise<{ trainerId: number; name: string }[]> {
  const r = await db
    .prepare("SELECT accountId AS trainerId, name FROM v2_trainers WHERE status='pending' ORDER BY createdAt")
    .all<{ trainerId: number; name: string }>();
  return r.results ?? [];
}

export async function countPendingClientRequests(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_trainer_requests WHERE status='pending'").first<{ c: number }>();
  return r?.c ?? 0;
}

export async function pendingRequestsAll(db: DB, limit = 20): Promise<ClientRequestDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_trainer_requests WHERE status='pending' ORDER BY createdAt DESC LIMIT ?")
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
  // db.batch() runs both statements atomically — same reasoning as legacy: a transient failure
  // between the two calls could cancel the client's old pending request without the new one ever
  // getting created, leaving them with none instead of the intended exactly-one.
  const [, insertResult] = await db.batch([
    db.prepare("UPDATE v2_trainer_requests SET status='cancelled' WHERE clientId=? AND status='pending'").bind(clientId),
    db
      .prepare("INSERT INTO v2_trainer_requests (clientId, trainerId, note, status, createdAt) VALUES (?, ?, ?, 'pending', ?)")
      .bind(clientId, trainerId, note ?? null, nowIso()),
  ]);
  return Number(insertResult.meta?.last_row_id ?? 0);
}

export async function getRequest(db: DB, id: number): Promise<ClientRequestDoc | null> {
  const r = await db.prepare("SELECT * FROM v2_trainer_requests WHERE id = ?").bind(id).first<Parameters<typeof toRequest>[0]>();
  return r ? toRequest(r) : null;
}

export async function pendingRequestsForTrainer(db: DB, trainerId: number): Promise<ClientRequestDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_trainer_requests WHERE trainerId=? AND status='pending' ORDER BY createdAt")
    .bind(trainerId)
    .all<Parameters<typeof toRequest>[0]>();
  return (r.results ?? []).map(toRequest);
}

export async function pendingRequestForClient(db: DB, clientId: number): Promise<ClientRequestDoc | null> {
  const r = await db
    .prepare("SELECT * FROM v2_trainer_requests WHERE clientId=? AND status='pending' ORDER BY createdAt DESC LIMIT 1")
    .bind(clientId)
    .first<Parameters<typeof toRequest>[0]>();
  return r ? toRequest(r) : null;
}

export async function setRequestStatus(db: DB, id: number, status: ClientRequestDoc["status"]): Promise<void> {
  await db.prepare("UPDATE v2_trainer_requests SET status=? WHERE id=?").bind(status, id).run();
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

export async function insertMessage(db: DB, fromId: number, toId: number, text: string): Promise<void> {
  await db.prepare("INSERT INTO v2_messages (fromAccountId, toAccountId, text, createdAt) VALUES (?, ?, ?, ?)")
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
      `SELECT fromAccountId AS fromId, toAccountId AS toId, text, createdAt FROM v2_messages
       WHERE (fromAccountId = ?1 AND toAccountId = ?2) OR (fromAccountId = ?2 AND toAccountId = ?1)
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
    .prepare("INSERT INTO v2_trainer_templates (trainerId, name, plan, createdAt) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(trainerId, name, JSON.stringify(plan), nowIso())
    .first<{ id: number }>();
  return r?.id ?? 0;
}

export async function listTrainerTemplates(db: DB, trainerId: number, limit = 20): Promise<TrainerTemplateMeta[]> {
  const r = await db
    .prepare("SELECT id, name, createdAt FROM v2_trainer_templates WHERE trainerId = ? ORDER BY id DESC LIMIT ?")
    .bind(trainerId, limit)
    .all<TrainerTemplateMeta>();
  return r.results ?? [];
}

export async function getTrainerTemplate(db: DB, trainerId: number, id: number): Promise<{ name: string; plan: BankPlan } | null> {
  const r = await db
    .prepare("SELECT name, plan FROM v2_trainer_templates WHERE id = ? AND trainerId = ?")
    .bind(id, trainerId)
    .first<{ name: string; plan: string }>();
  if (!r) return null;
  const plan = safeJsonParse<BankPlan | null>(r.plan, null);
  return plan ? { name: r.name, plan } : null;
}

export async function deleteTrainerTemplate(db: DB, trainerId: number, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM v2_trainer_templates WHERE id = ? AND trainerId = ?").bind(id, trainerId).run();
  return (r.meta?.changes ?? 0) > 0;
}

// ---------- shared programs (share-a-program: link + public library) ----------

export async function createSharedProgram(db: DB, code: string, ownerId: number, name: string, plan: BankPlan, isPublic: boolean): Promise<void> {
  await db
    .prepare("INSERT INTO v2_shared_programs (code, ownerId, name, plan, isPublic, takenCount, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .bind(code, ownerId, name, JSON.stringify(plan), isPublic ? 1 : 0, nowIso())
    .run();
}

export async function getSharedProgram(db: DB, code: string): Promise<{ code: string; ownerId: number; name: string; plan: BankPlan } | null> {
  const r = await db
    .prepare("SELECT code, ownerId, name, plan FROM v2_shared_programs WHERE code = ?")
    .bind(code)
    .first<{ code: string; ownerId: number; name: string; plan: string }>();
  if (!r) return null;
  const plan = safeJsonParse<BankPlan | null>(r.plan, null);
  return plan ? { code: r.code, ownerId: r.ownerId, name: r.name, plan } : null;
}

export async function listPublicPrograms(db: DB, limit = 20): Promise<{ code: string; name: string; takenCount: number }[]> {
  const r = await db
    .prepare("SELECT code, name, takenCount FROM v2_shared_programs WHERE isPublic = 1 ORDER BY takenCount DESC, createdAt DESC LIMIT ?")
    .bind(limit)
    .all<{ code: string; name: string; takenCount: number }>();
  return r.results ?? [];
}

export async function bumpSharedTaken(db: DB, code: string): Promise<void> {
  await db.prepare("UPDATE v2_shared_programs SET takenCount = takenCount + 1 WHERE code = ?").bind(code).run();
}
