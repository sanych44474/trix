import type { Update } from "grammy/types";
export { UserSchedulerDO } from "./durable/userScheduler";
export { SquadSchedulerDO } from "./durable/squadScheduler";
export { GlobalSchedulerDO } from "./durable/globalScheduler";
import { createBot, buildOwnerMetrics, buildPlanDocRaw, ownerUsersData, pingIncompleteOnboarding } from "./bot";
import { checkCronHeartbeat, runSchedule } from "./scheduler";
import {
  bumpEvent,
  deleteSetting,
  getSetting,
  markUpdateSeen,
  pingDb,
  setSetting,
} from "./adapters/d1/v2Admin";
import { setActivePlan } from "./adapters/d1/v2Plans";
import { getUser, updateUser } from "./adapters/d1/v2Users";
import { miniAppUser } from "./webapp/auth";
import { verifyVideoOpen } from "./domain/videoLink";
import { buildDashboardPayload } from "./adapters/d1/dashboardReader";
import { handleTrainerApi } from "./webapp/trainerApi";
import { handleWorkoutApi } from "./webapp/workoutApi";
import { handlePlanApi } from "./webapp/planApi";
import { handleProfileApi, handleOnboardingApi } from "./webapp/profileApi";
import { handleSettingsApi } from "./webapp/settingsApi";
import { handleExtrasApi } from "./webapp/extrasApi";
import { handleTrainerScheduleApi } from "./webapp/trainerScheduleApi";
import { handleNutritionApi } from "./webapp/nutritionApi";
import { handleBuddyApi } from "./webapp/buddyApi";
import { handleChallengesApi, handleInjuriesApi, handleBoardsApi, handleClientErrorApi, handlePhotoApi } from "./webapp/miscApi";
import { handleOwnerApi } from "./webapp/ownerApi";
import { handleQuickLogApi } from "./webapp/quickLogApi";
import { handleV2Api } from "./webapp/v2Api";
import { logError, logInfo, runWithRequestId, withHeader } from "./log";
import { withLegacyFreeze } from "./adapters/d1/legacyFreeze";
import type { Env } from "./types";

const logLegacyWriteBlocked = (sql: string): void => logError("legacy_write_blocked", new Error(sql), {});

// Query strings routinely end up in proxy access logs and browser history, so the operator
// credential travels as a header instead — never compare env.ADMIN_SECRET against a URL param.
function isAdmin(req: Request, env: Env): boolean {
  return !!env.ADMIN_SECRET && req.headers.get("X-Admin-Secret") === env.ADMIN_SECRET;
}

async function handleFetch(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("trix bot up", { status: 200 });
    }

    // Read-only D1 connectivity check (no data exposed).
    if (url.pathname === "/health/db") {
      try {
        const ok = await pingDb(env.DB);
        return Response.json({ ok });
      } catch (err) {
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        );
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
      const res = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(chatId), text, parse_mode: "HTML" }),
        },
      );
      return Response.json({ ok: res.ok, status: res.status });
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
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "✅ Твій план тренувань оновлено!", parse_mode: "HTML" }),
        });
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
      return handleV2Api(req, url, env, ctx);
    }

    // Trainer scheduling + money (own tables, own handler). Like the extras block below, this
    // MUST come before the /api/trainer/ prefix catch.
    if (url.pathname === "/api/trainer/sessions" || url.pathname === "/api/trainer/finance") {
      return handleTrainerScheduleApi(req, url, env);
    }

    // Mini App extras: records, weekcard, requests, directory, library, whatsnew, plates,
    // trainer profile. MUST come before the /api/trainer/ prefix catch — one lives under it.
    if (
      url.pathname === "/api/records" || url.pathname === "/api/weekcard" || url.pathname === "/api/whatsnew" ||
      url.pathname === "/api/plates" || url.pathname === "/api/requests" || url.pathname === "/api/trainers" || url.pathname === "/api/library" ||
      url.pathname === "/api/trainer/profile"
    ) {
      return handleExtrasApi(req, url, env);
    }

    // Mini App trainer APIs: client card read/write, note, flag (same initData auth + role gate).
    if (url.pathname.startsWith("/api/trainer/")) {
      return handleTrainerApi(req, url, env);
    }

    // Mini App guided workout logger: today's session, swap alternatives, rest push, batch save.
    if (url.pathname.startsWith("/api/workout/")) {
      return handleWorkoutApi(req, url, env);
    }

    // Mini App plan view + editor (self, or a trainer's client via clientId).
    if (url.pathname === "/api/plan") {
      return handlePlanApi(req, url, env);
    }

    // Mini App profile / settings editing.
    if (url.pathname === "/api/profile") {
      return handleProfileApi(req, url, env);
    }

    // Mini App nutrition suite: today's meals view/edit + meal-plan.
    if (url.pathname === "/api/nutrition") {
      return handleNutritionApi(req, url, env);
    }

    // Mini App long tail (P7): challenges, injuries, leaderboards.
    if (url.pathname === "/api/buddy") return handleBuddyApi(req, url, env);
    if (url.pathname === "/api/challenges") return handleChallengesApi(req, url, env);
    if (url.pathname === "/api/injuries") return handleInjuriesApi(req, url, env);
    if (url.pathname === "/api/boards") return handleBoardsApi(req, url, env);
    if (url.pathname === "/api/client-error") return handleClientErrorApi(req, url, env);
    if (url.pathname === "/api/photo") return handlePhotoApi(req, url, env, ctx);
    if (url.pathname.startsWith("/api/owner/")) return handleOwnerApi(req, url, env);

    // Mini App settings consolidation + onboarding form.
    if (url.pathname === "/api/settings") return handleSettingsApi(req, url, env);
    if (url.pathname === "/api/onboarding") return handleOnboardingApi(req, url, env);

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
      if (req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
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
  async fetch(req: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env = withLegacyFreeze(rawEnv, logLegacyWriteBlocked);
    const reqId = crypto.randomUUID();
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

  async scheduled(_event: ScheduledController, rawEnv: Env, ctx: ExecutionContext): Promise<void> {
    const env = withLegacyFreeze(rawEnv, logLegacyWriteBlocked);
    const reqId = crypto.randomUUID();
    ctx.waitUntil(
      runWithRequestId(reqId, env, async () => {
        const start = Date.now();
        try {
          await runSchedule(env);
          logInfo("cron_run", { durationMs: Date.now() - start });
        } catch (err) {
          logError("cron_failure", err, { durationMs: Date.now() - start });
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;
