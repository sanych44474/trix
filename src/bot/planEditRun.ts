// Bot-side seam to the plan-edit module: loads the plan and its owner, applies one PlanEdit, and
// reports a refusal as a code so each editor replies in its own words.
import { getActivePlan } from "../adapters/d1/v2Plans";
import type { PlanChangeSource } from "../adapters/d1/v2PlanHistory";
import { getUser } from "../adapters/d1/v2Users";
import { applyPlanEdit, PlanEditError, type PlanEdit, type PlanEditErrorCode, type PlanEditResult } from "../features/plan/planEdits";
import type { MyContext } from "../adapters/telegram/context";

export type PlanEditOutcome = ({ ok: true } & PlanEditResult) | { ok: false; code: PlanEditErrorCode | "no_plan" };

/** Apply one edit to [ownerId]'s active plan, on behalf of the bot user. */
export async function runPlanEdit(ctx: MyContext, ownerId: number, edit: PlanEdit, source?: PlanChangeSource): Promise<PlanEditOutcome> {
  const plan = await getActivePlan(ctx.db, ownerId);
  if (!plan) return { ok: false, code: "no_plan" };
  const owner = ownerId === ctx.user._id ? ctx.user : await getUser(ctx.db, ownerId);
  if (!owner) return { ok: false, code: "not found" };
  try {
    return { ok: true, ...(await applyPlanEdit({ env: ctx.env, owner, actorId: ctx.user._id, plan, source }, edit)) };
  } catch (err) {
    if (err instanceof PlanEditError) return { ok: false, code: err.code };
    throw err;
  }
}
