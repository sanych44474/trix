// Media the Mini App sends for AI: a meal photo (estimate, the user confirms before anything is
// logged), a short training video (form check) and a voice clip (transcription, the app puts the
// text into whichever box the user recorded for). Multipart uploads, same initData auth as every
// webapp API. These used to be chat-only (bot/router.ts photo/video/voice handlers).
import { aiTranscribe, aiVisionJSON, aiVisionText } from "../ai/index";
import * as P from "../ai/prompts";
import { awardAchievement } from "../adapters/d1/v2Gamification";
import { abToB64 } from "../bot/telegramFiles";
import { FORM_CHECKS_PER_DAY, MAX_VIDEO_BYTES, aiCallsToday, formCheckGate, formCheckPrompt, formCheckSystem } from "../bot/formCheck";
import { MAX_DAYS_IMPORTED, MAX_FILE_BYTES as MAX_CSV_BYTES, importWorkoutCsv } from "../bot/importCsv";
import { verifyItems } from "../features/nutrition/verifyItems";
import { cleanAi } from "../locales/i18n";
import { logError, logInfo } from "../log";
import { miniAppUser } from "./auth";
import type { Env } from "../types";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // ~4 min of opus; the app stops at 60 s
export const MEAL_PHOTOS_PER_DAY = 30;

const bad = (reason: string, status = 400) => Response.json({ error: reason }, { status });

function blobOf(form: FormData | null, field: string): Blob | null {
  const v = form?.get(field);
  return v instanceof Blob && v.size > 0 ? v : null;
}

function captionOf(form: FormData | null): string | undefined {
  const v = form?.get("caption");
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined;
}

export async function handleMediaApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return bad("unauthorized", 401);
  if (req.method !== "POST") return bad("method not allowed", 405);
  const form = await req.formData().catch(() => null);
  const path = url.pathname.replace(/^\/api\/media/, "");

  if (path === "/meal-photo") {
    const photo = blobOf(form, "photo");
    if (!photo) return bad("bad request");
    if (photo.size > MAX_PHOTO_BYTES) return bad("too_big");
    if ((await aiCallsToday(env.DB, user._id, "nutrition_photo")) >= MEAL_PHOTOS_PER_DAY) return bad("limit", 429);
    try {
      const est = await aiVisionJSON<P.NutritionEstimate>(env, {
        system: P.nutritionVisionSystem(user.lang),
        user: captionOf(form) ?? "Estimate the calories and macros of this meal.",
        images: [{ mimeType: photo.type.startsWith("image/") ? photo.type : "image/jpeg", dataBase64: abToB64(await photo.arrayBuffer()) }],
        schema: P.NUTRITION_SCHEMA,
        temperature: 0.3,
        kind: "nutrition_photo",
        db: env.DB,
        userId: user._id,
      });
      const { final } = await verifyItems(env.DB, env, user._id, (est.items ?? []).filter((i) => Number(i.kcal) > 0));
      const items = final.filter((i) => i.kcal > 0).map((i) => ({ ...i, desc: cleanAi(i.desc).slice(0, 80) }));
      logInfo("meal_photo_estimated", { items: items.length });
      return Response.json({ items });
    } catch (err) {
      logError("api/media/meal-photo", err, { userId: user._id });
      return bad("dependency_unavailable", 502);
    }
  }

  if (path === "/form-check") {
    const video = blobOf(form, "video");
    if (!video) return bad("bad request");
    const seconds = Number(form?.get("seconds")) || undefined;
    const gate = formCheckGate({ bytes: video.size, seconds }, await aiCallsToday(env.DB, user._id, "form_check"));
    if (gate !== "ok") return Response.json({ ok: false, reason: gate, limit: FORM_CHECKS_PER_DAY });
    if (video.size > MAX_VIDEO_BYTES) return Response.json({ ok: false, reason: "too_big", limit: FORM_CHECKS_PER_DAY });
    try {
      const answer = await aiVisionText(env, {
        system: formCheckSystem(user.lang),
        user: formCheckPrompt(captionOf(form)),
        images: [{ mimeType: video.type.startsWith("video/") ? video.type : "video/mp4", dataBase64: abToB64(await video.arrayBuffer()) }],
        temperature: 0.3,
        kind: "form_check",
        db: env.DB,
        userId: user._id,
      });
      const text = cleanAi(answer).trim().slice(0, 1200);
      if (!text) return Response.json({ ok: false, reason: "failed" });
      await awardAchievement(env.DB, user._id, "form_check_first").catch(() => {});
      logInfo("form_check_done", { source: "webapp" });
      return Response.json({ ok: true, text });
    } catch (err) {
      logError("api/media/form-check", err, { userId: user._id });
      return Response.json({ ok: false, reason: "failed" });
    }
  }

  if (path === "/transcribe") {
    const audio = blobOf(form, "audio");
    if (!audio) return bad("bad request");
    if (audio.size > MAX_AUDIO_BYTES) return bad("too_big");
    try {
      const text = (await aiTranscribe(env, await audio.arrayBuffer(), audio.type || "audio/webm", user.lang, env.DB)).trim().slice(0, 1000);
      logInfo("voice_transcribed", { source: "webapp", empty: !text });
      return Response.json({ text });
    } catch (err) {
      logError("api/media/transcribe", err, { userId: user._id });
      return bad("dependency_unavailable", 502);
    }
  }

  // Workout history from Strong / Hevy (CSV export). Dates that already have a log are skipped.
  if (path === "/import-csv") {
    const file = blobOf(form, "file");
    if (!file) return bad("bad request");
    if (file.size > MAX_CSV_BYTES) return Response.json({ ok: false, reason: "too_big" });
    try {
      const result = await importWorkoutCsv(env.DB, user._id, user.lang, await file.text());
      if (!result) return Response.json({ ok: false, reason: "wrong_format" });
      logInfo("csv_imported", { source: "webapp", format: result.format, imported: result.imported });
      return Response.json({ ok: true, ...result, cap: MAX_DAYS_IMPORTED });
    } catch (err) {
      logError("api/media/import-csv", err, { userId: user._id });
      return Response.json({ ok: false, reason: "failed" });
    }
  }

  return bad("not found", 404);
}
