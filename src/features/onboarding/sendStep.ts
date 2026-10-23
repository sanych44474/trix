// Onboarding questionnaire step shown in the current chat (question + buttons). Sends into another
// user's chat go through the nudge use case (features/onboarding/nudge.ts) instead.
import { t } from "../../locales/i18n";
import { reply, type MyContext } from "../../adapters/telegram/context";
import { obKeyboard, obSteps } from "./questions";

/** Show onboarding step `i` in the current chat. False when there is no such step (the
 *  questionnaire is complete), so the caller can finish onboarding. */
export async function renderObQuestion(ctx: MyContext, i: number): Promise<boolean> {
  const lang = ctx.user.lang;
  const steps = obSteps(lang);
  const step = steps[i];
  if (!step) return false;
  const progress = `(${i + 1}/${steps.length})`;
  await reply(ctx, `${progress} ${t(lang, step.q)}`, obKeyboard(lang, step, ctx.user.profile.trainingWeekdays ?? [], i > 0));
  return true;
}
