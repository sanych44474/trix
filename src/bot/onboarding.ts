// The owner-triggered "finish your questionnaire" ping (ADR-0012 keeps it). The chat onboarding
// wizard that lived here was retired with the chat: the questionnaire is the app's.
import { pingOther } from "../notify/notify";
import { onboardingAppMarkup, onboardingUrlFromEnv } from "../notify/onboardingApp";
import { InlineKeyboard } from "grammy";
import { listIncompleteOnboarding, updateUser } from "../adapters/d1/v2Users";
import { escapeHtml, t } from "../locales/i18n";
import type { Env } from "../types";
import { obKeyboard, obProgress, obSteps } from "../features/onboarding/questions";


// One-off "finish your interview" ping to every non-onboarded reachable user (owner-triggered,
// ctx-free). Resumes at the right place: AI-interview users get their last question re-sent;
// button-wizard users get their current step WITH its keyboard (so they can just tap).
export async function pingIncompleteOnboarding(env: Env, db: D1Database): Promise<{ pinged: number; total: number }> {
  const users = await listIncompleteOnboarding(db);
  let pinged = 0;
  for (const u of users) {
    try {
      const prefix = t(u.lang, "ob_resume_nudge");
      const transcript = u.session?.transcript;
      let text: string;
      let reply_markup: InlineKeyboard | ReturnType<typeof onboardingAppMarkup> | undefined;
      const appUrl = onboardingUrlFromEnv(env);
      if (appUrl) {
        // The questionnaire lives in the Mini App: one button, it resumes from the saved draft.
        text = `${prefix}\n\n${t(u.lang, "ob_app_prompt")}`;
        reply_markup = onboardingAppMarkup(u.lang, appUrl);
        await updateUser(db, u._id, { session: { mode: "onboarding", step: 0 } });
      } else if (u.session?.mode === "onboarding" && transcript?.length) {
        const lastQ = [...transcript].reverse().find((m) => m.role === "assistant");
        text = `${prefix}\n\n${escapeHtml(lastQ?.text ?? "")}`.trim();
        // Keep them in the interview so their reply advances it (mode may have drifted).
        await updateUser(db, u._id, { session: { mode: "onboarding", transcript } });
      } else {
        const steps = obSteps(u.lang);
        const raw = u.session?.mode === "onboarding" && typeof u.session.step === "number" ? u.session.step : obProgress(u.profile).next;
        const idx = Math.max(0, Math.min(raw, steps.length - 1));
        const step = steps[idx];
        text = `${prefix}\n\n(${idx + 1}/${steps.length}) ${t(u.lang, step.q)}`;
        reply_markup = obKeyboard(u.lang, step, u.profile.trainingWeekdays ?? [], idx > 0);
        // CRITICAL: put the session back into the wizard at this step, or their typed answer
        // routes to whatever stale mode they were in (e.g. msg_trainer) and never onboards.
        await updateUser(db, u._id, { session: { mode: "onboarding", step: idx } });
      }
      if (await pingOther(env, u.chatId, text, reply_markup)) pinged++;
    } catch (err) {
      console.error("pingIncompleteOnboarding", u._id, err);
    }
  }
  return { pinged, total: users.length };
}
