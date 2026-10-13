// Video form check: the daily limit, size cap and the AI prompts, shared by the bot's video
// message and the Mini App's upload. Moved from bot/formCheck.ts.
import type { Lang } from "../../types";

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

/** Successful AI calls of one kind the user made today (UTC day), for daily quotas. */
export async function aiCallsToday(db: D1Database, userId: number, kind: string): Promise<number> {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  try {
    const row = await db
      .prepare("SELECT COUNT(*) AS c FROM v2_ai_calls WHERE accountId = ? AND kind = ? AND ok = 1 AND createdAt >= ?")
      .bind(userId, kind, since)
      .first<{ c: number }>();
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function formCheckPrompt(caption?: string): string {
  return caption ? `Client's caption: ${caption.slice(0, 200)}` : "No caption; identify the exercise yourself.";
}
