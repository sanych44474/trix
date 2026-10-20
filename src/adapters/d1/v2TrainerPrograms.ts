// Trainer program templates and shared programs (share-by-link and the public library).
import type { BankPlan } from "../../types";
import { nowIso, safeJsonParse, type DB } from "./shared";

interface TrainerTemplateMeta {
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
