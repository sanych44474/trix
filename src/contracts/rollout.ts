import type { Env } from "../types";

/** Deterministic cohort gate: the same account stays in the same rollout bucket. */
export function v2CohortEnabled(env: Env, userId: number): boolean {
  if (env.V2_DUAL_WRITE === "1") return true;
  const internal = (env.V2_INTERNAL_USER_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (internal.includes(userId)) return true;
  const percent = Math.max(0, Math.min(100, Number(env.V2_COHORT_PERCENT ?? "0")));
  if (!Number.isFinite(percent) || percent <= 0) return false;
  if (percent >= 100) return true;
  return Math.abs(userId) % 100 < percent;
}
