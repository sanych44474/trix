// One-off SILENT backfill: ensure every exercise in an active plan has a YouTube **Short** (≤60s)
// technique clip cached in the remote D1 `exercise_videos` table. No Telegram, no bot.
// Mirrors src/youtube.ts (search.list → videos.list duration filter → heuristic pick).
//
// Quota-aware: first cheaply checks the durations of already-stored videos (videos.list = 1 unit
// per 50 ids) and nulls out any that are NOT real Shorts, so long videos stop showing immediately
// even if the daily search quota runs out. Then re-searches only the missing/long ones (search.list
// = 100 units each), capped by --max=N (default 90), stopping on quota.
//
//   $env:CLOUDFLARE_API_TOKEN="..."; $env:YOUTUBE_API_KEY="..."; node scripts/backfill-videos.mjs
// Locked manual overrides are never touched.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const MAX = Number((process.argv.find((a) => a.startsWith("--max=")) || "--max=90").split("=")[1]);
const SHORT_MAX_SECONDS = 60;

function readKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  const m = readFileSync(".dev.vars", "utf8").match(/^YOUTUBE_API_KEY="?([^"\n]+)"?/m);
  if (m) return m[1];
  throw new Error("YOUTUBE_API_KEY not found in env or .dev.vars");
}
const KEY = readKey();

function d1(sql) {
  const out = execFileSync(NPX, ["wrangler", "d1", "execute", "trix", "--remote", "--json", "--command", `"${sql}"`], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true,
  });
  return JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1))[0].results;
}
function d1file(sql) {
  writeFileSync("scripts/.backfill-tmp.sql", sql);
  execFileSync(NPX, ["wrangler", "d1", "execute", "trix", "--remote", "--file", "scripts/.backfill-tmp.sql"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true,
  });
}

const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const nameTokens = (s) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
const isoToSec = (iso) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

const PREFERRED = ["gym visual", "muscle and motion", "puregym", "renaissance periodization", "deltabolic", "andrew kwong"];
const POS = ["technique", "form", "how to", "tutorial", "perfect", "proper"];
const BLOCK = /compilation|motivat|podcast|reaction|top \d+|vlog|day in the life|full workout|\bwod\b/i;

function pickBest(items, name) {
  const tokens = nameTokens(name);
  let best = null, bestScore = 0;
  for (const it of items) {
    const videoId = it.id?.videoId, title = it.snippet?.title;
    if (!videoId || !title) continue;
    const lt = title.toLowerCase();
    if (BLOCK.test(lt)) continue;
    const channel = it.snippet?.channelTitle ?? "";
    const preferred = PREFERRED.some((p) => channel.toLowerCase().includes(p));
    const matched = tokens.filter((t) => lt.includes(t)).length;
    if (matched === 0 && !preferred) continue;
    let score = matched * 2 + (preferred ? 5 : 0);
    for (const kw of POS) if (lt.includes(kw)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = { videoId, url: `https://www.youtube.com/shorts/${videoId}`, title, channelName: channel,
        thumbnailUrl: it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null };
    }
  }
  return best;
}

class Quota extends Error {}

// videos.list contentDetails for up to 50 ids → Map(id → seconds). 1 unit per call.
async function durations(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${chunk.join(",")}&key=${KEY}`);
    if (!res.ok) { if (res.status === 403 && /quota/i.test(await res.text())) throw new Quota(); continue; }
    const data = await res.json();
    for (const v of data.items ?? []) if (v.id && v.contentDetails?.duration) out.set(v.id, isoToSec(v.contentDetails.duration));
  }
  return out;
}

// Shorts-only search: search.list (100u) → keep ids whose real duration ≤ 60s → heuristic pick.
async function search(name) {
  const qs = new URLSearchParams({ part: "snippet", type: "video", videoDuration: "short", videoEmbeddable: "true",
    maxResults: "10", safeSearch: "strict", q: `${name} exercise technique`, key: KEY });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${qs}`);
  if (!res.ok) { if (res.status === 403 && /quota/i.test(await res.text())) throw new Quota(); return null; }
  const items = (await res.json()).items ?? [];
  const ids = items.map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return null;
  const secs = await durations(ids);
  const shortItems = items.filter((i) => { const s = secs.get(i.id?.videoId); return typeof s === "number" && s > 0 && s <= SHORT_MAX_SECONDS; });
  return pickBest(shortItems, name);
}

const sqlStr = (v) => (v == null ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);
const nowIso = new Date().toISOString();
const upsert = (key, name, best) =>
  `INSERT INTO exercise_videos (normalized_name, exercise_name, youtube_video_id, youtube_url, youtube_title, channel_name, thumbnail_url, locked, set_by, createdAt, updatedAt) ` +
  `VALUES (${sqlStr(key)}, ${sqlStr(name)}, ${sqlStr(best?.videoId ?? null)}, ${sqlStr(best?.url ?? null)}, ${sqlStr(best?.title ?? null)}, ${sqlStr(best?.channelName ?? null)}, ${sqlStr(best?.thumbnailUrl ?? null)}, 0, NULL, ${sqlStr(nowIso)}, ${sqlStr(nowIso)}) ` +
  `ON CONFLICT(normalized_name) DO UPDATE SET youtube_video_id=excluded.youtube_video_id, youtube_url=excluded.youtube_url, youtube_title=excluded.youtube_title, channel_name=excluded.channel_name, thumbnail_url=excluded.thumbnail_url, updatedAt=excluded.updatedAt WHERE exercise_videos.locked=0;`;

// 1. Source list of exercises to ensure a Short for. Default = the WHOLE catalog (keyed by the
//    canonical English name, exactly how the renderer looks videos up); pass --plans to limit to
//    exercises currently used in active plans.
const PLANS_ONLY = process.argv.includes("--plans");
const byKey = new Map();
if (PLANS_ONLY) {
  for (const row of d1("SELECT split FROM plans WHERE active = 1")) {
    let days; try { days = JSON.parse(row.split); } catch { continue; }
    for (const d of days ?? []) for (const e of d.exercises ?? []) {
      const name = e.canonicalName || e.name;
      if (name && !byKey.has(normalize(name))) byKey.set(normalize(name), name);
    }
  }
  console.log(`Unique exercises in active plans: ${byKey.size}`);
} else {
  for (const row of d1("SELECT name FROM exercises")) {
    if (row.name && !byKey.has(normalize(row.name))) byKey.set(normalize(row.name), row.name);
  }
  console.log(`Catalog exercises: ${byKey.size}`);
}

// 2. Existing rows. Validate the durations of currently-stored videos (cheap) and null out any
//    that are NOT real Shorts so long clips disappear immediately. Locked rows are left alone.
const existing = new Map(); // key → { videoId, hasUrl, locked }
for (const r of d1("SELECT normalized_name, youtube_video_id, youtube_url, locked FROM exercise_videos")) {
  existing.set(r.normalized_name, { videoId: r.youtube_video_id, hasUrl: !!r.youtube_url, locked: !!r.locked });
}
const toCheck = [...existing.entries()].filter(([, v]) => v.videoId && !v.locked);
let nulledLong = 0;
try {
  const secs = await durations(toCheck.map(([, v]) => v.videoId));
  const longKeys = toCheck.filter(([, v]) => { const s = secs.get(v.videoId); return s == null || s > SHORT_MAX_SECONDS; }).map(([k]) => k);
  if (longKeys.length) {
    d1file(longKeys.map((k) => `UPDATE exercise_videos SET youtube_video_id=NULL, youtube_url=NULL, youtube_title=NULL, channel_name=NULL, thumbnail_url=NULL, updatedAt=${sqlStr(nowIso)} WHERE normalized_name=${sqlStr(k)} AND locked=0;`).join("\n"));
    nulledLong = longKeys.length;
    longKeys.forEach((k) => existing.set(k, { ...existing.get(k), hasUrl: false, videoId: null }));
  }
  console.log(`Existing videos checked: ${toCheck.length} · nulled (not Shorts): ${nulledLong}`);
} catch (e) {
  if (e instanceof Quota) { console.log("Quota hit during duration check — aborting."); process.exit(0); }
  throw e;
}

// 3. Re-search everything still without a Short: missing rows, just-nulled long ones, and old
//    negative-cache rows (url already null). Cap by --max; stop on quota.
const todo = [...byKey.entries()].filter(([k]) => { const e = existing.get(k); return !e || (!e.hasUrl && !e.locked); });
console.log(`Need a Short: ${todo.length} (cap ${MAX})`);
const rows = [];
let searched = 0, withVideo = 0, quota = false;
for (const [key, name] of todo) {
  if (searched >= MAX) { console.log(`Hit --max cap (${MAX}).`); break; }
  searched++;
  let best = null;
  try { best = await search(name); }
  catch (e) { if (e instanceof Quota) { quota = true; console.log("YouTube quota hit; stopping."); break; } else continue; }
  if (best) withVideo++;
  rows.push(upsert(key, name, best));
  console.log(`  ${best ? "✓" : "·"} ${name}${best ? ` → ${best.channelName}` : " (no Short found)"}`);
}
if (rows.length) {
  d1file(rows.join("\n"));
  console.log(`\nUpdated ${rows.length} rows (${withVideo} with a Short).${quota ? " Quota stopped early — re-run tomorrow." : ""}`);
} else {
  console.log("\nNo re-search needed.");
}
console.log(`Summary: nulled ${nulledLong} long videos, re-searched ${searched}, ${withVideo} new Shorts.`);
