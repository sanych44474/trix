// Sending onboarding questionnaire steps (question + buttons), into the current chat or into
// another user's chat (a trainer accepting a client).
import { t } from "../../locales/i18n";
import { HTML, reply, type MyContext } from "../../adapters/telegram/context";
import type { Lang, UserDoc } from "../../types";

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
import { obKeyboard, obSteps } from "./questions";

// Push onboarding step i (question + buttons) into an arbitrary chat. Needed when a trainer
// accepts a client — that runs in the trainer's context, so the client must be walked into
// the wizard proactively (otherwise they sit idle, never onboard, get no plan).
export async function sendObStepTo(ctx: MyContext, target: UserDoc, i: number, prefix: string) {
  const steps = obSteps(target.lang);
  const idx = Math.max(0, Math.min(i, steps.length - 1));
  const step = steps[idx];
  await ctx.api
    .sendMessage(target.chatId, `${prefix}\n\n(${idx + 1}/${steps.length}) ${t(target.lang, step.q)}`, {
      ...HTML,
      reply_markup: obKeyboard(target.lang, step, target.profile.trainingWeekdays ?? [], idx > 0),
    })
    .catch(() => {});
}

export async function sendFirstObStep(ctx: MyContext, chatId: number, lang: Lang, prefix: string) {
  const steps = obSteps(lang);
  const step = steps[0];
  await ctx.api
    .sendMessage(chatId, `${prefix}\n\n(1/${steps.length}) ${t(lang, step.q)}`, { ...HTML, reply_markup: obKeyboard(lang, step, []) })
    .catch(() => {});
}
