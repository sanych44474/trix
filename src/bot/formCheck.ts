// Form check: the user sends a short video of a set (a regular video or a round video note) and
// the AI coach watches it and answers with 2–3 concrete technique remarks. Only Gemini accepts
// inline video in the provider chain (ai/index.ts filters the rest out), the clip must fit its
// inline request limit, and each user gets a few checks a day -- video is the costliest AI call
// the bot makes. The remarks are coaching cues, never a diagnosis; the prompt says so.
import { awardAchievement } from "../adapters/d1/v2Gamification";
import type { Lang } from "../types";
import { aiVisionText } from "../ai/index";
import { cleanAi, t } from "../locales/i18n";
import { type MyContext, reply } from "../adapters/telegram/context";
import { deferAi } from "../features/aiDefer";
import { abToB64, downloadFile } from "../adapters/telegram/files";
import { FORM_CHECKS_PER_DAY, MAX_VIDEO_BYTES, MAX_VIDEO_SEC, aiCallsToday, formCheckGate, formCheckPrompt, formCheckSystem } from "../features/workout/formCheck";

/** The form-check answer under its header and footer; the empty-answer text when the AI gave none. */
function formCheckReply(lang: Lang, answer: string): string | null {
  const text = cleanAi(answer).trim().slice(0, 1200);
  return text ? `${t(lang, "form_check_header")}\n\n${text}\n\n${t(lang, "form_check_footer")}` : null;
}

export async function handleFormVideo(ctx: MyContext, video: { fileId: string; bytes?: number; seconds?: number; mimeType?: string }): Promise<void> {
  const lang = ctx.user.lang;
  if (!ctx.user.onboarded) {
    await reply(ctx, t(lang, "not_onboarded"));
    return;
  }
  const gate = formCheckGate(video, await aiCallsToday(ctx.db, ctx.user._id, "form_check"));
  if (gate !== "ok") {
    await reply(ctx, t(lang, `form_check_${gate}`, { n: FORM_CHECKS_PER_DAY, sec: MAX_VIDEO_SEC }));
    return;
  }
  await reply(ctx, t(lang, "form_check_watching"));
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "form_check", async () => {
    const data = await downloadFile(ctx, video.fileId);
    if (data.byteLength > MAX_VIDEO_BYTES) {
      await reply(ctx, t(lang, "form_check_too_big", { n: FORM_CHECKS_PER_DAY, sec: MAX_VIDEO_SEC }));
      return;
    }
    const caption = ctx.message?.caption?.trim();
    const answer = await aiVisionText(ctx.env, {
      system: formCheckSystem(lang),
      user: formCheckPrompt(caption),
      images: [{ mimeType: video.mimeType?.startsWith("video/") ? video.mimeType : "video/mp4", dataBase64: abToB64(data) }],
      temperature: 0.3,
      kind: "form_check",
      db: ctx.db,
      userId: ctx.user._id,
      onPartial: (so) => ctx.thinking?.update(cleanAi(so)),
    });
    const text = formCheckReply(lang, answer);
    await reply(ctx, text ?? t(lang, "form_check_failed"));
    if (text) await awardAchievement(ctx.db, ctx.user._id, "form_check_first").catch(() => {});
  });
}
