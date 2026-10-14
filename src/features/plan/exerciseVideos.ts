// Exercise videos for plan days: shared/global video, the viewer's own override, open-count
// redirect links, and a background YouTube lookup for exercises that have none yet.
import type { ExerciseVideo, PlanDay } from "../../types";
import { getExerciseVideos, getUserVideos } from "../../adapters/d1/v2Catalog";
import { buildVideoOpenLink } from "../../domain/videoLink";
import { exerciseVideoKey } from "../../render";
import { lookupExerciseVideoCached } from "../../youtube";
import { type MyContext } from "../../adapters/telegram/context";
import { APP_URL } from "../../notify/appLinks";

// Cached technique videos for the exercises in the given days, for rendering. Any exercise that
// has never been searched is queued for a background YouTube lookup (fire-and-forget, stops on
// quota) so it appears on the next view — the current render is never blocked or slowed.
export async function videosForDays(ctx: MyContext, days: PlanDay[]): Promise<Map<string, ExerciseVideo>> {
  const keys = [...new Set(days.flatMap((d) => d.exercises.map((e) => exerciseVideoKey(e))))];
  if (!keys.length) return new Map();
  const map = await getExerciseVideos(ctx.db, keys).catch(() => new Map<string, ExerciseVideo>());
  // A viewer's personal override (set via 🎥 Відео) wins over the shared/global video.
  const overrides = await getUserVideos(ctx.db, ctx.user._id, keys).catch(() => new Map<string, ExerciseVideo>());
  for (const [k, v] of overrides) map.set(k, v);
  // Route links through the Worker's /v redirect so opens are counted (video_open event).
  // Only when deployed (APP_URL set) — local dev keeps direct links.
  for (const [k, v] of map) {
    if (v.url) map.set(k, { ...v, url: await buildVideoOpenLink(APP_URL, v.url, ctx.user._id, ctx.env.TELEGRAM_BOT_TOKEN) });
  }
  if (ctx.env.YOUTUBE_API_KEY) {
    const missing = days.flatMap((d) => d.exercises).filter((e) => !map.has(exerciseVideoKey(e)));
    if (missing.length) {
      ctx.waitUntil(
        (async () => {
          const seen = new Set<string>();
          for (const e of missing) {
            const k = exerciseVideoKey(e);
            if (seen.has(k)) continue;
            seen.add(k);
            try {
              await lookupExerciseVideoCached(ctx.db, ctx.env, e.canonicalName || e.name);
            } catch {
              break; // quota (or other error) — stop the batch
            }
          }
        })(),
      );
    }
  }
  return map;
}
