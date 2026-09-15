import { z } from "zod";

export const COACH_ACTION_KINDS = ["add", "delete", "swap", "weight", "sets", "harder", "easier", "none"] as const;
export type CoachActionKind = (typeof COACH_ACTION_KINDS)[number];

export interface CoachAction {
  label: string;
  kind: CoachActionKind;
  weekday?: number;
  index?: number;
  exercise?: string;
  value?: string;
}

const actionSchema = z.object({
  label: z.string().refine((value) => value.trim().length > 0, "label must not be blank").max(60),
  kind: z.enum(COACH_ACTION_KINDS),
  weekday: z.number().int().min(1).max(7).optional(),
  index: z.number().int().min(0).max(50).optional(),
  exercise: z.string().refine((value) => value.trim().length > 0, "exercise must not be blank").max(160).optional(),
  value: z.string().refine((value) => value.trim().length > 0, "value must not be blank").max(80).optional(),
});

const coachEditSchema = z.object({
  reply: z.string().refine((value) => value.trim().length > 0, "reply must not be blank").max(4096),
  actions: z.array(actionSchema).max(4).optional(),
});

function issueText(issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "result"}: ${issue.message}`)
    .join("; ");
}

function validateActionSemantics(action: CoachAction, path: string): void {
  const needsTarget = action.kind === "delete" || action.kind === "swap" || action.kind === "weight" || action.kind === "sets";
  const needsWeekday = needsTarget || action.kind === "add" || action.kind === "harder" || action.kind === "easier";

  if (needsWeekday && action.weekday === undefined) throw new Error(`${path}.weekday is required for ${action.kind}`);
  if (needsTarget && action.index === undefined) throw new Error(`${path}.index is required for ${action.kind}`);
  if (action.kind === "add" && !action.exercise) {
    throw new Error(`${path}.exercise is required for add`);
  }
  if ((action.kind === "weight" || action.kind === "sets") && !action.value) {
    throw new Error(`${path}.value is required for ${action.kind}`);
  }
}

/** Validate the provider output before it can reach Telegram or the user's session state. */
export function validateCoachEditResult(raw: unknown): void {
  const result = coachEditSchema.safeParse(raw);
  if (!result.success) throw new Error(`coach edit output is invalid: ${issueText(result.error.issues)}`);
  for (const [index, action] of (result.data.actions ?? []).entries()) validateActionSemantics(action, `actions[${index}]`);
}

/** Validate a persisted action again at click time; session JSON is not a trust boundary. */
export function validateCoachActionForApply(raw: unknown, callbackKind: string): CoachAction {
  const result = actionSchema.safeParse(raw);
  if (!result.success) throw new Error(`coach action is invalid: ${issueText(result.error.issues)}`);
  if (result.data.kind !== callbackKind) throw new Error("coach action kind does not match callback");
  validateActionSemantics(result.data, "action");
  return result.data;
}
