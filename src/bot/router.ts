// Dispatch layer — the bot's routing "sitemap": command map, callback tables (exact + prefix),
// text-mode handlers, and createBot(). Extracted from bot.ts (god-file split); behavior unchanged.
// Handlers are imported from the modules that declare them; bot.ts is only a re-export barrel.
import { handleFormVideo } from "./formCheck";
import { cmdPaySupport, cmdSupport, onPreCheckout, onSuccessfulPayment } from "./support";
import { Bot, InlineKeyboard } from "grammy";
import { logInfo } from "../log";
import { aiTranscribe } from "../ai";
import { menuBtn } from "./keyboards";
import { cmdImport, handleImportDocument } from "./importCsv";
import { cmdAdmin, cmdAnnounce, cmdOwnerReport, cmdUsers, cmdWhatsNew, showOwnerHub } from "./owner";
import { cmdRefreshVideos, cmdSetVideo } from "./ownerVideos";
import { cmdBecomeTrainer, cmdClients, cmdLeaveTrainer, cmdRequests, cmdTrainer, cmdTrainerReport } from "../features/trainer/trainer";
import { cmdLibrary, cmdShareProgram, startShareMyPlan } from "../features/trainer/programSharing";
import { cmdTrainerQuestions } from "../features/trainer/clientCard";
import { trainerSteps, twAdvance } from "../features/trainer/trainerWizard";
import { bumpEvent, setLastSeen } from "../adapters/d1/v2Analytics";
import { addProgressPhoto } from "../adapters/d1/v2Tracking";
import { getOrCreateUser, getUser, updateUser } from "../adapters/d1/v2Users";
import { localParts } from "../domain/localTime";
import { escapeHtml, t } from "../locales/i18n";
import { handleGroupUpdate } from "./squad";
import { type Env } from "../types";
import { MyContext, reply } from "../adapters/telegram/context";
import { setAppUrl } from "./appLinks";
import { cmdCoach, cmdFeedback, defaultLang, normalizeEvent } from "./commonCmds";
import { cmdHelp, cmdHideKeyboard, cmdMenu, showAthleteMenu, showMoreMenu, showProgressHub, showTrainerClientsMenu } from "./menus";
import { cmdInterview, cmdStart } from "./start";
import { cmdPlan, cmdSchedule, cmdToday } from "./planView";
import { cmdAskInactive, cmdCleanup } from "./cleanup";
import { cmdCalendar } from "./calendar";
import { cmdChallenges } from "../features/gamification/challenges";
import { cmdDeleteMe, cmdExport, cmdReplan } from "./exportData";
import { cmdLang, cmdMeasure, cmdSettings } from "./settingsCmds";
import { cmdLog, guardLogExit } from "./guidedLog";
import { cmdNutrition, cmdSteps, cmdWater } from "./nutritionCmds";
import { cmdPlates, cmdProgress } from "./progressCmds";
import { cmdRecords } from "./recordsCmds";
import { cmdReport } from "./report";
import { cmdVacation } from "./vacation";
import { handlePhotoMeal } from "../features/nutrition/nutritionLog";
import { cmdMealPlan, cmdGrocery } from "./mealPlanCmds";
import { cmdCheckin } from "./checkinCmds";
import { downloadImage, downloadFile } from "./telegramFiles";
import { onError } from "./aiDefer";
import { onboardingGate } from "./onboardingApp";
import { CB_EXACT, CB_PREFIX } from "./callbackRoutes";
import { routeUserText } from "./textRoutes";
export * from "./textRoutes";
export * from "./callbackRoutes";
export * from "./aiDefer";
export * from "./telegramFiles";
export * from "./checkinCmds";
export * from "./mealPlanCmds";

export const MENU_MAP: Record<string, (c: MyContext) => Promise<void>> = {
  "menu:today": cmdToday,
  "menu:plan": cmdPlan,
  "menu:log": cmdLog,
  "menu:progress": cmdProgress,
  "menu:proghub": showProgressHub,
  "menu:nutrition": cmdNutrition,
  "menu:measure": cmdMeasure,
  "menu:steps": cmdSteps,
  "menu:water": cmdWater,
  "menu:challenges": cmdChallenges,
  "menu:cal": cmdCalendar,
  "menu:report": cmdReport,
  "menu:coach": cmdCoach,
  "menu:feedback": cmdFeedback,
  "menu:help": cmdHelp,
  "menu:settings": cmdSettings,
  "menu:interview": cmdInterview,
  "menu:records": cmdRecords,
  "menu:checkin": cmdCheckin,
  "menu:mealplan": cmdMealPlan,
  "menu:clients": cmdClients,
  "menu:requests": cmdRequests,
  "menu:questions": cmdTrainerQuestions,
  "menu:share": cmdShareProgram,
  "menu:library": cmdLibrary,
  "prog:mine": startShareMyPlan,
  "menu:trainer": cmdTrainer,
  "trmenu:athlete": showAthleteMenu,
  "trmenu:clients": showTrainerClientsMenu,
  "trmenu:profile": cmdTrainer,
  "menu:vacation": cmdVacation,
  "menu:trreport": cmdTrainerReport,
  "menu:more": showMoreMenu,
  "menu:ownerhub": showOwnerHub,
  "menu:users": cmdUsers,
  "menu:ownerreport": cmdOwnerReport,
  "menu:whatsnew": cmdWhatsNew,
};

// The idle gap that separates one session from the next — docs/slos.md §2's "visit / session".
const SESSION_IDLE_MS = 30 * 60 * 1000;

export function createBot(env: Env, exCtx?: ExecutionContext): Bot<MyContext> {
  setAppUrl(env.WORKER_URL, env.V2_APP_ENABLED === "1" ? "/app-v2" : "/app");
  const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN);

  // docs/slos.md's telegram_send_failure. An API transformer is the one real choke point for
  // outbound Bot API traffic: every ctx.api.*/bot.api.* call in the bot AND the scheduler goes
  // through here, so one hook replaces chasing dozens of scattered `.catch(() => {})` sites that
  // each swallow their own error. Re-throws unchanged -- this observes, it must not alter
  // behavior (callers' own catches still see exactly the error they saw before).
  bot.api.config.use(async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal);
    } catch (err) {
      if (method.startsWith("send") || method === "copyMessage") {
        const msg = err instanceof Error ? err.message : String(err);
        // Coarse buckets only -- the useful split is "the user is gone" vs "we're being
        // throttled" vs "something else broke", not the exact Telegram description string.
        const kind = /blocked|deactivated|chat not found|kicked/i.test(msg)
          ? "blocked"
          : /too many requests|retry after|flood/i.test(msg)
            ? "rate_limited"
            : "other";
        logInfo("telegram_send_failure", { kind, method });
      }
      throw err;
    }
  });

  // Avoid a getMe round-trip on every webhook invocation. Requires BOT_ID + BOT_USERNAME; a
  // deployment that leaves them unset simply pays for getMe via grammY's own bot.init().
  const botId = Number(env.BOT_ID);
  const botUser = env.BOT_USERNAME?.replace(/^@/, "");
  if (botId && botUser) bot.botInfo = {
    id: botId,
    is_bot: true,
    first_name: env.BOT_NAME || botUser,
    username: botUser,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    can_manage_bots: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    supports_join_request_queries: false,
  };

  // Group chats are handled by squad mode and NEVER fall through to the handlers below. Every
  // one of them assumes a private 1:1 chat: a group update reaching them would print someone's
  // plan into the group, and getOrCreateUser would stamp the GROUP's chat id onto a brand-new
  // user row, sending all of that person's future reminders to the group instead of to them.
  bot.use(async (ctx, next) => {
    if ((ctx.chat?.type ?? "private") === "private") return next();
    if (!ctx.from) return;
    ctx.env = env;
    ctx.db = env.DB;
    ctx.waitUntil = exCtx ? (p) => exCtx.waitUntil(p.catch((e) => console.error("waitUntil task error", e))) : (p) => void p.catch(() => {});
    await handleGroupUpdate(ctx, new Date().toISOString().slice(0, 10));
  });

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    const chatId = ctx.chat?.id ?? from?.id;
    if (!from || chatId === undefined) return;
    ctx.env = env;
    ctx.db = env.DB;
    ctx.waitUntil = exCtx ? (p) => exCtx.waitUntil(p.catch((e) => console.error("waitUntil task error", e))) : (p) => void p.catch(() => {});
    ctx.user = await getOrCreateUser(ctx.db, from.id, chatId, defaultLang(from.language_code), from.first_name);
    // Backfill name for users created before name capture existed.
    if (!ctx.user.profile.name && from.first_name) {
      ctx.user.profile = { ...ctx.user.profile, name: from.first_name };
      await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
    }
    // Capture/refresh the Telegram @username as it changes (used in the owner report).
    if (from.username && from.username !== ctx.user.username) {
      ctx.user.username = from.username;
      await updateUser(ctx.db, ctx.user._id, { username: from.username });
    }
    // docs/slos.md's session_started, computed off the value lastSeenAt still holds RIGHT HERE
    // (before the write below overwrites it): a gap wider than the idle window means this
    // interaction opens a new session. No extra storage and no extra read -- the signal the
    // session definition needs is already sitting in the user row.
    const prevSeen = ctx.user.lastSeenAt ? ctx.user.lastSeenAt.getTime() : 0;
    if (Date.now() - prevSeen > SESSION_IDLE_MS) logInfo("session_started", { surface: "bot" });
    // Record the LAST GENUINE interaction (only here — never from the cron). This is the only
    // reliable "is this user active" signal (users.updatedAt is bumped by the scheduler too).
    ctx.waitUntil(setLastSeen(ctx.db, ctx.user._id, new Date().toISOString()));
    // Owner-banned users are ignored entirely until the owner unblocks them.
    if (ctx.user.blocked) return;
    await next();
  });

  // Athletes who have not finished the questionnaire get the Mini App button for anything else
  // they send or tap (see onboardingApp.ts for what stays allowed).
  bot.use(async (ctx, next) => {
    if (await onboardingGate(ctx)) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    await cmdStart(ctx, ctx.match?.trim() || undefined);
  });
  bot.command("help", cmdHelp);
  bot.command("plan", cmdPlan);
  bot.command("today", cmdToday);
  bot.command("schedule", cmdSchedule);
  bot.command("becometrainer", cmdBecomeTrainer);
  bot.command("clients", cmdClients);
  bot.command("requests", cmdRequests);
  bot.command("trainer", cmdTrainer);
  bot.command("leavetrainer", cmdLeaveTrainer);
  bot.command("cleanup", cmdCleanup);
  bot.command("askinactive", cmdAskInactive);
  bot.command("log", (ctx) => cmdLog(ctx));
  bot.command("progress", cmdProgress);
  bot.command("nutrition", cmdNutrition);
  bot.command("mealplan", cmdMealPlan);
  bot.command("coach", cmdCoach);
  bot.command("measure", cmdMeasure);
  bot.command("steps", cmdSteps);
  bot.command("water", cmdWater);
  bot.command("challenges", cmdChallenges);
  bot.command("plates", cmdPlates);
  bot.command("calendar", cmdCalendar);
  bot.command("report", cmdReport);
  bot.command("checkin", cmdCheckin);
  bot.command("feedback", cmdFeedback);
  bot.command("settings", cmdSettings);
  bot.command("records", (ctx) => cmdRecords(ctx));
  bot.command("lang", cmdLang);
  bot.command("menu", cmdMenu);
  bot.command("hide", cmdHideKeyboard);
  bot.command("replan", cmdReplan);
  bot.command("grocery", cmdGrocery);
  bot.command("import", cmdImport);
  // Squad mode is a GROUP feature; in a private chat these just explain how to set it up, so a
  // curious /squad here does not fall through to the free-text AI coach.
  bot.command(["squad", "squadboard", "squadleave"], (ctx) =>
    reply(ctx, t(ctx.user.lang, "squad_private_hint"), menuBtn(ctx.user.lang)));
  bot.command("export", cmdExport);
  bot.command("support", cmdSupport);
  bot.command("paysupport", cmdPaySupport);
  // Telegram Stars tip jar (bot/support.ts). pre_checkout_query must be answered within 10 s.
  bot.on("pre_checkout_query", onPreCheckout);
  bot.on("message:successful_payment", onSuccessfulPayment);
  bot.command("deleteme", cmdDeleteMe);
  bot.command("admin", async (ctx) => {
    await cmdAdmin(ctx as MyContext, ctx.match.trim());
  });
  bot.command("ownerreport", cmdOwnerReport);
  bot.command("whatsnew", cmdWhatsNew);
  bot.command("refreshvideos", cmdRefreshVideos);
  bot.command("setvideo", async (ctx) => {
    await cmdSetVideo(ctx as MyContext, ctx.match.trim());
  });
  bot.command("users", cmdUsers);
  bot.command("announce", cmdAnnounce);

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});
    // Usage analytics: count every tap under a normalized key (screen opens, navigation, actions).
    ctx.waitUntil(bumpEvent(ctx.db, ctx.user._id, normalizeEvent(data), localParts(ctx.user.profile.timezone).date));
    try {
      // Route tables live at module level (CB_EXACT / CB_PREFIX) — exact match first, then
      // prefixes in registration order. See the tables for ordering rules.
      const exact = CB_EXACT[data];
      if (exact) { await exact(ctx, "", data); return; }
      for (const [prefix, handler] of CB_PREFIX) {
        if (data.startsWith(prefix)) { await handler(ctx, data.slice(prefix.length), data); return; }
      }
      const fn = MENU_MAP[data];
      if (fn) {
        // Navigating away from an unsaved guided log -> ask Save/Discard/Continue first.
        if (data !== "menu:log" && (await guardLogExit(ctx, data))) return;
        await fn(ctx);
      }
    } catch (err) {
      await onError(ctx, err, "callback");
    }
  });

  bot.on("message:text", async (ctx) => {
    try {
      await routeUserText(ctx, ctx.message.text.trim());
    } catch (err) {
      await onError(ctx, err, "text");
    }
  });

  // Voice / audio messages: transcribe with Whisper, then route exactly like typed text.
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    try {
      const lang = ctx.user.lang;
      const fileId = ctx.message.voice?.file_id ?? ctx.message.audio?.file_id;
      const mime = ctx.message.voice?.mime_type ?? ctx.message.audio?.mime_type ?? "audio/ogg";
      if (!fileId) {
        await reply(ctx, t(lang, "unsupported_msg"));
        return;
      }
      // Cap duration so a long clip can't burn the transcription budget / hang the request.
      const dur = ctx.message.voice?.duration ?? ctx.message.audio?.duration ?? 0;
      if (dur > 60) {
        await reply(ctx, t(lang, "voice_too_long"));
        return;
      }
      await ctx.replyWithChatAction("typing").catch(() => {});
      const audio = await downloadFile(ctx, fileId);
      const text = (await aiTranscribe(ctx.env, audio, mime, lang)).trim();
      if (!text) {
        await reply(ctx, t(lang, "voice_unclear"));
        return;
      }
      // Whisper can mishear (esp. gym slang) — confirm the transcript before acting on it. The
      // pending text is parked in the session until tapped.
      ctx.user.session = { ...ctx.user.session, pendingVoice: text };
      await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
      // In idle mode a spoken "жим 80 3×8" would otherwise fall to the coach and never be logged.
      // Offer an explicit intent (workout / food) instead of a plain Yes/No. Mid-flow voice replies
      // (onboarding, trainer messages, any active mode) keep the Yes/No confirm that routes by mode.
      let kb: InlineKeyboard;
      if (ctx.user.session.mode === "idle" && ctx.user.onboarded) {
        kb = new InlineKeyboard()
          .text(t(lang, "voice_log_workout"), "voice:wk")
          .text(t(lang, "voice_log_food"), "voice:food")
          .row()
          .text(t(lang, "voice_ask_coach"), "voice:coach")
          .text(t(lang, "voice_cancel"), "voice:no");
      } else {
        kb = new InlineKeyboard().text(t(lang, "voice_yes"), "voice:ok").text(t(lang, "voice_no"), "voice:no");
      }
      await reply(ctx, t(lang, "voice_confirm", { text }), kb);
    } catch (err) {
      await onError(ctx, err, "voice");
    }
  });

  bot.on("message:document", async (ctx) => {
    try {
      await handleImportDocument(ctx);
    } catch (err) {
      await onError(ctx, err, "import");
    }
  });

  bot.on("message:photo", async (ctx) => {
    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      // A trainer uploading their profile photo mid-wizard — capture the file_id, don't treat
      // it as a meal photo.
      if (ctx.user.session.mode === "trainer_setup") {
        const step = trainerSteps()[ctx.user.session.step ?? 0];
        if (step?.kind === "photo") {
          ctx.user.session = {
            ...ctx.user.session,
            trainerDraft: { ...(ctx.user.session.trainerDraft ?? {}), photoFileId: largest.file_id },
          };
          await reply(ctx, t(ctx.user.lang, "tw_photo_saved"));
          await twAdvance(ctx);
        } else {
          // Photo at a non-photo wizard step — don't run meal analysis; nudge to answer.
          await reply(ctx, t(ctx.user.lang, "tw_photo_not_now"));
        }
        return;
      }
      // Self-serve progress photo → straight to the gallery (Mini App profile shows it).
      if (ctx.user.session.photoSelf) {
        ctx.user.session = { ...ctx.user.session, photoSelf: undefined };
        await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
        await addProgressPhoto(ctx.db, ctx.user._id, largest.file_id).catch(() => {});
        logInfo("photo_uploaded", {});
        await reply(ctx, t(ctx.user.lang, "photo_self_saved"), menuBtn(ctx.user.lang));
        return;
      }
      // A trainer requested a progress photo — route this one to them instead of meal analysis.
      if (ctx.user.session.photoReviewFor) {
        const trainer = await getUser(ctx.db, ctx.user.session.photoReviewFor);
        ctx.user.session = { ...ctx.user.session, photoReviewFor: undefined };
        await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
        // Trainer-requested photos also land in the gallery — one history for both flows.
        await addProgressPhoto(ctx.db, ctx.user._id, largest.file_id).catch(() => {});
        logInfo("photo_uploaded", {});
        if (trainer) {
          const who = escapeHtml(ctx.user.profile.name ?? `id ${ctx.user._id}`);
          const kb = new InlineKeyboard().text(t(trainer.lang, "cc_message"), `cl:${ctx.user._id}:msg`);
          await ctx.api
            .sendPhoto(trainer.chatId, largest.file_id, {
              caption: t(trainer.lang, "photo_review_from", { name: who }),
              parse_mode: "HTML",
              reply_markup: kb,
            })
            .catch(() => {});
        }
        await reply(ctx, t(ctx.user.lang, "photo_review_sent"), menuBtn(ctx.user.lang));
        return;
      }
      const image = await downloadImage(ctx, largest.file_id);
      await handlePhotoMeal(ctx, [image]);
    } catch (err) {
      await onError(ctx, err, "photo");
    }
  });

  // A video of a set → AI form check (bot/formCheck.ts). Round video notes too.
  bot.on(["message:video", "message:video_note"], async (ctx) => {
    try {
      const v = ctx.message.video ?? ctx.message.video_note;
      if (!v) return;
      await handleFormVideo(ctx, {
        fileId: v.file_id,
        bytes: v.file_size,
        seconds: v.duration,
        mimeType: "mime_type" in v ? v.mime_type : "video/mp4",
      });
    } catch (err) {
      await onError(ctx, err, "form_check");
    }
  });

  // Anything else (sticker, document, video, …): we can't read it.
  bot.on("message", async (ctx) => {
    await reply(ctx, t(ctx.user.lang, "unsupported_msg")).catch(() => {});
  });

  return bot;
}
