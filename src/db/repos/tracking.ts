// Body/activity tracking: bodyweight & measurements, steps, water, challenges, injuries, daily
// wellbeing check-ins, and progress photos. Split out of repos.ts (god-file split, same barrel
// seam); behavior unchanged.
import type { BodyLogDoc, BodyMeasurements, DailyCheckinDoc, InjuryDoc, StepLogDoc } from "../../types";
import { nowIso, type DB } from "./shared";

// ---------- body logs ----------

interface BodyRow {
  userId: number;
  date: string;
  weight: number | null;
  measurements: string | null;
  createdAt: string;
}

function toBody(r: BodyRow): BodyLogDoc {
  return {
    userId: r.userId,
    date: r.date,
    weight: r.weight ?? undefined,
    measurements: r.measurements ? JSON.parse(r.measurements) : undefined,
    createdAt: new Date(r.createdAt),
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
    .prepare("INSERT OR IGNORE INTO body_logs (userId, date, weight, measurements, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, date, weight ?? null, measurements ? JSON.stringify(measurements) : null, nowIso())
    .run();
}

export async function upsertBodyLog(
  db: DB,
  userId: number,
  date: string,
  patch: { weight?: number; measurements?: BodyMeasurements },
): Promise<void> {
  const row = await db
    .prepare("SELECT weight, measurements FROM body_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ weight: number | null; measurements: string | null }>();
  if (row) {
    const newWeight = patch.weight !== undefined ? patch.weight : row.weight;
    const existing = row.measurements ? (JSON.parse(row.measurements) as BodyMeasurements) : {};
    const newMeas = patch.measurements ? { ...existing, ...patch.measurements } : existing;
    await db
      .prepare("UPDATE body_logs SET weight = ?, measurements = ? WHERE userId = ? AND date = ?")
      .bind(newWeight ?? null, Object.keys(newMeas).length ? JSON.stringify(newMeas) : null, userId, date)
      .run();
  } else {
    await db
      .prepare("INSERT INTO body_logs (userId, date, weight, measurements, createdAt) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, date, patch.weight ?? null, patch.measurements ? JSON.stringify(patch.measurements) : null, nowIso())
      .run();
  }
}

export async function bodyLogsByUser(db: DB, userId: number): Promise<BodyLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM body_logs WHERE userId = ? ORDER BY date ASC")
    .bind(userId)
    .all<BodyRow>();
  return (r.results ?? []).map(toBody);
}

// ---------- step logs ----------

export async function upsertStepLog(db: DB, userId: number, date: string, steps: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO step_logs (userId, date, steps, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET steps = excluded.steps`,
    )
    .bind(userId, date, steps, nowIso())
    .run();
}

export async function getStepLog(db: DB, userId: number, date: string): Promise<number | null> {
  const r = await db
    .prepare("SELECT steps FROM step_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ steps: number }>();
  return r ? r.steps : null;
}

export async function stepLogsSince(db: DB, userId: number, cutoff: string): Promise<StepLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM step_logs WHERE userId = ? AND date >= ? ORDER BY date ASC")
    .bind(userId, cutoff)
    .all<{ userId: number; date: string; steps: number; createdAt: string }>();
  return (r.results ?? []).map((x) => ({
    userId: x.userId,
    date: x.date,
    steps: x.steps,
    createdAt: new Date(x.createdAt),
  }));
}

// ---------- water logs ----------

export async function addWater(db: DB, userId: number, date: string, deltaMl: number): Promise<number> {
  await db
    .prepare(
      `INSERT INTO water_logs (userId, date, ml, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET ml = MAX(0, ml + ?)`,
    )
    .bind(userId, date, Math.max(0, deltaMl), nowIso(), deltaMl)
    .run();
  return (await getWater(db, userId, date)) ?? 0;
}

export async function setWater(db: DB, userId: number, date: string, ml: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO water_logs (userId, date, ml, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET ml = excluded.ml`,
    )
    .bind(userId, date, Math.max(0, ml), nowIso())
    .run();
}

export async function getWater(db: DB, userId: number, date: string): Promise<number | null> {
  const r = await db
    .prepare("SELECT ml FROM water_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ ml: number }>();
  return r ? r.ml : null;
}

/** Daily water totals in [cutoff, today], ascending. Used for challenge progress. */
export async function waterLogsSince(db: DB, userId: number, cutoff: string): Promise<{ date: string; ml: number }[]> {
  const r = await db
    .prepare("SELECT date, ml FROM water_logs WHERE userId = ? AND date >= ? ORDER BY date ASC")
    .bind(userId, cutoff)
    .all<{ date: string; ml: number }>();
  return r.results ?? [];
}

// ---------- challenges ----------

export async function joinChallenge(db: DB, userId: number, code: string, startDate: string, endDate: string): Promise<void> {
  await db
    .prepare("INSERT INTO challenges (userId, code, startDate, endDate, joinedAt) VALUES (?, ?, ?, ?, ?)")
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
    .prepare("SELECT id, userId, code, startDate, endDate, completedAt FROM challenges WHERE userId = ? AND completedAt IS NULL AND endDate >= ? ORDER BY id ASC")
    .bind(userId, today)
    .all<ChallengeRow>();
  return r.results ?? [];
}

/** Codes the user currently has an open (not-yet-ended, not-completed) challenge for. */
export async function activeChallengeCodes(db: DB, userId: number, today: string): Promise<Set<string>> {
  return new Set((await activeChallenges(db, userId, today)).map((c) => c.code));
}

export async function markChallengeDone(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE challenges SET completedAt = ? WHERE id = ? AND completedAt IS NULL").bind(nowIso(), id).run();
}

export async function countCompletedChallenges(db: DB, userId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM challenges WHERE userId = ? AND completedAt IS NOT NULL")
    .bind(userId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// ---------- injuries ----------

interface InjuryRow {
  id: number; userId: number; area: string; severity: string; status: string;
  reportedAt: string; checkAfter: string; lastAskedAt: string | null; swaps: string; resolvedAt: string | null;
  // NOTE: column added by migration 0046. Older rows read as NULL → treat as empty array.
  checkinsHistory?: string | null;
}
function toInjury(r: InjuryRow): InjuryDoc {
  let swaps: InjuryDoc["swaps"] = [];
  try { swaps = JSON.parse(r.swaps || "[]"); } catch { swaps = []; }
  let checkinsHistory: InjuryDoc["checkinsHistory"] = [];
  try { checkinsHistory = JSON.parse(r.checkinsHistory || "[]"); } catch { checkinsHistory = []; }
  return {
    id: r.id, userId: r.userId, area: r.area, severity: r.severity,
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
  await db.prepare("UPDATE injuries SET checkinsHistory = ? WHERE id = ?").bind(JSON.stringify(next), id).run();
}

export async function createInjury(
  db: DB,
  inj: { userId: number; area: string; severity: string; checkAfter: string; swaps: InjuryDoc["swaps"] },
): Promise<number> {
  const now = nowIso();
  const r = await db
    .prepare("INSERT INTO injuries (userId, area, severity, status, reportedAt, checkAfter, swaps) VALUES (?, ?, ?, 'active', ?, ?, ?) RETURNING id")
    .bind(inj.userId, inj.area, inj.severity, now, inj.checkAfter, JSON.stringify(inj.swaps))
    .first<{ id: number }>();
  return r?.id ?? 0;
}

export async function getInjury(db: DB, id: number): Promise<InjuryDoc | null> {
  const r = await db.prepare("SELECT * FROM injuries WHERE id = ?").bind(id).first<InjuryRow>();
  return r ? toInjury(r) : null;
}

export async function listActiveInjuries(db: DB, userId: number): Promise<InjuryDoc[]> {
  const r = await db.prepare("SELECT * FROM injuries WHERE userId = ? AND status = 'active' ORDER BY id DESC").bind(userId).all<InjuryRow>();
  return (r.results ?? []).map(toInjury);
}

export async function getActiveInjuryByArea(db: DB, userId: number, area: string): Promise<InjuryDoc | null> {
  const r = await db.prepare("SELECT * FROM injuries WHERE userId = ? AND area = ? AND status = 'active'").bind(userId, area).first<InjuryRow>();
  return r ? toInjury(r) : null;
}

/** Active injuries whose follow-up is due and not yet asked today. */
export async function listInjuriesDue(db: DB, userId: number, today: string): Promise<InjuryDoc[]> {
  const r = await db
    .prepare("SELECT * FROM injuries WHERE userId = ? AND status = 'active' AND checkAfter <= ? AND (lastAskedAt IS NULL OR lastAskedAt != ?)")
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
    .prepare("UPDATE injuries SET area = ?, severity = ?, status = 'active', reportedAt = ?, checkAfter = ?, lastAskedAt = NULL, swaps = ?, resolvedAt = NULL WHERE id = ?")
    .bind(fields.area, fields.severity, nowIso(), fields.checkAfter, JSON.stringify(fields.swaps), id)
    .run();
}

export async function markInjuryAsked(db: DB, id: number, today: string): Promise<void> {
  await db.prepare("UPDATE injuries SET lastAskedAt = ? WHERE id = ?").bind(today, id).run();
}

export async function extendInjury(db: DB, id: number, checkAfter: string): Promise<void> {
  await db.prepare("UPDATE injuries SET checkAfter = ?, lastAskedAt = NULL WHERE id = ?").bind(checkAfter, id).run();
}

export async function resolveInjury(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE injuries SET status = 'recovered', resolvedAt = ? WHERE id = ?").bind(nowIso(), id).run();
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
      `INSERT INTO daily_checkins (userId, date, energy, sleep, stress, createdAt) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET energy = excluded.energy, sleep = excluded.sleep, stress = excluded.stress`,
    )
    .bind(userId, date, energy, sleep, stress, nowIso())
    .run();
}

export async function getDailyCheckin(db: DB, userId: number, date: string): Promise<DailyCheckinDoc | null> {
  const r = await db
    .prepare("SELECT * FROM daily_checkins WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ userId: number; date: string; energy: number; sleep: number; stress: number; createdAt: string }>();
  return r ? { ...r, createdAt: new Date(r.createdAt) } : null;
}

export async function dailyCheckinsSince(db: DB, userId: number, cutoff: string): Promise<DailyCheckinDoc[]> {
  const r = await db
    .prepare("SELECT * FROM daily_checkins WHERE userId = ? AND date >= ? ORDER BY date")
    .bind(userId, cutoff)
    .all<{ userId: number; date: string; energy: number; sleep: number; stress: number; createdAt: string }>();
  return (r.results ?? []).map((x) => ({ ...x, createdAt: new Date(x.createdAt) }));
}

// ---------------- progress photos (Mini App gallery; bytes proxied via /api/photo) ----------------

export interface ProgressPhotoRow { id: number; userId: number; fileId: string; takenAt: string }

export async function addProgressPhoto(db: DB, userId: number, fileId: string): Promise<void> {
  await db.prepare("INSERT INTO progress_photos (userId, fileId, takenAt) VALUES (?, ?, ?)").bind(userId, fileId, nowIso()).run();
}

export async function listProgressPhotos(db: DB, userId: number, limit = 24): Promise<ProgressPhotoRow[]> {
  const r = await db
    .prepare("SELECT id, userId, fileId, takenAt FROM progress_photos WHERE userId = ? ORDER BY takenAt DESC LIMIT ?")
    .bind(userId, limit)
    .all<ProgressPhotoRow>();
  return r.results ?? [];
}

export async function getProgressPhoto(db: DB, id: number): Promise<ProgressPhotoRow | null> {
  return (await db.prepare("SELECT id, userId, fileId, takenAt FROM progress_photos WHERE id = ?").bind(id).first<ProgressPhotoRow>()) ?? null;
}
