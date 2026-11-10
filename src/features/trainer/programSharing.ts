// Program sharing for the app (webapp/trainerApi.ts): who may share, activating a plan for a
// client, publishing to the library and turning a plan into a bank entry. The chat flows that
// also lived here (share menus, links, taking a shared program) were retired with ADR-0012.
import type { BankPlan, PlanDoc, UserDoc } from "../../types";
import { listStrength } from "../../adapters/d1/v2Workouts";
import { setActivePlan } from "../../adapters/d1/v2Plans";
import { getTrainer } from "../../adapters/d1/v2Trainer";
import { createSharedProgram } from "../../adapters/d1/v2TrainerPrograms";
import { updateUser } from "../../adapters/d1/v2Users";
import { isOwnerOf } from "../owner/ownerAccess";
import type { DB } from "../../adapters/d1/shared";
import { formatRecordBest } from "../../domain/setFormat";
import { shortCode } from "./trainerCommon";

// Ctx-free form of the same gate (the Mini App / native routes call this).
export async function canShareProgramFor(db: DB, user: UserDoc): Promise<boolean> {
  if (await isOwnerOf(db, user)) return true;
  if (user.role !== "trainer") return false;
  const tr = await getTrainer(db, user._id).catch(() => null);
  return !!tr?.isInstructor;
}

// Recent strength PRs as adaptPlan context (the assign and take flows both use it).
export async function recentPrs(db: DB, userId: number): Promise<string | undefined> {
  const records = await listStrength(db, userId, 8).catch(() => []);
  return records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
}

// Make an adapted plan a client's active plan (nutrition is mirrored onto the user doc).
export async function activateClientPlan(db: DB, clientId: number, plan: PlanDoc): Promise<void> {
  await setActivePlan(db, plan);
  await updateUser(db, clientId, { nutrition: plan.nutrition });
}

// Store a shared program and return its code. Library entries are public; link-only are not.
export async function publishProgram(db: DB, ownerId: number, name: string, plan: BankPlan, isPublic: boolean): Promise<string> {
  const code = shortCode();
  await createSharedProgram(db, code, ownerId, name, plan, isPublic);
  return code;
}

// --- Any user: publish their OWN active plan to the public library as a reusable template. ---
export function planToBank(plan: PlanDoc): BankPlan {
  return {
    split: plan.split,
    nutrition: plan.nutrition,
    ...(plan.restDayNutrition ? { restDayNutrition: plan.restDayNutrition } : {}),
    supplements: plan.supplements ?? [],
    methodology: plan.methodology ?? "",
    ...(plan.movementAudit ? { movementAudit: plan.movementAudit } : {}),
    ...(typeof plan.stepsTarget === "number" ? { stepsTarget: plan.stepsTarget } : {}),
  };
}
