import type { Env, ExerciseVideo } from "./types";
import { getExerciseVideo, upsertExerciseVideo } from "./db/repos";

// Thrown when the YouTube Data API rejects with HTTP 403 quotaExceeded so batch callers
// (warm-at-generation, background backfill, /refreshvideos) can stop instead of hammering.
export class YouTubeQuotaError extends Error {
  constructor() {
    super("YouTube API daily quota exceeded");
    this.name = "YouTubeQuotaError";
  }
}

// Channels known for clean single-exercise technique demos — a soft ranking signal, not a gate.
const PREFERRED_CHANNELS = [
  "gym visual",
  "muscle and motion",
  "puregym",
  "renaissance periodization",
  "deltabolic",
  "andrew kwong",
];

// Title keywords that suggest a focused technique demo.
const POSITIVE_KEYWORDS = ["technique", "form", "how to", "tutorial", "perfect", "proper"];

// Titles we never want: compilations, motivation, podcasts, reactions, full sessions, etc.
const BLOCKLIST = /compilation|motivat|podcast|reaction|top \d+|vlog|day in the life|full workout|\bwod\b/i;

const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";

// Only true Shorts: YouTube's `videoDuration=short` filter just means < 4 min, so we verify the
// real duration via videos.list and keep only clips at or under this many seconds.
const SHORT_MAX_SECONDS = 60;

/** Parse an ISO-8601 duration (e.g. "PT1M5S", "PT45S") to seconds; 0 if unparseable. */
export function isoDurationToSeconds(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Normalize an exercise name into the cache key: trim, lowercase, collapse whitespace. */
export function normalizeVideoKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Significant tokens of an exercise name (words ≥ 3 chars), for title-relevance scoring. */
function nameTokens(name: string): string[] {
  return normalizeVideoKey(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
}

export interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
}

export interface PickedVideo {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
}

/** Pure heuristic ranking. Rejects blocklisted titles and anything with no relevance signal
 * (neither an exercise-name token in the title nor a preferred channel), then returns the
 * highest-scoring survivor or null. */
export function pickBestVideo(items: YouTubeSearchItem[], canonicalName: string): PickedVideo | null {
  const tokens = nameTokens(canonicalName);
  let best: PickedVideo | null = null;
  let bestScore = 0;
  for (const it of items) {
    const videoId = it.id?.videoId;
    const title = it.snippet?.title;
    if (!videoId || !title) continue;
    const lowerTitle = title.toLowerCase();
    if (BLOCKLIST.test(lowerTitle)) continue;
    const channel = it.snippet?.channelTitle ?? "";
    const preferred = PREFERRED_CHANNELS.some((p) => channel.toLowerCase().includes(p));
    const matched = tokens.filter((t) => lowerTitle.includes(t)).length;
    if (matched === 0 && !preferred) continue; // no relevance signal — skip
    let score = matched * 2;
    if (preferred) score += 5;
    for (const kw of POSITIVE_KEYWORDS) if (lowerTitle.includes(kw)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = {
        videoId,
        url: `https://www.youtube.com/shorts/${videoId}`,
        title,
        channelName: channel,
        thumbnailUrl: it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null,
      };
    }
  }
  return best;
}

/** Extract a YouTube video id from watch / shorts / embed / youtu.be URLs (for /setvideo). */
export function parseYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

/** Search YouTube for one short technique demo of an exercise. Returns null when nothing
 * acceptable is found; throws YouTubeQuotaError on a 403 quota rejection. */
export async function searchExerciseVideo(env: Env, canonicalName: string): Promise<PickedVideo | null> {
  if (!env.YOUTUBE_API_KEY) return null;
  const qs = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoDuration: "short", // < 4 min — the closest the API gets to "short-form"
    videoEmbeddable: "true",
    maxResults: "10",
    safeSearch: "strict",
    q: `${canonicalName} exercise technique`,
    key: env.YOUTUBE_API_KEY,
  });
  const res = await fetch(`${YT_SEARCH}?${qs}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      if (/quota/i.test(body)) throw new YouTubeQuotaError();
    }
    return null;
  }
  const data = (await res.json()) as { items?: YouTubeSearchItem[] };
  const items = data.items ?? [];
  const ids = items.map((i) => i.id?.videoId).filter((x): x is string => !!x);
  if (!ids.length) return null;
  // Verify real durations and keep only true Shorts (≤ SHORT_MAX_SECONDS). videos.list costs
  // 1 unit. If durations can't be fetched we return null rather than risk a long video.
  const vres = await fetch(
    `${YT_VIDEOS}?part=contentDetails&id=${ids.join(",")}&key=${env.YOUTUBE_API_KEY}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!vres.ok) {
    if (vres.status === 403) {
      const body = await vres.text().catch(() => "");
      if (/quota/i.test(body)) throw new YouTubeQuotaError();
    }
    return null;
  }
  const vdata = (await vres.json()) as { items?: { id?: string; contentDetails?: { duration?: string } }[] };
  const seconds = new Map<string, number>();
  for (const v of vdata.items ?? []) {
    if (v.id && v.contentDetails?.duration) seconds.set(v.id, isoDurationToSeconds(v.contentDetails.duration));
  }
  const shortItems = items.filter((i) => {
    const s = i.id?.videoId ? seconds.get(i.id.videoId) : undefined;
    return typeof s === "number" && s > 0 && s <= SHORT_MAX_SECONDS;
  });
  return pickBestVideo(shortItems, canonicalName);
}

/** Cache-first lookup (D1 `exercise_videos`). Returns the cached row (incl. negative-cache and
 * locked manual overrides) when present; otherwise searches YouTube once and stores the result
 * (a negative-cache row when no acceptable video is found). Returns undefined only when there is
 * no API key to search with. Propagates YouTubeQuotaError so batch callers can stop. */
export async function lookupExerciseVideoCached(
  db: D1Database,
  env: Env,
  name: string,
): Promise<ExerciseVideo | undefined> {
  const key = normalizeVideoKey(name);
  if (!key) return undefined;
  const existing = await getExerciseVideo(db, key).catch(() => undefined);
  if (existing) return existing;
  if (!env.YOUTUBE_API_KEY) return undefined;
  const best = await searchExerciseVideo(env, name); // may throw YouTubeQuotaError
  const video: ExerciseVideo = best
    ? {
        normalizedName: key,
        exerciseName: name,
        videoId: best.videoId,
        url: best.url,
        title: best.title,
        channelName: best.channelName,
        thumbnailUrl: best.thumbnailUrl,
        locked: false,
      }
    : {
        normalizedName: key,
        exerciseName: name,
        videoId: null,
        url: null,
        title: null,
        channelName: null,
        thumbnailUrl: null,
        locked: false,
      };
  await upsertExerciseVideo(db, video).catch(() => {});
  return video;
}
