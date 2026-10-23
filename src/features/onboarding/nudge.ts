// "Finish your onboarding" nudge: the one use case behind the trainer's client card (bot and Mini
// App) and the owner console roster. Mirrors the cl:*:intvping action: the Mini App link when the
// app is configured, else the AI interview resumed at its last question, else the button wizard at
// the first unanswered step. Sent through the outbox, so it retries, respects "notifications off"
// and an app-only account gets it by push.
import { HTML } from "../../adapters/telegram/context";
import { rawTelegramApi } from "../../adapters/telegram/rawApi";
import { updateUser } from "../../adapters/d1/v2Users";
import { escapeHtml, t } from "../../locales/i18n";
import { isDurable, notify } from "../../notify";
import { onboardingAppMarkup, onboardingUrlFromEnv } from "../../notify/onboardingApp";
import type { Env, UserDoc } from "../../types";
import { obKeyboard, obProgress, obSteps } from "./questions";

export interface NudgeResult {
  /** Delivered or queued for retry. False when nothing new went out (already sent under this key, muted, or failed). */
  sent: boolean;
  alreadyOnboarded?: boolean;
}

/** `prefix` is the already-rendered lead-in line, e.g. "Your trainer asks you to finish your intake." */
export async function nudgeOnboarding(env: Env, target: UserDoc, prefix: string): Promise<NudgeResult> {
  if (target.onboarded) return { sent: false, alreadyOnboarded: true };
  // The key names the position in the questionnaire and the lead-in, so repeating the same nudge
  // at the same point is one message, while a later question (or a new trigger) is a new one.
  const send = async (stage: string, text: string, extra?: unknown): Promise<boolean> => {
    const result = await notify(env, { api: rawTelegramApi(env) }, { userId: target._id, chatId: target.chatId }, {
      kind: "onboarding_nudge",
      key: `onboarding_nudge:${stage}:${prefix}`,
      text,
      extra,
    });
    return isDurable(result) && result !== "muted" && result !== "duplicate";
  };

  const appUrl = onboardingUrlFromEnv(env);
  if (appUrl) {
    await updateUser(env.DB, target._id, { session: { mode: "onboarding", step: 0 } });
    const text = `${prefix}\n\n${t(target.lang, "ob_app_prompt")}`;
    return { sent: await send("app", text, { ...HTML, reply_markup: onboardingAppMarkup(target.lang, appUrl) }) };
  }

  const transcript = target.session.transcript;
  if (target.session.mode === "onboarding" && transcript?.length) {
    const lastQ = [...transcript].reverse().find((entry) => entry.role === "assistant");
    return { sent: await send(`q${transcript.length}`, `${prefix}\n\n${escapeHtml(lastQ?.text ?? "")}`.trim(), HTML) };
  }

  const step = target.session.mode === "onboarding" && typeof target.session.step === "number" ? target.session.step : obProgress(target.profile).next;
  await updateUser(env.DB, target._id, { session: { mode: "onboarding", step } });
  const steps = obSteps(target.lang);
  const idx = Math.max(0, Math.min(step, steps.length - 1));
  const stepDef = steps[idx]!;
  const text = `${prefix}\n\n(${idx + 1}/${steps.length}) ${t(target.lang, stepDef.q)}`;
  return { sent: await send(`step${idx}`, text, { ...HTML, reply_markup: obKeyboard(target.lang, stepDef, target.profile.trainingWeekdays ?? [], idx > 0) }) };
}
