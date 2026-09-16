// v2-native tracking repo (Domain 6 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of the in-scope exports of
// src/db/repos/tracking.ts: same exported names/signatures, same filters/ordering, same edge
// cases — but reads/writes ONLY v2_measurements/v2_wellbeing/v2_water_logs/v2_step_logs/
// v2_injuries/v2_progress_photos (see migrations/0076_v2_tracking_complete.sql for the two real
// schema gaps that migration closed: v2_measurements.createdAt, v2_injuries.lastAskedAt/
// checkinsHistory).
//
// Out of scope, deliberately NOT ported here (see tracking.ts's own "---------- challenges
// ----------" section): joinChallenge/activeChallenges/activeChallengeCodes/markChallengeDone/
// countCompletedChallenges/ChallengeRow. Those read/write `challenges`/`v2_challenges`, which is
// Domain 8 (gamification) per the migration plan, not this domain — left on legacy tracking.ts.
//
// v2_activity_days (migrations/0070_v2_long_tail.sql) is NOT used by this module. It's a
// separate (accountId, date) rollup shaped differently from v2_water_logs/v2_step_logs (one row
// per metric per day, mirroring legacy's two separate tables and addWater's increment-in-place
// semantics) with no existing projector or writer; see 0076's header comment for the full
// reasoning. v2_water_logs/v2_step_logs are this domain's source of truth for water/steps.
import type { BodyLogDoc, BodyMeasurements, DailyCheckinDoc, InjuryDoc, StepLogDoc } from "../../types";
import { nowIso, safeJsonParse, type DB } from "../../db/repos/shared";

// ---------- body logs / measurements ----------

interface V2BodyRow {
  accountId: number;
  date: string;
  weight: number | null;
  measurements: string; // v2_measurements.measurements is NOT NULL DEFAULT '{}'
  createdAt: string | null;
}

function toBody(r: V2BodyRow): BodyLogDoc {
  // "{}" and NULL both mean "no extra measurements were ever recorded" — legacy body_logs.measurements
  // is nullable and toBody() left BodyLogDoc.measurements undefined for that case; v2_measurements'
  // column is NOT NULL DEFAULT '{}' (see 0069), so an empty object is v2's spelling of the same
  // "none" state. Treat it identically to preserve BodyLogDoc's optional-field contract.
  const parsed = safeJsonParse<BodyMeasurements>(r.measurements, {});
  const measurements = parsed && Object.keys(parsed).length ? parsed : undefined;
  return {
    userId: r.accountId,
    date: r.date,
    weight: r.weight ?? undefined,
    measurements,
    // Backfill (0076) leaves createdAt NULL for any v2_measurements row with no legacy
    // counterpart (shouldn't happen post-backfill, but toBody must not throw on it) — fall back
    // to "now" rather than crash a .map(toBody) over one bad row, same discipline as safeJsonParse.
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
  };
}

export async function saveBaselineBody(
  db: DB,
  userId: number,
  date: string,
  weight: number | undefined,
  measurements: BodyMeasurements | undefined,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO v2_measurements (accountId, date, weight, measurements, createdAt) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(userId, date, weight ?? null, measurements ? JSON.stringify(measurements) : "{}", nowIso())
    .run();
}

// Same atomic-UPSERT reasoning as legacy upsertBodyLog (json_patch merge-patch semantics, COALESCE
// for weight) — v2_measurements.measurements is NOT NULL DEFAULT '{}' so, unlike the legacy
// nullable column, no COALESCE/CASE is needed around the json_patch base value: an unset
// patch.measurements binds "{}", and RFC 7396 merge-patch semantics make json_patch(x, '{}') a
// no-op, so it always safely leaves the stored value untouched exactly like the legacy CASE did.
export async function upsertBodyLog(
  db: DB,
  userId: number,
  date: string,
  patch: { weight?: number; measurements?: BodyMeasurements },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_measurements (accountId, date, weight, measurements, createdAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET
         weight = COALESCE(excluded.weight, v2_measurements.weight),
         measurements = json_patch(v2_measurements.measurements, excluded.measurements)`,
    )
    .bind(userId, date, patch.weight ?? null, patch.measurements ? JSON.stringify(patch.measurements) : "{}", nowIso())
    .run();
}

export async function bodyLogsByUser(db: DB, userId: number): Promise<BodyLogDoc[]> {
  const r = await db
    .prepare("SELECT accountId, date, weight, measurements, createdAt FROM v2_measurements WHERE accountId = ? ORDER BY date ASC")
    .bind(userId)
    .all<V2BodyRow>();
  return (r.results ?? []).map(toBody);
}

// ---------- step logs ----------

export async function upsertStepLog(db: DB, userId: number, date: string, steps: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_step_logs (accountId, date, steps, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET steps = excluded.steps`,
    )
    .bind(userId, date, steps, nowIso())
    .run();
}

export async function getStepLog(db: DB, userId: number, date: string): Promise<number | null> {
  const r = await db
    .prepare("SELECT steps FROM v2_step_logs WHERE accountId = ? AND date = ?")
    .bind(userId, date)
    .first<{ steps: number }>();
  return r ? r.steps : null;
}

export async function stepLogsSince(db: DB, userId: number, cutoff: string): Promise<StepLogDoc[]> {
  const r = await db
    .prepare("SELECT accountId, date, steps, createdAt FROM v2_step_logs WHERE accountId = ? AND date >= ? ORDER BY date ASC")
    .bind(userId, cutoff)
    .all<{ accountId: number; date: string; steps: number; createdAt: string }>();
  return (r.results ?? []).map((x) => ({
    userId: x.accountId,
    date: x.date,
    steps: x.steps,
    createdAt: new Date(x.createdAt),
  }));
}

// ---------- water logs ----------

export async function addWater(db: DB, userId: number, date: string, deltaMl: number): Promise<number> {
  await db
    .prepare(
      `INSERT INTO v2_water_logs (accountId, date, ml, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET ml = MAX(0, ml + ?)`,
    )
    .bind(userId, date, Math.max(0, deltaMl), nowIso(), deltaMl)
    .run();
  return (await getWater(db, userId, date)) ?? 0;
}

export async function setWater(db: DB, userId: number, date: string, ml: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_water_logs (accountId, date, ml, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET ml = excluded.ml`,
    )
    .bind(userId, date, Math.max(0, ml), nowIso())
    .run();
}

export async function getWater(db: DB, userId: number, date: string): Promise<number | null> {
  const r = await db
    .prepare("SELECT ml FROM v2_water_logs WHERE accountId = ? AND date = ?")
    .bind(userId, date)
    .first<{ ml: number }>();
  return r ? r.ml : null;
}

/** Daily water totals in [cutoff, today], ascending. Used for challenge progress. */
export async function waterLogsSince(db: DB, userId: number, cutoff: string): Promise<{ date: string; ml: number }[]> {
  const r = await db
    .prepare("SELECT date, ml FROM v2_water_logs WHERE accountId = ? AND date >= ? ORDER BY date ASC")
    .bind(userId, cutoff)
    .all<{ date: string; ml: number }>();
  return r.results ?? [];
}

// ---------- injuries ----------

interface InjuryRow {
  id: number; accountId: number; area: string; severity: string; status: string;
  reportedAt: string; checkAfter: string; lastAskedAt: string | null; swaps: string; resolvedAt: string | null;
  checkinsHistory?: string | null;
}
function toInjury(r: InjuryRow): InjuryDoc {
  let swaps: InjuryDoc["swaps"] = [];
  try { swaps = JSON.parse(r.swaps || "[]"); } catch { swaps = []; }
  let checkinsHistory: InjuryDoc["checkinsHistory"] = [];
  try { checkinsHistory = JSON.parse(r.checkinsHistory || "[]"); } catch { checkinsHistory = []; }
  return {
    id: r.id, userId: r.accountId, area: r.area, severity: r.severity,
    status: r.status === "recovered" ? "recovered" : "active",
    reportedAt: r.reportedAt, checkAfter: r.checkAfter, lastAskedAt: r.lastAskedAt, swaps, resolvedAt: r.resolvedAt,
    checkinsHistory,
  };
}

// Append a pain check-in (date + 0..10 score) to an active injury's history.
export async function appendInjuryCheckin(db: DB, id: number, entry: { date: string; score: number }): Promise<void> {
  const inj = await getInjury(db, id);
  if (!inj) return;
  // Idempotency: if a check-in for that same date already exists, replace the score instead of duplicating.
  const rest = inj.checkinsHistory.filter((h) => h.date !== entry.date);
  const next = [...rest, entry].sort((a, b) => a.date.localeCompare(b.date));
  await db.prepare("UPDATE v2_injuries SET checkinsHistory = ? WHERE id = ?").bind(JSON.stringify(next), id).run();
}

export async function createInjury(
  db: DB,
  inj: { userId: number; area: string; severity: string; checkAfter: string; swaps: InjuryDoc["swaps"] },
): Promise<number> {
  const now = nowIso();
  const r = await db
    .prepare("INSERT INTO v2_injuries (accountId, area, severity, status, reportedAt, checkAfter, swaps) VALUES (?, ?, ?, 'active', ?, ?, ?) RETURNING id")
    .bind(inj.userId, inj.area, inj.severity, now, inj.checkAfter, JSON.stringify(inj.swaps))
    .first<{ id: number }>();
  return r?.id ?? 0;
}

export async function getInjury(db: DB, id: number): Promise<InjuryDoc | null> {
  const r = await db.prepare("SELECT * FROM v2_injuries WHERE id = ?").bind(id).first<InjuryRow>();
  return r ? toInjury(r) : null;
}

export async function listActiveInjuries(db: DB, userId: number): Promise<InjuryDoc[]> {
  const r = await db.prepare("SELECT * FROM v2_injuries WHERE accountId = ? AND status = 'active' ORDER BY id DESC").bind(userId).all<InjuryRow>();
  return (r.results ?? []).map(toInjury);
}

export async function getActiveInjuryByArea(db: DB, userId: number, area: string): Promise<InjuryDoc | null> {
  const r = await db.prepare("SELECT * FROM v2_injuries WHERE accountId = ? AND area = ? AND status = 'active'").bind(userId, area).first<InjuryRow>();
  return r ? toInjury(r) : null;
}

/** Active injuries whose follow-up is due and not yet asked today. */
export async function listInjuriesDue(db: DB, userId: number, today: string): Promise<InjuryDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_injuries WHERE accountId = ? AND status = 'active' AND checkAfter <= ? AND (lastAskedAt IS NULL OR lastAskedAt != ?)")
    .bind(userId, today, today)
    .all<InjuryRow>();
  return (r.results ?? []).map(toInjury);
}

export async function updateInjury(
  db: DB,
  id: number,
  fields: { area: string; severity: string; checkAfter: string; swaps: InjuryDoc["swaps"] },
): Promise<void> {
  await db
    .prepare("UPDATE v2_injuries SET area = ?, severity = ?, status = 'active', reportedAt = ?, checkAfter = ?, lastAskedAt = NULL, swaps = ?, resolvedAt = NULL WHERE id = ?")
    .bind(fields.area, fields.severity, nowIso(), fields.checkAfter, JSON.stringify(fields.swaps), id)
    .run();
}

export async function markInjuryAsked(db: DB, id: number, today: string): Promise<void> {
  await db.prepare("UPDATE v2_injuries SET lastAskedAt = ? WHERE id = ?").bind(today, id).run();
}

export async function extendInjury(db: DB, id: number, checkAfter: string): Promise<void> {
  await db.prepare("UPDATE v2_injuries SET checkAfter = ?, lastAskedAt = NULL WHERE id = ?").bind(checkAfter, id).run();
}

export async function resolveInjury(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE v2_injuries SET status = 'recovered', resolvedAt = ? WHERE id = ?").bind(nowIso(), id).run();
}

// ---------- daily check-ins (subjective wellbeing) ----------

export async function recordDailyCheckin(
  db: DB,
  userId: number,
  date: string,
  energy: number,
  sleep: number,
  stress: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_wellbeing (accountId, date, energy, sleep, stress, createdAt) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET energy = excluded.energy, sleep = excluded.sleep, stress = excluded.stress`,
    )
    .bind(userId, date, energy, sleep, stress, nowIso())
    .run();
}

export async function getDailyCheckin(db: DB, userId: number, date: string): Promise<DailyCheckinDoc | null> {
  const r = await db
    .prepare("SELECT accountId, date, energy, sleep, stress, createdAt FROM v2_wellbeing WHERE accountId = ? AND date = ?")
    .bind(userId, date)
    .first<{ accountId: number; date: string; energy: number; sleep: number; stress: number; createdAt: string }>();
  return r ? { userId: r.accountId, date: r.date, energy: r.energy, sleep: r.sleep, stress: r.stress, createdAt: new Date(r.createdAt) } : null;
}

export async function dailyCheckinsSince(db: DB, userId: number, cutoff: string): Promise<DailyCheckinDoc[]> {
  const r = await db
    .prepare("SELECT accountId, date, energy, sleep, stress, createdAt FROM v2_wellbeing WHERE accountId = ? AND date >= ? ORDER BY date")
    .bind(userId, cutoff)
    .all<{ accountId: number; date: string; energy: number; sleep: number; stress: number; createdAt: string }>();
  return (r.results ?? []).map((x) => ({ userId: x.accountId, date: x.date, energy: x.energy, sleep: x.sleep, stress: x.stress, createdAt: new Date(x.createdAt) }));
}

// ---------------- progress photos (Mini App gallery; bytes proxied via /api/photo) ----------------

export interface ProgressPhotoRow { id: number; userId: number; fileId: string; takenAt: string }

interface V2ProgressPhotoRow { id: number; accountId: number; legacyFileId: string; takenAt: string }
function toProgressPhoto(r: V2ProgressPhotoRow): ProgressPhotoRow {
  return { id: r.id, userId: r.accountId, fileId: r.legacyFileId, takenAt: r.takenAt };
}

export async function addProgressPhoto(db: DB, userId: number, fileId: string): Promise<void> {
  await db.prepare("INSERT INTO v2_progress_photos (accountId, legacyFileId, takenAt) VALUES (?, ?, ?)").bind(userId, fileId, nowIso()).run();
}

export async function listProgressPhotos(db: DB, userId: number, limit = 24): Promise<ProgressPhotoRow[]> {
  const r = await db
    .prepare("SELECT id, accountId, legacyFileId, takenAt FROM v2_progress_photos WHERE accountId = ? ORDER BY takenAt DESC LIMIT ?")
    .bind(userId, limit)
    .all<V2ProgressPhotoRow>();
  return (r.results ?? []).map(toProgressPhoto);
}

export async function getProgressPhoto(db: DB, id: number): Promise<ProgressPhotoRow | null> {
  const r = await db.prepare("SELECT id, accountId, legacyFileId, takenAt FROM v2_progress_photos WHERE id = ?").bind(id).first<V2ProgressPhotoRow>();
  return r ? toProgressPhoto(r) : null;
}
