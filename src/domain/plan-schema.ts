// Canonical runtime shape for PlanDoc — validates AI output and D1 rows so a corrupted or
// malformed plan fails loudly (PlanValidationError) instead of silently degrading to an empty
// split/nutrition default. See plan-lint.ts for the domain-rule layer on top of this shape check.
import { z } from "zod";
import type { PlanDoc } from "../types";

/** Bump when PlanDoc's shape changes in a way old stored rows won't satisfy. Stored per-row in
 * plans.schemaVersion; existing rows predate versioning and are backfilled to 1 (migration 0065). */
export const PLAN_SCHEMA_VERSION = 1;

const weightModeSchema = z.enum(["perSide", "perHand"]);
const exerciseMetricSchema = z.enum(["reps", "time", "distance"]);
const exerciseRoleSchema = z.enum(["primary", "accessory"]);

const planExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.string(),
  startWeight: z.string(),
  technique: z.string(),
  isKeyLift: z.boolean().optional(),
  metric: exerciseMetricSchema.optional(),
  muscles: z.string().optional(),
  exerciseId: z.string().optional(),
  canonicalName: z.string().optional(),
  rpe: z.string().optional(),
  rir: z.string().optional(),
  weightMode: weightModeSchema.optional(),
  rest: z.string().optional(),
  tempo: z.string().optional(),
  heartRateZone: z.string().optional(),
  movementPattern: z.string().optional(),
  role: exerciseRoleSchema.optional(),
  warmupScheme: z.string().optional(),
  supersetGroup: z.string().optional(),
});

// Weekday is 1=Mon..7=Sun (see types.ts), not 0-indexed.
const weekdaySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]);

export const planDaySchema = z.object({
  weekday: weekdaySchema,
  muscleGroup: z.string(),
  exercises: z.array(planExerciseSchema),
  sessionType: z.string().optional(),
  durationMin: z.number().optional(),
  warmUp: z.array(z.string()).optional(),
  coolDown: z.array(z.string()).optional(),
});

const nutritionTargetsSchema = z.object({
  calories: z.number().finite(),
  protein: z.number().finite(),
  fats: z.number().finite(),
  carbs: z.number().finite(),
  notes: z.string().optional(),
});

const supplementSchema = z.object({
  name: z.string(),
  dose: z.string(),
  when: z.string(),
  effect: z.string(),
});

// mesocycle is an opt-in overlay owned by domain/mesocycle.ts — validated structurally as a
// loose record here rather than duplicating its schema, so this file doesn't have to track it.
const mesocycleSchema = z.record(z.string(), z.unknown()).optional();

export const planDocSchema = z.object({
  userId: z.number(),
  active: z.boolean(),
  status: z.enum(["draft", "active"]),
  authoredBy: z.number().optional(),
  split: z.array(planDaySchema),
  nutrition: nutritionTargetsSchema,
  supplements: z.array(supplementSchema),
  methodology: z.string(),
  generatedAt: z.date(),
  schemaVersion: z.number().int().min(1).default(PLAN_SCHEMA_VERSION),
  stepsTarget: z.number().optional(),
  restDayNutrition: nutritionTargetsSchema.optional(),
  movementAudit: z.string().optional(),
  deloadInterval: z.number().optional(),
  mesocycle: mesocycleSchema,
});

// ---- Raw AI plan response (pre-normalization) ----
// The provider-facing JSON schema (ai/prompts.ts PLAN_SCHEMA) is a separate, Gemini-dialect
// description of this same shape and isn't derived from this file — that convergence is out of
// scope here (touches the AI provider call, a separately-risky change). This schema instead
// replaces bot.ts's old `AiPlan` interface: what the AI is contractually expected to return,
// looser than PlanDoc/PlanDay/PlanExercise (e.g. `metric` unconstrained) because
// aiSplitToPlanDays (bot/plan.ts) is the normalization step that tightens it into a PlanDay[].

const aiPlanExerciseSchema = z.object({
  name: z.string(),
  sets: z.string(),
  startWeight: z.string(),
  technique: z.string(),
  muscles: z.string().optional(),
  isKeyLift: z.boolean().optional(),
  metric: z.string().optional(),
  exerciseId: z.string().optional(),
  canonicalName: z.string().optional(),
  rpe: z.string().optional(),
  rir: z.string().optional(),
  rest: z.string().optional(),
  tempo: z.string().optional(),
  heartRateZone: z.string().optional(),
  movementPattern: z.string().optional(),
  role: z.string().optional(),
  warmupScheme: z.string().optional(),
  supersetGroup: z.string().optional(),
});

const aiPlanDaySchema = z.object({
  weekday: z.number(),
  muscleGroup: z.string(),
  sessionType: z.string().optional(),
  durationMin: z.number().optional(),
  warmUp: z.array(z.string()).optional(),
  coolDown: z.array(z.string()).optional(),
  exercises: z.array(aiPlanExerciseSchema),
});

export const aiPlanResponseSchema = z.object({
  split: z.array(aiPlanDaySchema),
  nutrition: nutritionTargetsSchema,
  restDayNutrition: nutritionTargetsSchema.optional(),
  supplements: z.array(supplementSchema),
  methodology: z.string(),
  movementAudit: z.string().optional(),
  stepsTarget: z.number().optional(),
});

export type AiPlanResponse = z.infer<typeof aiPlanResponseSchema>;

const planSplitSchema = z.array(planDaySchema);

export class PlanValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = "PlanValidationError";
  }
}

/** Validates a candidate plan shape (D1 row after JSON.parse, or AI output). Throws
 * PlanValidationError — never silently substitutes an empty split/default nutrition, so a
 * corrupted stored row surfaces as an error the caller must handle, not a blank plan.
 * Cast to PlanDoc rather than returning the inferred type: identical except `mesocycle`, which
 * is validated here as a loose record (see mesocycleSchema above) rather than domain/mesocycle's
 * full Mesocycle shape. */
export function parsePlanDoc(raw: unknown): PlanDoc {
  const result = planDocSchema.safeParse(raw);
  if (!result.success) {
    throw new PlanValidationError("Plan failed schema validation", result.error.issues);
  }
  return result.data as unknown as PlanDoc;
}

/** Validates the AI provider's raw JSON plan response before it's normalized into a PlanDay[]
 * (aiSplitToPlanDays) and assembled into a PlanDoc. Throws PlanValidationError on a malformed
 * response instead of the caller's old ad-hoc field checks silently missing new gaps. */
export function parseAiPlanResponse(raw: unknown): AiPlanResponse {
  const result = aiPlanResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new PlanValidationError("AI plan response failed schema validation", result.error.issues);
  }
  return result.data;
}

/** Validates a bare split array — used by updateDraftSplit/updateActivePlanSplit (trainer split
 * edits), which write `split` alone rather than a full PlanDoc. Throws PlanValidationError. */
export function parsePlanSplit(raw: unknown): PlanDoc["split"] {
  const result = planSplitSchema.safeParse(raw);
  if (!result.success) {
    throw new PlanValidationError("Plan split failed schema validation", result.error.issues);
  }
  return result.data as unknown as PlanDoc["split"];
}
