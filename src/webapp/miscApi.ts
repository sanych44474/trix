// Long-tail Mini App APIs (roadmap P7): challenges (view/join), injury log (view/report), and
// the competitor leaderboards (read). Each reuses the same repos/domain as the bot; same initData
// auth. Routed at /api/challenges, /api/injuries, /api/boards.
import {
  activeChallenges,
  createInjury,
  countCompletedChallenges,
  friendIds,
  getProgressPhoto,
  getSetting,
  getUser,
  joinChallenge,
  recordError,
  listActiveInjuries,
  nutritionLogsSince,
  stepLogsSince,
  waterLogsSince,
  workoutLogsSince,
} from "../db/repos";
import { computeBoards } from "../bot";
import { CHALLENGES, challengeByCode, challengeCurrent, challengeStatus, challengeWindowCounts, resolveWaterGoal } from "../domain/challenges";
import { checkAfterDate } from "../domain/injury";
import { localParts } from "../domain/progression";
import { rankOf } from "../domain/records";
import { t } from "../locales/i18n";
import { miniAppUser } from "./auth";
import type { Env, UserDoc } from "../types";

type TKey = Parameters<typeof t>[1];

const AREA_KEY: Record<string, string> = {
  shoulder: "inj_area_shoulder", elbow: "inj_area_elbow", wrist: "inj_area_wrist",
  lower_back: "inj_area_lower_back", knee: "inj_area_knee", hip: "inj_area_hip", ankle: "inj_area_ankle", neck: "inj_area_neck",
};
const SEVERITIES = ["mild", "strong"];

// Window counts a challenge's metric reads from (aggregation shared with the bot via domain).
async function windowData(env: Env, user: UserDoc, start: string, end: string) {
  const [wl, nl, sl, water] = await Promise.all([
    workoutLogsSince(env.DB, user._id, start),
    nutritionLogsSince(env.DB, user._id, start),
    stepLogsSince(env.DB, user._id, start),
    waterLogsSince(env.DB, user._id, start),
  ]);
  return challengeWindowCounts({ workouts: wl, nutrition: nl, steps: sl, water }, start, end, resolveWaterGoal(user.profile));
}

export async function handleChallengesApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const lang = user.lang;
  const { date } = localParts(user.profile.timezone);

  if (req.method === "GET") {
    const active = await activeChallenges(env.DB, user._id, date).catch(() => []);
    const joinedCodes = new Set(active.map((c) => c.code));
    const activeOut = [];
    for (const ch of active) {
      const tpl = challengeByCode(ch.code);
      if (!tpl) continue;
      const st = challengeStatus(tpl, challengeCurrent(tpl, await windowData(env, user, ch.startDate, ch.endDate)));
      const daysLeft = Math.max(0, Math.round((Date.parse(ch.endDate) - Date.parse(date)) / 86_400_000));
      activeOut.push({ code: ch.code, emoji: tpl.emoji, title: t(lang, `chal_${ch.code}_title` as TKey), current: st.current, target: st.target, pct: st.pct, done: st.done, daysLeft });
    }
    const available = CHALLENGES.filter((c) => !joinedCodes.has(c.code)).map((c) => ({ code: c.code, emoji: c.emoji, title: t(lang, `chal_${c.code}_title` as TKey), target: c.target, windowDays: c.windowDays }));
    const won = await countCompletedChallenges(env.DB, user._id).catch(() => 0);
    return Response.json({ active: activeOut, available, won }, { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const tpl = typeof body.code === "string" ? challengeByCode(body.code) : undefined;
  if (!tpl) return Response.json({ error: "bad request" }, { status: 400 });
  const active = await activeChallenges(env.DB, user._id, date).catch(() => []);
  if (active.some((c) => c.code === tpl.code)) return Response.json({ ok: true }); // already joined
  const end = new Date(Date.parse(date) + tpl.windowDays * 86_400_000).toISOString().slice(0, 10);
  await joinChallenge(env.DB, user._id, tpl.code, date, end);
  return Response.json({ ok: true });
}

export async function handleInjuriesApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const lang = user.lang;

  if (req.method === "GET") {
    const active = await listActiveInjuries(env.DB, user._id).catch(() => []);
    return Response.json(
      {
        injuries: active.map((inj) => {
          const last = inj.checkinsHistory[inj.checkinsHistory.length - 1];
          return { area: t(lang, (AREA_KEY[inj.area] ?? "inj_area_shoulder") as TKey), severity: t(lang, `inj_sev_${inj.severity}` as TKey), since: inj.reportedAt.slice(0, 10), lastScore: last ? last.score : null };
        }),
        areas: Object.keys(AREA_KEY).map((a) => ({ value: a, label: t(lang, AREA_KEY[a] as TKey) })),
        severities: SEVERITIES.map((s) => ({ value: s, label: t(lang, `inj_sev_${s}` as TKey) })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await req.json().catch(() => ({}))) as { area?: unknown; severity?: unknown };
  const area = typeof body.area === "string" && AREA_KEY[body.area] ? body.area : null;
  const severity = typeof body.severity === "string" && SEVERITIES.includes(body.severity) ? body.severity : null;
  if (!area || !severity) return Response.json({ error: "bad request" }, { status: 400 });
  const { date } = localParts(user.profile.timezone);
  await createInjury(env.DB, { userId: user._id, area, severity, checkAfter: checkAfterDate(date, severity as "mild" | "strong"), swaps: [] });
  return Response.json({ ok: true });
}

// Webview JS errors die silently inside Telegram otherwise — the app posts them here (deduped
// and capped client-side). They land in error_logs, so the owner's error-spike alert covers
// the Mini App too.
export async function handleClientErrorApi(req: Request, url: URL, env: Env): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { message?: unknown; source?: unknown; line?: unknown };
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 160) : "";
  if (!message) return Response.json({ error: "bad request" }, { status: 400 });
  const where = typeof body.source === "string" && body.source ? ` @ ${body.source.slice(-40)}:${Number(body.line) || 0}` : "";
  await recordError(env.DB, { userId: user._id, kind: "webapp", errorType: "client_js", message: `${message}${where}` }).catch(() => {});
  return Response.json({ ok: true });
}

// Progress-photo proxy: streams Telegram file bytes so the Mini App can <img> them without
// ever seeing the bot token. Owner or their trainer only. Auth rides in the `tma` query param
// (img tags can't send headers); the response is private-cacheable for a day.
export async function handlePhotoApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return new Response("unauthorized", { status: 401 });
  const id = Number(url.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) return new Response("bad request", { status: 400 });
  const photo = await getProgressPhoto(env.DB, id).catch(() => null);
  if (!photo) return new Response("not found", { status: 404 });
  if (photo.userId !== user._id) {
    // A trainer may view their own client's photos; anyone else gets an opaque 404.
    const owner = await getUser(env.DB, photo.userId).catch(() => null);
    if (!(user.role === "trainer" && owner?.trainerId === user._id)) return new Response("not found", { status: 404 });
  }
  const fileRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: photo.fileId }),
  }).then((r) => r.json() as Promise<{ ok: boolean; result?: { file_path?: string } }>).catch(() => null);
  const path = fileRes?.ok ? fileRes.result?.file_path : undefined;
  if (!path) return new Response("gone", { status: 410 });
  const bytes = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  if (!bytes.ok) return new Response("gone", { status: 410 });
  return new Response(bytes.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" },
  });
}

export async function handleBoardsApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!user.competeOptIn) return Response.json({ optedIn: false }, { headers: { "cache-control": "no-store" } });
  // Hourly cron-built cache (scheduler writes "boards_cache"); live compute is the fallback for
  // a cold/stale cache so the screen never breaks if the cron lags.
  let boards: Awaited<ReturnType<typeof computeBoards>> | null = null;
  const cached = await getSetting(env.DB, "boards_cache").catch(() => null);
  if (cached) {
    try {
      const c = JSON.parse(cached) as { computedAt: string; boards: Awaited<ReturnType<typeof computeBoards>> };
      if (Date.parse(c.computedAt) > Date.now() - 2 * 3_600_000) boards = c.boards;
    } catch { /* fall through to live compute */ }
  }
  if (!boards) boards = await computeBoards(env.DB, user.profile.timezone);
  type BE = { userId: number; name: string; value: number; detail?: string };
  // Full top-5 (names already alias/anonymity-resolved by computeBoards) + the viewer's own rank.
  const one = (b: BE[]) => ({
    rank: rankOf(b as never, user._id),
    total: b.length,
    top: b.slice(0, 5).map((e, i) => ({ pos: i + 1, name: e.name, value: e.value, detail: e.detail ?? "", me: e.userId === user._id })),
  });
  // Friends board: the same rankings scoped to the referral circle (+ the viewer). Opted-in
  // friends only — leaderboards require compete opt-in.
  const friends = await friendIds(env.DB, user._id).catch(() => [] as number[]);
  const circle = new Set([user._id, ...friends]);
  const scope = (b: BE[]) => b.filter((e) => circle.has(e.userId));
  const friendsBlock = friends.length
    ? { count: friends.length, consistency: one(scope(boards.consistency)), improved: one(scope(boards.improved)), relative: one(scope(boards.relative)), total: one(scope(boards.total)) }
    : { count: 0 };
  return Response.json(
    { optedIn: true, consistency: one(boards.consistency), improved: one(boards.improved), relative: one(boards.relative), total: one(boards.total), friends: friendsBlock },
    { headers: { "cache-control": "no-store" } },
  );
}
