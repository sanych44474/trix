import type { Update } from "grammy/types";
import { createBot, buildPlanDocRaw, pingIncompleteOnboarding } from "./bot";
import { checkCronHeartbeat, runSchedule } from "./scheduler";
import {
  addWater,
  appendMeals,
  bumpEvent,
  deleteSetting,
  getSetting,
  getUser,
  getWorkoutLog,
  markUpdateSeen,
  pingDb,
  recordDailyCheckin,
  setActivePlan,
  setSetting,
  updateUser,
  upsertBodyLog,
  upsertStepLog,
  upsertStrengthRecord,
  upsertWorkoutLog,
} from "./db/repos";
import { aiJSON } from "./ai/index";
import { nutritionSystem, NUTRITION_SCHEMA, type NutritionEstimate } from "./ai/prompts";
import { localParts, parseMeasurements } from "./domain/progression";
import { cleanAi } from "./locales/i18n";
import { miniAppUser } from "./webapp/auth";
import { buildDashboardPayload } from "./webapp/dashboard";
import { handleTrainerApi } from "./webapp/trainerApi";
import { handleWorkoutApi } from "./webapp/workoutApi";
import { handlePlanApi } from "./webapp/planApi";
import { handleProfileApi, handleOnboardingApi } from "./webapp/profileApi";
import { handleSettingsApi } from "./webapp/settingsApi";
import { handleExtrasApi } from "./webapp/extrasApi";
import { handleNutritionApi } from "./webapp/nutritionApi";
import { handleBuddyApi } from "./webapp/buddyApi";
import { handleChallengesApi, handleInjuriesApi, handleBoardsApi, handleClientErrorApi, handlePhotoApi } from "./webapp/miscApi";
import { handleOwnerApi } from "./webapp/ownerApi";
import type { Env, MealEntry, Weekday } from "./types";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

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

    // Admin: send a message to a specific user.
    // POST /admin/send?secret=...&chatId=...&text=...
    if (req.method === "POST" && url.pathname === "/admin/send") {
      if (url.searchParams.get("secret") !== env.ADMIN_SECRET) {
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
    // at their current question). POST /admin/ping-stuck?secret=...
    if (req.method === "POST" && url.pathname === "/admin/ping-stuck") {
      if (url.searchParams.get("secret") !== env.ADMIN_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const res = await pingIncompleteOnboarding(env, env.DB);
      return Response.json(res);
    }

    // Admin: replan a single user immediately.
    // POST /admin/replan-user?secret=...&chatId=...
    if (req.method === "POST" && url.pathname === "/admin/replan-user") {
      if (url.searchParams.get("secret") !== env.ADMIN_SECRET) {
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
    // POST /admin/replan?secret=...&hours=10
    if (req.method === "POST" && url.pathname === "/admin/replan") {
      if (url.searchParams.get("secret") !== env.ADMIN_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const hours = Math.max(0, Math.min(48, Number(url.searchParams.get("hours") ?? "10")));
      const fireAt = new Date(Date.now() + hours * 3_600_000).toISOString();
      await setSetting(env.DB, "scheduled_replan_after", fireAt);
      return Response.json({ scheduled: fireAt, hours });
    }

    // Admin: cancel a pending scheduled replan.
    if (req.method === "DELETE" && url.pathname === "/admin/replan") {
      if (url.searchParams.get("secret") !== env.ADMIN_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const existing = await getSetting(env.DB, "scheduled_replan_after");
      await deleteSetting(env.DB, "scheduled_replan_after");
      return Response.json({ cancelled: existing ?? "none" });
    }

    // Video-open tracking: count the click, then 302 to the real (YouTube-only) target.
    // GET /v?u=<encoded youtube url>&uid=<user id>
    if (req.method === "GET" && url.pathname === "/v") {
      const target = url.searchParams.get("u") ?? "";
      const uid = Number(url.searchParams.get("uid"));
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
      if (uid > 0) {
        ctx.waitUntil(bumpEvent(env.DB, uid, "video_open", new Date().toISOString().slice(0, 10)).catch(() => {}));
      }
      return Response.redirect(parsed.toString(), 302);
    }

    // Mini App shell (GET /app) is now served as a STATIC ASSET (public/app.html, built at deploy
    // time) via wrangler [assets] — it never reaches the Worker, so it neither bloats the bundle
    // nor costs a Worker invocation. CSP/cache headers for it live in public/_headers.

    // Mini App extras: records, weekcard, requests, sessions, finance, directory, library,
    // whatsnew, plates, trainer profile. MUST come before the /api/trainer/ prefix catch —
    // three of these live under that prefix.
    if (
      url.pathname === "/api/records" || url.pathname === "/api/weekcard" || url.pathname === "/api/whatsnew" ||
      url.pathname === "/api/plates" || url.pathname === "/api/requests" || url.pathname === "/api/trainer/sessions" ||
      url.pathname === "/api/trainer/finance" || url.pathname === "/api/trainers" || url.pathname === "/api/library" ||
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
    if (url.pathname === "/api/photo") return handlePhotoApi(req, url, env);
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
      return Response.json(payload, { headers: { "cache-control": "no-store" } });
    }

    // Mini App quick-log: water top-up, one-exercise workout entry, or AI-estimated food text.
    // POST /api/log — same initData auth as the dashboard.
    if (req.method === "POST" && url.pathname === "/api/log") {
      const user = await miniAppUser(req, url, env);
      if (!user) return new Response("unauthorized", { status: 401 });
      let body: { kind?: string; ml?: number; name?: string; sets?: number; weight?: number; reps?: number; text?: string; steps?: number; energy?: number; sleep?: number; stress?: number };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return new Response("bad request", { status: 400 });
      }
      const { date: today, weekday } = localParts(user.profile.timezone);
      try {
        if (body.kind === "water") {
          const add = Math.round(Number(body.ml));
          if (!Number.isFinite(add) || add <= 0 || add > 3000) return new Response("bad request", { status: 400 });
          // Atomic increment — a read-modify-write here loses a double-tap's increment.
          const total = await addWater(env.DB, user._id, today, add);
          return Response.json({ ok: true, ml: total });
        }
        if (body.kind === "workout") {
          const name = String(body.name ?? "").trim().slice(0, 80);
          const sets = Math.round(Number(body.sets));
          const reps = Math.round(Number(body.reps));
          const weight = Number(body.weight) || 0;
          if (!name || !(sets >= 1 && sets <= 20) || !(reps >= 1 && reps <= 1000) || weight < 0 || weight > 1000) {
            return new Response("bad request", { status: 400 });
          }
          // Merge into today's log (replace a re-logged exercise), same as the guided logger.
          // Preserve the existing log's completed flag and notes — a quick-logged extra set
          // must not flip an in-progress (not-done) day to done or wipe bot-written notes.
          const existing = await getWorkoutLog(env.DB, user._id, today);
          const exercises = (existing?.exercises ?? []).filter((e) => e.name !== name);
          exercises.push({ name, setsDone: Array.from({ length: sets }, () => ({ weight, reps })), skipped: false });
          await upsertWorkoutLog(env.DB, user._id, today, weekday as Weekday, exercises, existing?.completed ?? true, existing?.notes);
          // Weighted lifts only: a bodyweight quick-log must not overwrite a time/distance
          // record's metric axis or create a bestWeight=0 row.
          if (weight > 0) {
            await upsertStrengthRecord(env.DB, user._id, name, { metric: "reps", weight, reps }, today).catch(() => {});
          }
          return Response.json({ ok: true, exercises: exercises.length });
        }
        if (body.kind === "steps") {
          const steps = Math.round(Number(body.steps));
          if (!Number.isFinite(steps) || steps < 0 || steps > 200000) return new Response("bad request", { status: 400 });
          await upsertStepLog(env.DB, user._id, today, steps);
          return Response.json({ ok: true, steps });
        }
        if (body.kind === "measure") {
          // Reuse the bot's free-text parser: "вага 74, талія 80" → weight + circumferences.
          const text = String(body.text ?? "").trim().slice(0, 200);
          const { weight, measurements } = parseMeasurements(text);
          if (weight === undefined && Object.keys(measurements).length === 0) return Response.json({ ok: false, reason: "unreadable" });
          await upsertBodyLog(env.DB, user._id, today, { ...(weight !== undefined ? { weight } : {}), measurements });
          return Response.json({ ok: true, weight: weight ?? null, measurements });
        }
        if (body.kind === "checkin") {
          const c = (v: unknown) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : 0; };
          const energy = c(body.energy), sleep = c(body.sleep), stress = c(body.stress);
          if (!energy || !sleep || !stress) return new Response("bad request", { status: 400 });
          await recordDailyCheckin(env.DB, user._id, today, energy, sleep, stress);
          return Response.json({ ok: true });
        }
        if (body.kind === "food") {
          const text = String(body.text ?? "").trim().slice(0, 500);
          if (!text) return new Response("bad request", { status: 400 });
          const est = await aiJSON<NutritionEstimate>(env, {
            system: nutritionSystem(user.lang),
            user: text,
            schema: NUTRITION_SCHEMA,
            temperature: 0.3,
            kind: "nutrition",
            db: env.DB,
            userId: user._id,
          });
          const items: MealEntry[] = (est.items ?? [])
            .filter((i) => i.kcal > 0)
            .map((i) => ({ desc: cleanAi(i.desc), kcal: i.kcal, protein: i.protein, fats: i.fats, carbs: i.carbs, grams: i.grams, query: i.query }));
          if (!items.length) return Response.json({ ok: false, reason: "unreadable" });
          await appendMeals(env.DB, user._id, today, items);
          const kcal = items.reduce((s, i) => s + i.kcal, 0);
          return Response.json({ ok: true, items: items.map((i) => ({ desc: i.desc, kcal: i.kcal })), kcal });
        }
      } catch (err) {
        console.error("api/log error", user._id, err);
        return new Response("error", { status: 500 });
      }
      return new Response("bad request", { status: 400 });
    }

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
        console.error("webhook error", err);
      }
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSchedule(env));
  },
} satisfies ExportedHandler<Env>;
