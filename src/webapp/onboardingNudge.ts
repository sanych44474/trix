// "Finish your onboarding" push, shared by the trainer's client card (webapp/trainerApi.ts) and the
// owner console roster (webapp/ownerApi.ts). Mirrors the bot's cl:*:intvping action: resume the AI
// interview at its last question if one is in progress, else put the person back into the button
// wizard at the first unanswered step. Returns false (no message) when they're already onboarded.
import { updateUser } from "../adapters/d1/v2Users";
import { escapeHtml, t } from "../locales/i18n";
import { obKeyboard, obProgress, obSteps } from "../bot/onboarding";
import { onboardingAppMarkup, onboardingUrlFromEnv } from "../bot/onboardingApp";
import type { Env, UserDoc } from "../types";

type PromptKey = "cc_intv_remind_text" | "owner_intv_remind_text";

async function tgSend(env: Env, chatId: number, text: string, replyMarkup?: unknown): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  }).catch(() => null);
  return !!res?.ok;
}

export async function nudgeOnboarding(env: Env, target: UserDoc, promptKey: PromptKey): Promise<{ sent: boolean; alreadyOnboarded?: boolean }> {
  if (target.onboarded) return { sent: false, alreadyOnboarded: true };
  const prefix = t(target.lang, promptKey);
  const appUrl = onboardingUrlFromEnv(env);
  if (appUrl) {
    await updateUser(env.DB, target._id, { session: { mode: "onboarding", step: 0 } });
    return { sent: await tgSend(env, target.chatId, `${prefix}\n\n${t(target.lang, "ob_app_prompt")}`, onboardingAppMarkup(target.lang, appUrl)) };
  }
  const transcript = target.session.transcript;
  if (target.session.mode === "onboarding" && transcript?.length) {
    const lastQ = [...transcript].reverse().find((entry) => entry.role === "assistant");
    return { sent: await tgSend(env, target.chatId, `${prefix}\n\n${escapeHtml(lastQ?.text ?? "")}`.trim()) };
  }
  const step = target.session.mode === "onboarding" && typeof target.session.step === "number" ? target.session.step : obProgress(target.profile).next;
  await updateUser(env.DB, target._id, { session: { mode: "onboarding", step } });
  const steps = obSteps(target.lang);
  const idx = Math.max(0, Math.min(step, steps.length - 1));
  const stepDef = steps[idx]!;
  const text = `${prefix}\n\n(${idx + 1}/${steps.length}) ${t(target.lang, stepDef.q)}`;
  return { sent: await tgSend(env, target.chatId, text, obKeyboard(target.lang, stepDef, target.profile.trainingWeekdays ?? [], idx > 0)) };
}
