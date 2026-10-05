// Owner tools for exercise videos: refreshing the cache and setting a video for a plan exercise.
// Split out of owner.ts; owner.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import type { UserDoc, Weekday } from "../types";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { deleteUserVideo, getExerciseVideo, listAllCatalogNames, setManualVideo, setUserVideo, upsertExerciseVideo } from "../adapters/d1/v2Catalog";
import { updateUser } from "../adapters/d1/v2Users";
import { getPlanDay } from "../domain/progression";
import { cleanAi, t } from "../locales/i18n";
import { weekdayName } from "../render";
import { YouTubeQuotaError, normalizeVideoKey, parseYouTubeId, searchExerciseVideo } from "../youtube";
import { type MyContext, planOwnerId, reply, setMode } from "../adapters/telegram/context";
import { menuBtn } from "../bot";
import { isOwner } from "./owner";

// Owner: force re-fetch the technique video for every catalog exercise. Locked manual overrides
// are skipped (no quota spent on them). Stops gracefully when the daily YouTube quota is hit and
// reports partial progress — already-stored results are kept.
export async function cmdRefreshVideos(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  if (!ctx.env.YOUTUBE_API_KEY) {
    await reply(ctx, t(lang, "refreshvideos_no_key"));
    return;
  }
  await reply(ctx, t(lang, "refreshvideos_start"));
  const names = await listAllCatalogNames(ctx.db);
  let done = 0;
  let updated = 0;
  let skippedLocked = 0;
  let quotaHit = false;
  for (const name of names) {
    const key = normalizeVideoKey(name);
    const existing = await getExerciseVideo(ctx.db, key).catch(() => undefined);
    if (existing?.locked) {
      skippedLocked++;
      continue;
    }
    try {
      const best = await searchExerciseVideo(ctx.env, name);
      await upsertExerciseVideo(
        ctx.db,
        best
          ? { normalizedName: key, exerciseName: name, videoId: best.videoId, url: best.url, title: best.title, channelName: best.channelName, thumbnailUrl: best.thumbnailUrl, locked: false }
          : { normalizedName: key, exerciseName: name, videoId: null, url: null, title: null, channelName: null, thumbnailUrl: null, locked: false },
      );
      done++;
      if (best) updated++;
    } catch (err) {
      if (err instanceof YouTubeQuotaError) {
        quotaHit = true;
        break;
      }
      // Other transient error — skip this exercise and continue.
    }
  }
  await reply(
    ctx,
    t(lang, quotaHit ? "refreshvideos_quota" : "refreshvideos_done", {
      done,
      updated,
      skipped: skippedLocked,
      total: names.length,
    }),
  );
}

// Trainer or owner: manually replace the technique video for an exercise. The override is locked
// so /refreshvideos and the background backfill never overwrite it.
// Usage: /setvideo <exercise name> | <youtube url>
export async function cmdSetVideo(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (ctx.user.role !== "trainer" && !(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  const sep = arg.lastIndexOf("|");
  if (sep < 0) {
    await reply(ctx, t(lang, "setvideo_usage"));
    return;
  }
  const name = arg.slice(0, sep).trim();
  const url = arg.slice(sep + 1).trim();
  if (!name || !url) {
    await reply(ctx, t(lang, "setvideo_usage"));
    return;
  }
  const id = parseYouTubeId(url);
  if (!id) {
    await reply(ctx, t(lang, "setvideo_bad_url"));
    return;
  }
  const key = normalizeVideoKey(name);
  const shortUrl = `https://www.youtube.com/shorts/${id}`;
  // Same scope rule as the button flow (startVideoSet/handleVideoUrl): only the OWNER can set the
  // shared GLOBAL video; a trainer's /setvideo writes a per-CLIENT override on their current edit
  // target instead, so it never overwrites what every other user sees.
  if (await isOwner(ctx)) {
    await setManualVideo(ctx.db, key, name, { videoId: id, url: shortUrl }, ctx.user.chatId);
  } else {
    await setUserVideo(ctx.db, planOwnerId(ctx), key, name, { videoId: id, url: shortUrl });
  }
  await reply(ctx, t(lang, "setvideo_done", { name }));
}

// 🎥 Відео: button flow to set an exercise's technique-video link. A regular user sets a personal
// override (only they see it); a trainer/owner sets the shared/global video. `weekday` 0 = pick
// across the whole plan (user view); a specific weekday = that day only (trainer day-edit).
export async function startVideoPick(ctx: MyContext, weekday: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) { await reply(ctx, t(lang, "no_plan"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  let count = 0;
  for (const day of plan.split) {
    if (weekday && day.weekday !== weekday) continue;
    day.exercises.forEach((ex, idx) => {
      const prefix = weekday ? "" : `${weekdayName(lang, day.weekday).slice(0, 2)}: `;
      kb.text(`${prefix}${cleanAi(ex.name)}`.slice(0, 60), `vid:set:${day.weekday}:${idx}`).row();
      count++;
    });
  }
  if (!count) { await reply(ctx, t(lang, "no_plan"), menuBtn(lang)); return; }
  await reply(ctx, t(lang, "video_pick"), kb);
}

export async function startVideoSet(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const ex = plan ? getPlanDay(plan, weekday)?.exercises[index] : undefined;
  if (!ex) { await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  // Only the OWNER sets a GLOBAL locked video (seen by everyone). A trainer changing a video
  // writes a per-CLIENT override (planOwnerId = the client whose plan is being edited, or self)
  // — so only that client sees the trainer's pick; everyone else falls back to YouTube search.
  const scope: "user" | "global" = (await isOwner(ctx)) ? "global" : "user";
  const target = scope === "global" ? ctx.user._id : planOwnerId(ctx);
  const key = normalizeVideoKey(ex.canonicalName || ex.name);
  const session: UserDoc["session"] = {
    ...ctx.user.session,
    mode: "video_url",
    pendingVideo: { key, name: cleanAi(ex.name), scope, ownerId: target },
  };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "video_ask", { name: cleanAi(ex.name) }));
}

export async function handleVideoUrl(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const pv = ctx.user.session.pendingVideo;
  if (!pv) { await setMode(ctx, "idle"); await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  const trimmed = text.trim();
  // Reset → drop a personal override (reverts to the shared video). Global reset isn't offered here.
  if (/^(?:-|—|reset|скинути|видалити|прибрати|default)$/i.test(trimmed)) {
    // pv.ownerId is the override's target (the client, or self) — revert THAT user's override.
    if (pv.scope === "user") await deleteUserVideo(ctx.db, pv.ownerId, pv.key);
    await setMode(ctx, "idle");
    await reply(ctx, t(lang, "video_reset", { name: pv.name }), menuBtn(lang));
    return;
  }
  const id = parseYouTubeId(trimmed);
  if (!id) { await reply(ctx, t(lang, "setvideo_bad_url")); return; } // stay in mode, let them retry
  const url = `https://youtu.be/${id}`;
  if (pv.scope === "global") {
    await setManualVideo(ctx.db, pv.key, pv.name, { videoId: id, url }, ctx.user.chatId);
  } else {
    // Per-user override on the target (a trainer's pick lands only on their client's account).
    await setUserVideo(ctx.db, pv.ownerId, pv.key, pv.name, { videoId: id, url });
  }
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "video_saved", { name: pv.name }), menuBtn(lang));
}
