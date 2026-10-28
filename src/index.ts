import { ensureTelegramSetup } from "./telegramSetup";
import { GrammyError } from "grammy";
import { sendBestEffort, telegramCall } from "./adapters/telegram/rawApi";
import type { Update } from "grammy/types";
export { UserSchedulerDO } from "./durable/userScheduler";
export { SquadSchedulerDO } from "./durable/squadScheduler";
export { GlobalSchedulerDO } from "./durable/globalScheduler";
import { loadLearnedMuscles } from "./exerciseMuscleLearning";
import { createBot } from "./bot/router";
import { buildOwnerMetrics } from "./features/owner/ownerMetrics";
import { ownerUsersData } from "./features/owner/ownerReport";
import { buildPlanDocRaw } from "./features/plan/planBuild";
import { pingIncompleteOnboarding } from "./bot/onboarding";
import { checkCronHeartbeat } from "./schedulerJobs/global";
import { runSchedule } from "./scheduler";
import { healthcheckDue, pingHealthcheck } from "./adapters/monitoring/healthchecks";
import { handleBroadcastBatch, type BroadcastMessage } from "./features/owner/broadcastQueue";
import { activityRaw } from "./adapters/d1/activityMetrics";
import { buildActivityMetrics } from "./domain/activityMetrics";
import { serveWeekMap } from "./features/report/weekMap";
import { bumpEvent } from "./adapters/d1/v2Analytics";
import { deleteSetting, getSetting, markUpdateSeen, pingDb, setSetting } from "./adapters/d1/v2Admin";
import { setActivePlan } from "./adapters/d1/v2Plans";
import { getUser, updateUser } from "./adapters/d1/v2Users";
import { miniAppUser } from "./webapp/auth";
import { verifyVideoOpen } from "./domain/videoLink";
import { buildDashboardPayload } from "./adapters/d1/dashboardReader";
import { handlePhotoApi } from "./webapp/miscApi";
import { legacyRouteFor } from "./webapp/routes";
import { serveStoryImage } from "./adapters/r2/storyMedia";
import { handleStravaCallback } from "./webapp/stravaApi";
import { handleQuickLogApi } from "./webapp/quickLogApi";
import { handleV2Api } from "./webapp/v2Api";
import { handleEmailAuth } from "./webapp/emailAuth";
import { handleApkDownload, handleAppConfig } from "./webapp/appConfig";
import { handleProviderAuth } from "./webapp/providerAuth";
import { handlePushApi } from "./webapp/pushApi";
import { logError, logInfo, runWithRequestId, withHeader } from "./log";
import { secretMatches } from "./domain/secrets";
import { expensiveBucket, withinLimit } from "./limits";
import type { Env } from "./types";


// Query strings routinely end up in proxy access logs and browser history, so the operator
// credential travels as a header instead — never compare env.ADMIN_SECRET against a URL param.
function isAdmin(req: Request, env: Env): boolean {
  return secretMatches(req.headers.get("X-Admin-Secret"), env.ADMIN_SECRET);
}

async function handleFetch(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  // /admin/* is guarded by one shared secret, so guessing it is the attack: throttle by client IP
  // before the secret is even compared (an IP is the right key here -- there is no user yet).
  if (url.pathname.startsWith("/admin/") && !(await withinLimit(env, "admin", req.headers.get("cf-connecting-ip") ?? "unknown"))) {
    return new Response("too many requests", { status: 429, headers: { "retry-after": "60" } });
  }
    const apkResponse = await handleApkDownload(req, url, env);
    if (apkResponse) return apkResponse;
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("trix bot up", { status: 200 });
    }

    // Read-only D1 connectivity check (no data exposed).
    if (url.pathname === "/health/db") {
      try {
        const ok = await pingDb(env.DB);
        return Response.json({ ok });
      } catch (err) {
        // Anonymous callers get no D1 error text (it can name tables, columns or binding details);
        // the real error goes to the logs instead.
        logError("health_db", err);
        return Response.json({ ok: false, error: "db unavailable" }, { status: 500 });
      }
    }

    // Admin: send a message to a specific user. Auth via X-Admin-Secret header.
    // POST /admin/send?chatId=...&text=...
    if (req.method === "POST" && url.pathname === "/admin/send") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      const chatId = url.searchParams.get("chatId");
      const text = url.searchParams.get("text");
      if (!chatId || !text) return new Response("missing chatId or text", { status: 400 });
      const status = await telegramCall(env, "sendMessage", { chat_id: Number(chatId), text, parse_mode: "HTML" })
        .then(() => 200, (e: unknown) => (e instanceof GrammyError ? e.error_code : 502));
      return Response.json({ ok: status === 200, status });
    }

    // Admin: ping every non-onboarded reachable user to finish their interview (resumes each
    // at their current question). POST /admin/ping-stuck, X-Admin-Secret header.
    if (req.method === "POST" && url.pathname === "/admin/ping-stuck") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      const res = await pingIncompleteOnboarding(env, env.DB);
      return Response.json(res);
    }

    // Admin: replan a single user immediately. Auth via X-Admin-Secret header.
    // POST /admin/replan-user?chatId=...
    if (req.method === "POST" && url.pathname === "/admin/replan-user") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      const chatId = Number(url.searchParams.get("chatId"));
      if (!chatId) return new Response("missing chatId", { status: 400 });
      const user = await getUser(env.DB, chatId);
      if (!user) return new Response("user not found", { status: 404 });
      try {
        const plan = await buildPlanDocRaw(env, env.DB, user.lang, user.profile, user._id);
        await setActivePlan(env.DB, plan);
        await updateUser(env.DB, user._id, { session: { mode: "idle" } });
        await sendBestEffort(env, chatId, "✅ Твій план тренувань оновлено!");
        return Response.json({ ok: true, days: plan.split.length, exercisesPerDay: plan.split.map(d => d.exercises.length) });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      }
    }

    // Admin: schedule a one-time mass replan for all users after N hours (default 10).
    // POST /admin/replan?hours=10, X-Admin-Secret header.
    if (req.method === "POST" && url.pathname === "/admin/replan") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      const hours = Math.max(0, Math.min(48, Number(url.searchParams.get("hours") ?? "10")));
      const fireAt = new Date(Date.now() + hours * 3_600_000).toISOString();
      await setSetting(env.DB, "scheduled_replan_after", fireAt);
      return Response.json({ scheduled: fireAt, hours });
    }

    // Admin: cancel a pending scheduled replan.
    if (req.method === "DELETE" && url.pathname === "/admin/replan") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      const existing = await getSetting(env.DB, "scheduled_replan_after");
      await deleteSetting(env.DB, "scheduled_replan_after");
      return Response.json({ cancelled: existing ?? "none" });
    }

    // Owner-report metrics as JSON, for the Grafana "trix — owner metrics" dashboard (Infinity
    // datasource). Same auth as the other /admin/* routes; read-only, no query params.
    // GET /admin/metrics/owner, X-Admin-Secret header.
    if (req.method === "GET" && url.pathname === "/admin/metrics/owner") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      return Response.json(await buildOwnerMetrics(env.DB));
    }

    // User activity as JSON, for the Grafana "trix — user activity" dashboard (grafana/user-activity.json):
    // DAU and what people did per day, WAU/MAU/stickiness, feature adoption, top events, cohort
    // retention, most active users. GET /admin/metrics/activity?days=30 (7–90), X-Admin-Secret header.
    if (req.method === "GET" && url.pathname === "/admin/metrics/activity") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      const days = Math.min(90, Math.max(7, Math.round(Number(url.searchParams.get("days")) || 30)));
      const today = new Date().toISOString().slice(0, 10);
      const before = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
      const raw = await activityRaw(env.DB, before(days - 1), before(6), before(29));
      return Response.json(buildActivityMetrics(raw, today, days), { headers: { "cache-control": "no-store" } });
    }

    // Per-user roster (name, trainer, status, activity counts) as JSON, for the same Grafana
    // dashboard -- the named detail behind /admin/metrics/owner's aggregate counts.
    // GET /admin/metrics/users, X-Admin-Secret header.
    if (req.method === "GET" && url.pathname === "/admin/metrics/users") {
      if (!isAdmin(req, env)) {
        return new Response("unauthorized", { status: 401 });
      }
      return Response.json(await ownerUsersData(env.DB));
    }

    // Video-open tracking: count the click, then 302 to the real (YouTube-only) target.
    // GET /v?u=<encoded youtube url>&uid=<user id>&sig=<HMAC over uid+u, videoLink.ts>
    // Public, short-lived story images for Telegram's shareToStory (adapters/r2/storyMedia.ts).
    if (req.method === "GET" && url.pathname.startsWith("/story/")) {
      return (await serveStoryImage(env, url.pathname)) ?? new Response("Not found", { status: 404 });
    }
    // The weekly digest's body map picture, fetched by Telegram from a link the bot signed.
    if (req.method === "GET" && url.pathname === "/weekmap.png") {
      return serveWeekMap(url, env);
    }
    if (req.method === "GET" && url.pathname === "/strava/callback") {
      return handleStravaCallback(url, env);
    }
    if (req.method === "GET" && url.pathname === "/v") {
      const target = url.searchParams.get("u") ?? "";
      const uid = Number(url.searchParams.get("uid"));
      const sig = url.searchParams.get("sig") ?? "";
      let parsed: URL | null = null;
      try {
        parsed = new URL(target);
      } catch {
        /* fall through to 400 */
      }
      const YT_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"]);
      // Protocol check too — "javascript://youtube.com/…" parses with an allowlisted hostname.
      if (!parsed || parsed.protocol !== "https:" || !YT_HOSTS.has(parsed.hostname)) {
        return new Response("bad target", { status: 400 });
      }
      // The redirect itself never depends on the signature -- a link minted before this landed,
      // or a genuinely malformed sig, still takes the viewer to the video. Only the counter bump
      // is gated: without it, `uid` was a free-form parameter anyone could set to inflate a
      // stranger's count with no authentication at all.
      if (uid > 0 && (await verifyVideoOpen(uid, target, sig, env.TELEGRAM_BOT_TOKEN))) {
        ctx.waitUntil(bumpEvent(env.DB, uid, "video_open", new Date().toISOString().slice(0, 10)).catch(() => {}));
      }
      return Response.redirect(parsed.toString(), 302);
    }

    // Mini App shell (GET /app) is now served as a STATIC ASSET (public/app.html, built at deploy
    // time) via wrangler [assets] — it never reaches the Worker, so it neither bloats the bundle
    // nor costs a Worker invocation. CSP/cache headers for it live in public/_headers.

    // Versioned Mini App REST seam. The v2 client is served at /app-v2 while this adapter
    // delegates to the legacy implementations; business behavior therefore stays identical
    // during the staged migration.
    if (url.pathname.startsWith("/api/v2/")) {
      const appConfigResponse = await handleAppConfig(req, url, env);
      if (appConfigResponse) return appConfigResponse;
      const providerAuthResponse = await handleProviderAuth(req, url, env);
      if (providerAuthResponse) return providerAuthResponse;
      const authResponse = await handleEmailAuth(req, url, env);
      if (authResponse) return authResponse;
      const pushResponse = await handlePushApi(req, url, env);
      if (pushResponse) return pushResponse;
      return handleV2Api(req, url, env, ctx);
    }

    // Everything below under /api/ is the unversioned surface the retired legacy shell called.
    // ADR-0006 removes it after 2026-12-31 unless traffic remains; this line is that evidence.
    if (url.pathname.startsWith("/api/")) logInfo("legacy_api_hit", { path: url.pathname, method: req.method });

    // The unversioned twins of the throttled v2 POSTs (settings exports, feedback, photo upload) get
    // the same per-user limit; without it the old paths were an unthrottled way around it.
    const legacyBucket = url.pathname.startsWith("/api/") ? expensiveBucket(req.method, `/api/v2${url.pathname.slice(4)}`) : null;
    if (legacyBucket) {
      const user = await miniAppUser(req, url, env).catch(() => null);
      if (user && !(await withinLimit(env, "expensive", `${legacyBucket}:${user._id}`))) {
        return new Response("too many requests", { status: 429, headers: { "retry-after": "60" } });
      }
    }

    // Mini App handlers: one table (webapp/routes.ts), the same one the /api/v2 seam reads.
    const miniAppRoute = legacyRouteFor(url.pathname);
    if (miniAppRoute) return miniAppRoute.handler(req, url, env);

    if (url.pathname === "/api/photo") return handlePhotoApi(req, url, env, ctx);

    // Mini App data: initData-authenticated JSON for the dashboard charts.
    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      const user = await miniAppUser(req, url, env);
      if (!user) return new Response("unauthorized", { status: 401 });
      // Dead-man switch for the cron rides the hottest fetch path (detached, never blocks).
      ctx.waitUntil(checkCronHeartbeat(env));
      const payload = await buildDashboardPayload(env.DB, user);
      logInfo("dashboard_loaded", {}); // docs/slos.md's practical "Mini App opened" proxy
      return Response.json(payload, { headers: { "cache-control": "no-store" } });
    }

    // Mini App quick-log shares its use case with the versioned API.
    if (req.method === "POST" && url.pathname === "/api/log") return handleQuickLogApi(req, url, env);

    if (req.method === "POST" && url.pathname === "/webhook") {
      // Verify the secret header Telegram echoes back.
      if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("unauthorized", { status: 401 });
      }
      let update: Update;
      try {
        update = (await req.json()) as Update;
      } catch {
        return new Response("bad request", { status: 400 });
      }

      // Dedup Telegram retries so we never double-log a workout/meal.
      const isNew = await markUpdateSeen(env.DB, update.update_id);
      if (!isNew) return new Response("duplicate", { status: 200 });

      try {
        const bot = createBot(env, ctx);
        // createBot presets botInfo when BOT_ID/BOT_USERNAME are configured; otherwise grammY
        // needs one getMe before it can dispatch.
        if (!bot.isInited()) await bot.init();
        await bot.handleUpdate(update);
      } catch (err) {
        // Already marked seen; reply 200 so Telegram doesn't retry into a no-op.
        logError("webhook", err);
      }
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const reqId = crypto.randomUUID();
    await loadLearnedMuscles(env.DB).catch(() => {}); // cached per isolate (exerciseMuscleLearning.ts)
    const start = Date.now();
    return runWithRequestId(reqId, env, async () => {
      const url = new URL(req.url);
      let res: Response;
      try {
        res = await handleFetch(req, env, ctx, url);
      } catch (err) {
        logError("fetch", err, { path: url.pathname, method: req.method });
        res = new Response("error", { status: 500 });
      }
      // One correlatable summary line per request; the reqId also rides back to the client so a
      // bug report ("it broke at 14:32") can be matched to this exact line in Workers Logs.
      logInfo("request", { method: req.method, path: url.pathname, status: res.status, durationMs: Date.now() - start });
      return withHeader(res, "X-Request-Id", reqId);
    });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const reqId = crypto.randomUUID();
    await loadLearnedMuscles(env.DB).catch(() => {});
    ctx.waitUntil(
      runWithRequestId(reqId, env, async () => {
        const start = Date.now();
        // Commands, profile texts and menu button, once per version after a deploy.
        await ensureTelegramSetup(env).catch((err) => logError("telegram_setup_failed", err));
        try {
          await runSchedule(env);
          logInfo("cron_run", { durationMs: Date.now() - start });
          if (healthcheckDue("ok", event.scheduledTime)) await pingHealthcheck(env.HEALTHCHECK_PING_URL, "ok");
        } catch (err) {
          logError("cron_failure", err, { durationMs: Date.now() - start });
          await pingHealthcheck(env.HEALTHCHECK_PING_URL, "fail", err instanceof Error ? err.message : String(err));
        }
      }),
    );
  },

  // Owner broadcasts, one message per recipient (features/owner/broadcastQueue.ts).
  async queue(batch: MessageBatch<BroadcastMessage>, env: Env): Promise<void> {
    await runWithRequestId(crypto.randomUUID(), env, () => handleBroadcastBatch(batch, env));
  },
} satisfies ExportedHandler<Env, BroadcastMessage>;
