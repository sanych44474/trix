// Form check: the user sends a short video of a set (a regular video or a round video note) and
// the AI coach watches it and answers with 2–3 concrete technique remarks. Only Gemini accepts
// inline video in the provider chain (ai/index.ts filters the rest out), the clip must fit its
// inline request limit, and each user gets a few checks a day -- video is the costliest AI call
// the bot makes. The remarks are coaching cues, never a diagnosis; the prompt says so.
import type { Lang } from "../types";
import { aiVisionText } from "../ai/index";
import { cleanAi, t } from "../locales/i18n";
import { type MyContext, reply } from "../adapters/telegram/context";
import { abToB64, deferAi, downloadFile } from "./router";

export const FORM_CHECKS_PER_DAY = 5;
export const MAX_VIDEO_BYTES = 14 * 1024 * 1024; // ~19 MB once base64-encoded, under Gemini's 20 MB inline cap
export const MAX_VIDEO_SEC = 60;

export type FormCheckGate = "ok" | "too_big" | "too_long" | "limit";

/** Whether a clip may be checked: size and length first (free to tell), then the daily quota. */
export function formCheckGate(video: { bytes?: number; seconds?: number }, usedToday: number): FormCheckGate {
  if ((video.bytes ?? 0) > MAX_VIDEO_BYTES) return "too_big";
  if ((video.seconds ?? 0) > MAX_VIDEO_SEC) return "too_long";
  if (usedToday >= FORM_CHECKS_PER_DAY) return "limit";
  return "ok";
}

export function formCheckSystem(lang: Lang): string {
  return [
    "You are an experienced strength coach reviewing a client's short training video.",
    `Answer in ${lang === "uk" ? "Ukrainian" : "English"}, plain text, no markdown headings, at most 900 characters.`,
    "First line: the exercise you see (use the client's caption if it names one).",
    "Then 2–3 concrete remarks, each on its own line starting with \"• \": what to fix and how (a cue the client can use on the next set). If the technique looks solid, say what is good and give one refinement.",
    "Only comment on what is actually visible; if the angle, lighting or framing hides something important, say what to film differently instead of guessing.",
    "Never diagnose injuries or give medical advice; if a movement looks painful or risky, suggest lowering the weight and checking with a professional.",
  ].join("\n");
}

async function formChecksToday(ctx: MyContext): Promise<number> {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const row = await ctx.db
    .prepare("SELECT COUNT(*) AS c FROM v2_ai_calls WHERE accountId = ? AND kind = 'form_check' AND ok = 1 AND createdAt >= ?")
    .bind(ctx.user._id, since)
    .first<{ c: number }>()
    .catch(() => null);
  return row?.c ?? 0;
}

export async function handleFormVideo(ctx: MyContext, video: { fileId: string; bytes?: number; seconds?: number; mimeType?: string }): Promise<void> {
  const lang = ctx.user.lang;
  if (!ctx.user.onboarded) {
    await reply(ctx, t(lang, "not_onboarded"));
    return;
  }
  const gate = formCheckGate(video, await formChecksToday(ctx));
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
      user: caption ? `Client's caption: ${caption.slice(0, 200)}` : "No caption; identify the exercise yourself.",
      images: [{ mimeType: video.mimeType?.startsWith("video/") ? video.mimeType : "video/mp4", dataBase64: abToB64(data) }],
      temperature: 0.3,
      kind: "form_check",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const text = cleanAi(answer).trim().slice(0, 1200);
    await reply(ctx, text ? `${t(lang, "form_check_header")}\n\n${text}\n\n${t(lang, "form_check_footer")}` : t(lang, "form_check_failed"));
  });
}
