// Dispatch layer — the bot's routing "sitemap": command map, callback tables (exact + prefix),
// text-mode handlers, and createBot(). Extracted from bot.ts (god-file split); behavior unchanged.
// Handlers are imported from "../bot"; nothing in bot.ts's handler bodies depends on this module
// except four symbols re-imported back, so the dependency is essentially one-way.
import { Bot, InlineKeyboard } from "grammy";
import { type InlineImage, RateLimitError, aiJSON, aiTranscribe } from "../ai";
import { type Per100g, lookupPer100gCached } from "../ai/nutritionDb";
import * as P from "../ai/prompts";
import { aliasMenu, checkinScale, mealActionsKb, menuBtn, roleMenu } from "./keyboards";
import { cmdAdmin, cmdAnnounce, cmdOwnerReport, cmdRefreshVideos, cmdSetVideo, cmdUsers, cmdWhatsNew, handleAnnounce, handleVideoUrl, onWhatsNewSend, showWhatsNewConfirm } from "./owner";
import { obProgress, onboardingStep } from "./onboarding";
import { onPlanRegenAi } from "./plan";
import { showCardioMenu, showEveningSurvey } from "./survey";
import { cmdBecomeTrainer, cmdClients, cmdLeaveTrainer, cmdLibrary, cmdRequests, cmdShareProgram, cmdTrainer, cmdTrainerFinance, cmdTrainerQuestions, goalToTag, handleAnswerQuestion, handleBillingPaid, handleBillingSessions, handleTemplateName, onTrainerLimitCycle, openFindTrainer, openTrainerEdit, shareAssignToClients, showCatalog, showLangPicker, showTagPicker, startShareMyPlan, toggleShareAll, trainerMenuActionFor, trainerSteps, twAdvance } from "./trainer";
import { addProgressPhoto, awardAchievement, bumpEvent, deleteUserData, getActivePlan, getFoodTranslations, getMealPlan, getOrCreateUser, getTrainer, getUser, getWorkoutLog, recordAdjustment, recordDailyCheckin, recordPlanSource, saveMealPlan, setActivePlan, setLastSeen, updateTrainer, updateUser, upsertFoodTranslations, upsertWorkoutLog, userStatCounts } from "../db/repos";
import { computeXp, levelFromXp } from "../domain/gamification";
import { buildTemplateMealDay, dishName, expandExclusions } from "../domain/mealTemplate";
import { computeTargets, isPlausiblePer100g, solvePortions, splitMeals, sumItems } from "../domain/mealplan";
import { phaseKey } from "../domain/mesocycle";
import { goalBucket } from "../domain/planBank";
import { localParts, weeksSincePlan } from "../domain/progression";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { renderMealPlan } from "../render";
import { type Env, type Lang, type Meal, type MealPlanDoc, type NutritionTargets, type SessionMode, type Weekday } from "../types";
import { setAppUrl, MyContext, TKey, handleAliasInput, handleWeightEdit, handleSetsEdit, handleSwapCustom, handleAddExercise, handleExerciseAltText, handleWarmupEdit, handleSessionLink, menuActionFor, isEditingOther, adjustDifficulty, aiAuthorAndAdd, cmdAskInactive, cmdCalendar, cmdChallenges, cmdCleanup, cmdCoach, cmdDeleteMe, cmdExport, cmdFeedback, cmdHelp, cmdHideKeyboard, cmdInterview, cmdLang, cmdLog, cmdLogPast, cmdMeasure, cmdMenu, cmdNutrition, cmdPlan, cmdPlates, cmdProgress, cmdRecords, cmdReplan, cmdReport, cmdSchedule, cmdSettings, cmdStandards, cmdStart, cmdSteps, cmdToday, cmdTrainerBroadcast, cmdTrainerReport, cmdVacation, cmdVolume, cmdWater, cmdWeekCard, cmdWellbeing, coachContext, defaultLang, endVacation, guardLogExit, handleCoach, handleExerciseConfirmation, handleNutrition, handlePhotoMeal, handleWorkoutLog, logBackToPick, logFinish, logSwitchToText, normalizeEvent, notifyTrainerWorkout, onCleanupAll, onGoalMaintain, onInactiveReply, onLevelUp, onLogExit, onMacrosSuggest, onMealConfirm, openSetsEditor, openWeightEditor, pickCycleLength, reply, setAlias, setMode, showAddDayPicker, showAthleteMenu, showChallengePicker, showCycleCalendar, showCycleSettings, showDayManager, showExerciseList, showInjuryAreas, showMealConfirm, showMealItemEditor, showMoreMenu, showMyLogHub, showNextSession, showOwnerHub, showProgressHub, showRecentFoods, showReminderSettings, showShareSettings, showTrainerCalendar, showTrainerClientsMenu, showWorkoutInfo, startAddExercise, startInterview, startSwapCustom, toggleCompete, toggleCycleTracking, undoDelete } from "../bot";

import { getCatalogExercise, updatePlanMesocycle } from "../db/repos";
import { INJURY_AREAS, type InjuryArea } from "../domain/injury";
import { defaultMesocycle, phaseGuidance } from "../domain/mesocycle";
import { onboardingButton } from "./onboarding";
import { ownerUserAction, sendOwnerSection, startVideoPick, startVideoSet } from "./owner";
import { handleCardioLog, onSurveyItem, showCardioPlans, showCardioSession, startCardioLog } from "./survey";
import { clientCardAction, handleClientLogEdit, handleClientNote, handleClientReply, handleReviewText, handleShareMyPlanName, handleTrainerBirthday, handleTrainerHealth, handleTrainerMessage, handleTrainerNote, handleTrainerPersonal, handleTwText, joinByCode, onMiniInterview, onQuestionOwn, onQuestionSend, onQuestionSkip, onRequestAccept, onRequestCancel, onRequestDecline, onReviewRate, onTemplateDelete, onTrainerApprove, onTrainerReject, requestTrainerStart, shareLink, sharePublish, shareTemplateMenu, showClientLogDay, showSharedProgram, showTrainerProfile, startClientLogEdit, startReview, startShareSelect, takeSharedProgram, toggleShareClient, trainerWizardButton, twEditField } from "./trainer";
import { applyCatalogExerciseChoice, comebackButton, confirmDeleteDay, createPlanDay, deleteExerciseFromToday, deletePlanDay, endReorder, endSelfEdit, groupPickDone, handleBodyEdit, handleCalcWeight, handleCoachAction, handleComebackText, handleFeedback, handleFoodProduct, handleFoodWeight, handleGoalWeight, handleInactiveFeedback, handleLogDraftInput, handleMealClarify, handleMealItemFix, handleMealMacroEdit, handleMeasure, handleMyLogNutritionEdit, handleMyLogWorkoutEdit, handleSkipReason, handleStepsLog, handleTrainerBroadcast, handleVacationCustom, logPickExercise, logSwapFromCatalog, moveExercise, onBookDate, onBookNav, onCalDay, onCalNav, onChallengeJoin, onCleanupDelete, onClientBookHour, onCycleCalNav, onExerciseChart, onFoodDelete, onFoodEditProduct, onFoodEditWeight, onGroupBookHour, onInjuryExtend, onInjuryRecovered, onInjuryScore, onMealItemDelete, onMealItemMenu, onMealItemReplace, onMealPortion, onQualityRating, onReLog, onReminderToggle, onRestTimer, onSessionAction, onSetHour, onSetTz, onSmartHour, onToggleDay, onTrainerBookHour, onTrainerCalDay, onTrainerCalNav, onWaterAction, openSetting, pickCycleDate, reportInjury, resumePendingPlan, saveWarmup, selectExerciseSets, selectExerciseWeight, sendSessionIcs, setCycleLength, setEntryRpe, setVacationDays, showDayGroupPicker, showDeleteExerciseMenu, showFoodItem, showInjurySeverity, showInjuryTrend, showLogSwapAlternatives, showMyLogNutritionDay, showMyLogWorkoutDay, showReorder, showSwapAlternatives, showWarmupEditor, startClientBooking, startGroupBooking, startMealMacroEdit, startMyLogNutritionEdit, startMyLogWorkoutEdit, startPastLog, startSessionLink, startSetEdit, startTrainerBooking, suggestWarmup, swapFromCatalog, swapMenu, toggleGroupPick, toggleShare } from "../bot";

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
  "menu:tcal": showTrainerCalendar,
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
  "menu:finance": cmdTrainerFinance,
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

export function createBot(env: Env, exCtx?: ExecutionContext): Bot<MyContext> {
  setAppUrl(env.WORKER_URL);
  const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN);

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
    // Record the LAST GENUINE interaction (only here — never from the cron). This is the only
    // reliable "is this user active" signal (users.updatedAt is bumped by the scheduler too).
    ctx.waitUntil(setLastSeen(ctx.db, ctx.user._id, new Date().toISOString()));
    // Owner-banned users are ignored entirely until the owner unblocks them.
    if (ctx.user.blocked) return;
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
  bot.command("log", cmdLog);
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
  bot.command("export", cmdExport);
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

  // Anything else (sticker, document, video, …): we can't read it.
  bot.on("message", async (ctx) => {
    await reply(ctx, t(ctx.user.lang, "unsupported_msg")).catch(() => {});
  });

  return bot;
}

export async function onError(ctx: MyContext, err: unknown, where: string) {
  if (err instanceof RateLimitError) {
    await reply(ctx, t(ctx.user.lang, "limit_hit"));
    return;
  }
  console.error(`${where} handler error`, err);
  // For any AI-related failure show a retry hint instead of a scary generic error.
  await reply(ctx, t(ctx.user.lang, "ai_retry"));
}

// Celebrate crossing an XP level — called after XP-earning actions (workout, meal, check-in,
// steps). The first sighting is persisted silently so existing users aren't congratulated
// retroactively for levels they passed before the feature shipped.
export async function maybeCelebrateLevel(ctx: MyContext) {
  try {
    const counts = await userStatCounts(ctx.db, ctx.user._id);
    const lv = levelFromXp(computeXp(counts));
    const last = ctx.user.reminders?.lastLevel;
    if (last === lv.level) return;
    const reminders = { ...ctx.user.reminders, lastLevel: lv.level };
    await updateUser(ctx.db, ctx.user._id, { reminders });
    ctx.user.reminders = reminders;
    if (last !== undefined && lv.level > last) {
      await reply(ctx, t(ctx.user.lang, "levelup_msg", { level: lv.level, xp: lv.xp }));
      const badge = lv.level >= 10 ? "level_10" : lv.level >= 5 ? "level_5" : null;
      if (badge) await awardAchievement(ctx.db, ctx.user._id, badge).catch(() => {});
    }
  } catch {
    /* celebration is best-effort */
  }
}

// Run a conversational AI handler past the webhook response (waitUntil) so the user gets
// instant feedback ("typing…") instead of the webhook blocking for the whole AI chain
// (up to ~26 s). Errors surface through onError, same as the old inline path. None of the
// deferred flows park the session in a waiting mode, so a (rare) evicted isolate just means
// no reply — the user's next message goes through the normal route again.
export function deferAi(ctx: MyContext, where: string, work: () => Promise<void>) {
  ctx.waitUntil(
    (async () => {
      try {
        await work();
      } catch (err) {
        await onError(ctx, err, where).catch(() => {});
      }
    })(),
  );
}

// Route a unit of user text (typed OR transcribed from voice) by the current session mode.
// A menu-keyboard tap takes priority over the active mode (except during onboarding).
// ---------- /checkin — subjective daily wellbeing (energy / sleep / stress, 1-5) ----------


export async function cmdCheckin(ctx: MyContext) {
  const lang = ctx.user.lang;
  await updateUser(ctx.db, ctx.user._id, {
    session: { ...ctx.user.session, mode: "checkin_energy", checkin: {} },
  });
  ctx.user.session = { ...ctx.user.session, mode: "checkin_energy", checkin: {} };
  await reply(ctx, t(lang, "checkin_q_energy"), checkinScale("energy"));
}

export async function handleCheckinCallback(ctx: MyContext, data: string) {
  const lang = ctx.user.lang;
  const [, step, nStr] = data.split(":");
  const n = Number(nStr);
  if (!Number.isInteger(n) || n < 1 || n > 5) return;
  // Ignore a stale/double-tapped answer whose step doesn't match the current question — otherwise
  // a re-delivered "energy" tap re-sends the sleep prompt (the duplicate-question bug).
  const expectMode = step === "energy" ? "checkin_energy" : step === "sleep" ? "checkin_sleep" : "checkin_stress";
  if (ctx.user.session.mode !== expectMode) { await ctx.answerCallbackQuery().catch(() => {}); return; }
  const checkin = { ...(ctx.user.session.checkin ?? {}) };
  if (step === "energy") {
    checkin.energy = n;
    await persistCheckinState(ctx, "checkin_sleep", checkin);
    await reply(ctx, t(lang, "checkin_q_sleep"), checkinScale("sleep"));
  } else if (step === "sleep") {
    checkin.sleep = n;
    await persistCheckinState(ctx, "checkin_stress", checkin);
    await reply(ctx, t(lang, "checkin_q_stress"), checkinScale("stress"));
  } else if (step === "stress") {
    const energy = checkin.energy ?? 3;
    const sleep = checkin.sleep ?? 3;
    const stress = n;
    const { date, weekday } = localParts(ctx.user.profile.timezone);
    await recordDailyCheckin(ctx.db, ctx.user._id, date, energy, sleep, stress);
    await persistCheckinState(ctx, "idle", undefined);
    await reply(ctx, t(lang, "checkin_saved", { e: energy, s: sleep, st: stress }));
    // Context-aware advice: 2+ readiness markers ≤ 2 → back off; otherwise "train as planned"
    // ONLY when a session is still ahead today (training day, not yet logged) — else frame it as
    // recovery so we never tell someone to train on a rest day or after they've already trained.
    const low = [energy, sleep, stress].filter((v) => v <= 2).length >= 2;
    const trainingToday = (ctx.user.profile.trainingWeekdays ?? []).includes(weekday);
    const trainedAlready = trainingToday ? !!(await getWorkoutLog(ctx.db, ctx.user._id, date)) : false;
    const key = low ? "checkin_low" : trainingToday && !trainedAlready ? "checkin_ok" : "checkin_ok_rest";
    await reply(ctx, t(lang, key), menuBtn(lang));
    await maybeCelebrateLevel(ctx);
    if (ctx.user.session.survey) await showEveningSurvey(ctx);
  }
}

export async function persistCheckinState(
  ctx: MyContext,
  mode: "checkin_sleep" | "checkin_stress" | "idle",
  checkin: { energy?: number; sleep?: number } | undefined,
) {
  const session = { ...ctx.user.session, mode, checkin };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// ---------- bi-weekly adaptive check-in: AI micro-adjusts the live plan ----------

export async function handleAdaptiveCheckin(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  await setMode(ctx, "idle");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "coach", async () => {
    const result = await aiJSON<P.AdaptiveResult>(ctx.env, {
      system: P.adaptiveAdjustmentSystem(lang, ctx.user.profile, await coachContext(ctx)),
      user: text,
      schema: P.ADAPTIVE_SCHEMA,
      temperature: 0.5,
      kind: "coach",
      db: ctx.db,
      userId: ctx.user._id,
    });
    // Apply each micro-adjustment to the live plan (only the fields the AI changed).
    const applied: string[] = [];
    for (const adj of result.adjustments ?? []) {
      const day = plan.split.find((d) => d.weekday === adj.weekday);
      const ex = day?.exercises[adj.index];
      if (!ex) continue;
      if (adj.sets) ex.sets = cleanAi(adj.sets);
      if (adj.startWeight) ex.startWeight = cleanAi(adj.startWeight);
      if (adj.sets || adj.startWeight) {
        applied.push(`${ex.name}: ${ex.sets} · ${ex.startWeight}`);
      }
    }
    if (applied.length) {
      await setActivePlan(ctx.db, plan);
      const week = weeksSincePlan(plan.generatedAt.toISOString(), localParts(ctx.user.profile.timezone).date);
      await recordAdjustment(ctx.db, ctx.user._id, week, JSON.stringify(result.adjustments ?? []));
    }
    const summary = applied.length ? "\n\n" + applied.map((a) => `• ${escapeHtml(a)}`).join("\n") : "";
    await reply(ctx, escapeHtml(cleanAi(result.reply)) + summary, menuBtn(lang));
  });
}

// ---------- /mealplan — AI nutritionist (daily menu, grounded in USDA/OFF) ----------

// Quick nutrition intake (checkin-style buttons): allergens → likes → dislikes, then generate.
export const MP_ALLERGENS = ["lactose", "gluten", "nuts", "eggs", "seafood", "soy"] as const;
export const MP_ALLERGEN_KEY: Record<string, TKey> = {
  lactose: "mp_al_lactose", gluten: "mp_al_gluten", nuts: "mp_al_nuts",
  eggs: "mp_al_eggs", seafood: "mp_al_seafood", soy: "mp_al_soy",
};

export function mpAllergenKb(lang: Lang, selected: string[]): InlineKeyboard {
  const sel = new Set(selected);
  const kb = new InlineKeyboard();
  MP_ALLERGENS.forEach((a, idx) => {
    kb.text(`${sel.has(a) ? "✅ " : ""}${t(lang, MP_ALLERGEN_KEY[a])}`, `mpa:${a}`);
    if ((idx + 1) % 2 === 0) kb.row();
  });
  return kb.row().text(t(lang, "mp_al_none"), "mpa:none").text(t(lang, "ob_done"), "mpa:done");
}

export const mpSkipKb = (lang: Lang) => new InlineKeyboard().text(t(lang, "mp_skip"), "mp:skip");

export async function cmdMealPlan(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!computeTargets(ctx.user.profile, plan?.nutrition).calories) {
    await reply(ctx, t(lang, "mealplan_no_targets"), menuBtn(lang));
    return;
  }
  // Show the last-built menu first (with regenerate + menu controls below it) instead of
  // jumping straight into the intake flow. Only start intake when nothing has been built yet.
  const existing = await getMealPlan(ctx.db, ctx.user._id);
  if (existing?.days?.length) {
    const kb = new InlineKeyboard()
      .text(t(lang, "mp_regenerate"), "mp:regen")
      .row()
      .text(t(lang, "menu_open"), "menu:open");
    await reply(ctx, renderMealPlan(lang, existing), kb);
    return;
  }
  await startMealPlanIntake(ctx);
}

// Begin the allergens → likes → dislikes intake that feeds meal-plan generation.
// When preferences were already collected once, offer to reuse them instead of re-asking
// the full questionnaire on every regenerate.
export async function startMealPlanIntake(ctx: MyContext) {
  const lang = ctx.user.lang;
  const p = ctx.user.profile;
  if (p.allergies !== undefined || p.foodLikes !== undefined || p.foodDislikes !== undefined) {
    const none = t(lang, "mp_prev_none");
    const kb = new InlineKeyboard()
      .text(t(lang, "mp_prev_keep"), "mp:useprev")
      .text(t(lang, "mp_prev_change"), "mp:redo");
    await reply(
      ctx,
      t(lang, "mp_prev_summary", {
        allergens: p.allergies || none,
        likes: p.foodLikes || none,
        dislikes: p.foodDislikes || none,
      }),
      kb,
    );
    return;
  }
  await beginMealPlanIntake(ctx);
}

export async function beginMealPlanIntake(ctx: MyContext) {
  const lang = ctx.user.lang;
  ctx.user.session = { ...ctx.user.session, mode: "mp_allergens", mpAllergens: [] };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "mp_q_allergens"), mpAllergenKb(lang, []));
}

// Allergen multi-select buttons: mpa:<key> toggles; mpa:none / mpa:done advance to likes.
export async function mealAllergenButton(ctx: MyContext, payload: string) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode !== "mp_allergens") return;
  if (payload === "none" || payload === "done") {
    const sel = payload === "none" ? [] : (ctx.user.session.mpAllergens ?? []);
    ctx.user.profile = { ...ctx.user.profile, allergies: sel.length ? sel.join(", ") : "none" };
    ctx.user.session = { ...ctx.user.session, mode: "mp_likes", mpAllergens: undefined };
    await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile, session: ctx.user.session });
    await reply(ctx, t(lang, "mp_q_likes"), mpSkipKb(lang));
    return;
  }
  const cur = new Set(ctx.user.session.mpAllergens ?? []);
  cur.has(payload) ? cur.delete(payload) : cur.add(payload);
  ctx.user.session = { ...ctx.user.session, mpAllergens: [...cur] };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await ctx.editMessageReplyMarkup({ reply_markup: mpAllergenKb(lang, [...cur]) }).catch(() => {});
}

// Free-text intake answers (likes/dislikes).
export async function mealIntakeText(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode === "mp_likes") {
    ctx.user.profile = { ...ctx.user.profile, foodLikes: text };
    ctx.user.session = { ...ctx.user.session, mode: "mp_dislikes" };
    await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile, session: ctx.user.session });
    await reply(ctx, t(lang, "mp_q_dislikes"), mpSkipKb(lang));
  } else if (ctx.user.session.mode === "mp_dislikes") {
    ctx.user.profile = { ...ctx.user.profile, foodDislikes: text };
    await startMealGeneration(ctx);
  }
}

export async function mealSkip(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode === "mp_likes") {
    ctx.user.session = { ...ctx.user.session, mode: "mp_dislikes" };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "mp_q_dislikes"), mpSkipKb(lang));
  } else if (ctx.user.session.mode === "mp_dislikes") {
    await startMealGeneration(ctx);
  }
}

export async function startMealGeneration(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const targets = computeTargets(ctx.user.profile, plan?.nutrition);
  ctx.user.session = { ...ctx.user.session, mode: "idle" };
  await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile, session: ctx.user.session });
  await reply(ctx, t(lang, "mealplan_generating"));
  // Heavy (1 LLM call + cached USDA lookups) → defer past the webhook response.
  ctx.waitUntil(deliverMealPlan(ctx, targets));
}

export async function deliverMealPlan(ctx: MyContext, targets: NutritionTargets, useAi = false) {
  const lang = ctx.user.lang;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const mealsPerDay = 4;
    const mealSplit = splitMeals(targets, mealsPerDay);
    const p = ctx.user.profile;
    const excluded = [p.allergies, p.dietPrefs, p.foodDislikes]
      .filter((x) => x && x.toLowerCase() !== "none")
      .join("; ");
    const likes = p.foodLikes ?? "";
    // Turn a raw day (AI- or template-produced) into solved, macro-accurate meals.
    const solveDay = async (rawMeals: { name: string; items: { food_name: string; grams: number }[] }[]): Promise<Meal[]> => {
      // Batch all per-100g lookups for the whole day in parallel (deduped) instead of one-by-one.
      const names = [...new Set((rawMeals ?? []).flatMap((m) => (m.items ?? []).map((it) => it.food_name)))];
      const refs = new Map<string, Per100g | null>(
        await Promise.all(names.map(async (n) => [n, await lookupPer100gCached(ctx.db, ctx.env, n)] as const)),
      );
      const meals: Meal[] = [];
      for (let i = 0; i < (rawMeals ?? []).length; i++) {
        const m = rawMeals[i];
        const target = mealSplit[i] ?? mealSplit[mealSplit.length - 1];
        const cands: { food: string; grams: number; per100g: { kcal: number; protein: number; fats: number; carbs: number } }[] = [];
        for (const it of m.items ?? []) {
          const ref = refs.get(it.food_name) ?? null;
          if (ref && isPlausiblePer100g(ref)) cands.push({ food: it.food_name.trim(), grams: it.grams, per100g: ref });
        }
        if (!cands.length) continue;
        const solved = solvePortions(cands, target);
        const trimmed = solved.filter((it) => it.grams > 5);
        const items = trimmed.length ? trimmed : solved;
        meals.push({ name: m.name.trim(), items, ...sumItems(items) });
      }
      return meals;
    };

    const { date } = localParts(ctx.user.profile.timezone);
    // One realistic day. Template = deterministic human composition (zero AI); AI = Gemini.
    const rawDay = useAi
      ? (await aiJSON<P.MealDayResult>(ctx.env, {
          system: P.mealDaySystem({ mealsPerDay, daily: targets, mealSplit, excluded, likes }),
          user: "Generate the day's meals now as JSON.",
          schema: P.MEAL_DAY_SCHEMA,
          kind: "meal_plan",
          groqModel: "openai/gpt-oss-120b",
          temperature: 0.5,
          db: ctx.db,
          userId: ctx.user._id,
        })).meals
      : buildTemplateMealDay(mealsPerDay, { goal: goalBucket(p.goal), excluded: expandExclusions(excluded), seed: ctx.user._id }).meals;
    const meals = await solveDay(rawDay);
    if (!meals.length) throw new Error("no foods matched USDA/OFF");
    const localized = await localizeMealNames(ctx.env, ctx.db, lang, ctx.user._id, meals);
    // Override the plain translation with a human dish name (porridge / boiled rice / cooked
    // lentils…) for known foods — keyed by the original English food so the lookup stayed exact.
    const display = localized.map((m, mi) => ({
      ...m,
      items: m.items.map((item, ii) => {
        const dish = dishName(meals[mi].items[ii]?.food ?? "", lang);
        return dish ? { ...item, food: dish } : item;
      }),
    }));
    const doc: MealPlanDoc = { userId: ctx.user._id, week: 0, days: [{ label: date, meals: display }], targets, generatedAt: new Date() };
    await saveMealPlan(ctx.db, doc);
    await recordPlanSource(ctx.db, ctx.user._id, "meal", useAi ? "ai" : "template").catch(() => {});
    // A template menu is instant; offer a one-tap AI version. An AI menu just used Gemini.
    const kb = useAi ? menuBtn(lang) : mealActionsKb(lang);
    await reply(ctx, renderMealPlan(lang, doc), kb);
  } catch (err) {
    console.error("deliverMealPlan failed", ctx.user._id, err);
    // A rate-limited chain is "try later", not "generation failed" — align with onError's UX.
    const key = err instanceof RateLimitError ? "limit_hit" : "mealplan_failed";
    await reply(ctx, t(lang, key), menuBtn(lang)).catch(() => {});
  }
}


// "Generate with AI" button under a template meal plan → rebuild the menu via Gemini.
export async function onMealRegenAi(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const targets = computeTargets(ctx.user.profile, plan?.nutrition);
  await reply(ctx, t(lang, "mealplan_generating"));
  ctx.waitUntil(deliverMealPlan(ctx, targets, true));
}

// Translate the day's English food + meal names to the user's language in one batched
// translate call (Gemini-first chain, deduped names). Best-effort: any failure leaves the
// English names so the menu still renders.
export async function localizeMealNames(env: Env, db: D1Database, lang: Lang, userId: number, meals: Meal[]): Promise<Meal[]> {
  if (lang === "en") return meals;
  const names = [...new Set([...meals.map((m) => m.name), ...meals.flatMap((m) => m.items.map((it) => it.food))])].filter(Boolean);
  if (!names.length) return meals;
  // Prefer the seeded/cached translations (consistent names, no AI call); only translate the
  // misses, then cache them so the same foods never hit the AI again.
  const cached = await getFoodTranslations(db, names, lang).catch(() => new Map<string, string>());
  const map = new Map<string, string>();
  for (const n of names) {
    const hit = cached.get(n.toLowerCase().trim());
    if (hit) map.set(n, hit);
  }
  const missing = names.filter((n) => !map.has(n));
  if (missing.length) {
    try {
      const result = await aiJSON<P.TranslateFoodsResult>(env, {
        system: P.translateFoodsSystem(lang),
        user: P.translateFoodsUser(missing),
        schema: P.TRANSLATE_FOODS_SCHEMA,
        temperature: 0.2,
        kind: "translate",
        db,
        userId,
      });
      const fresh: { en: string; name: string }[] = [];
      for (const it of result.items ?? []) {
        const local = cleanAi(it.local ?? "");
        if (it.en && local) { map.set(it.en, local); fresh.push({ en: it.en, name: local }); }
      }
      if (fresh.length) await upsertFoodTranslations(db, lang, fresh).catch(() => {});
    } catch {
      /* leave misses in English */
    }
  }
  return meals.map((m) => ({
    ...m,
    name: map.get(m.name) ?? m.name,
    items: m.items.map((it) => ({ ...it, food: map.get(it.food) ?? it.food })),
  }));
}

// ===================== Callback routing tables =====================
// Every callback_query route is declared here instead of a 570-line if-chain. Dispatch order:
// exact match first, then CB_PREFIX scanned IN REGISTRATION ORDER (first match wins) — so a
// more specific prefix MUST be registered before the shorter one it extends ("pday:delok:"
// before "pday:del:", "wt:open:" before "wt:"). A module-load sanity check below throws on any
// registration where an earlier prefix would shadow a later one, so a bad ordering fails in
// tests instead of silently mis-routing taps in production.
type CbHandler = (ctx: MyContext, rest: string, data: string) => Promise<unknown> | unknown;

const pickLang: CbHandler = async (ctx, _rest, data) => {
  const lang: Lang = data === "lang:uk" ? "uk" : "en";
  const wasOnboarded = ctx.user.onboarded;
  await updateUser(ctx.db, ctx.user._id, { lang });
  ctx.user.lang = lang;
  await reply(ctx, t(lang, "lang_set"));
  if (wasOnboarded) {
    await reply(ctx, t(lang, "welcome_back"), menuBtn(lang));
  } else {
    // Language chosen first → now disclaimer + role choice (AI / trainer / client).
    await reply(ctx, t(lang, "disclaimer"));
    await reply(ctx, t(lang, "role_choose"), roleMenu(lang));
  }
};

// Voice-note confirmations share the pendingVoice hand-off.
const voiceRoute: CbHandler = async (ctx, _rest, data) => {
  const heard = ctx.user.session.pendingVoice;
  ctx.user.session = { ...ctx.user.session, pendingVoice: undefined };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await ctx.answerCallbackQuery().catch(() => {});
  if (!heard) return;
  if (data === "voice:ok") await routeUserText(ctx, heard);
  else if (data === "voice:wk") await handleWorkoutLog(ctx, heard);
  else if (data === "voice:food") await handleNutrition(ctx, heard);
  else await handleCoach(ctx, heard);
};

export const CB_EXACT: Record<string, CbHandler> = {
  "lang:uk": pickLang,
  "lang:ru": pickLang,
  "lang:en": pickLang,
  "menu:open": (ctx) => cmdMenu(ctx),
  "log:back": (ctx) => logBackToPick(ctx),
  "log:finish": (ctx) => logFinish(ctx),
  "log:text": (ctx) => logSwitchToText(ctx),
  "logpast:menu": (ctx) => cmdLogPast(ctx),
  "xexit:save": (ctx) => onLogExit(ctx, "save"),
  "xexit:drop": (ctx) => onLogExit(ctx, "drop"),
  "xexit:stay": (ctx) => onLogExit(ctx, "stay"),
  "share:week": (ctx) => cmdWeekCard(ctx),
  "mp:skip": (ctx) => mealSkip(ctx),
  "mp:regen": (ctx) => startMealPlanIntake(ctx),
  "mp:useprev": (ctx) => startMealGeneration(ctx),
  "mp:redo": (ctx) => beginMealPlanIntake(ctx),
  "plan:ai": (ctx) => onPlanRegenAi(ctx),
  "meal:ai": (ctx) => onMealRegenAi(ctx),
  "levelup:yes": (ctx) => onLevelUp(ctx),
  "goal:maintain": (ctx) => onGoalMaintain(ctx),
  "levelup:no": (ctx) => ctx.answerCallbackQuery(t(ctx.user.lang, "levelup_dismissed")).catch(() => {}),
  "goal:keep": (ctx) => ctx.answerCallbackQuery(t(ctx.user.lang, "levelup_dismissed")).catch(() => {}),
  "voice:ok": voiceRoute,
  "voice:wk": voiceRoute,
  "voice:food": voiceRoute,
  "voice:coach": voiceRoute,
  "voice:no": async (ctx) => {
    ctx.user.session = { ...ctx.user.session, pendingVoice: undefined };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await ctx.answerCallbackQuery().catch(() => {});
    await reply(ctx, t(ctx.user.lang, "voice_retry"));
  },
  "checkin:start": (ctx) => cmdCheckin(ctx),
  // "✅ Виконав" on the Today menu / workout reminder → open the guided logger (exercise
  // list). Finalizing the draft is a separate "log:finish" button inside that logger.
  "log:done": (ctx) => cmdLog(ctx),
  "log:skip": async (ctx) => {
    const lang = ctx.user.lang;
    const { date, weekday } = localParts(ctx.user.profile.timezone);
    await upsertWorkoutLog(ctx.db, ctx.user._id, date, weekday as Weekday, [], false);
    await reply(ctx, t(lang, "reminder_checkin"), menuBtn(lang));
    await notifyTrainerWorkout(ctx, false, 0);
    await showNextSession(ctx);
  },
  "workout:info": (ctx) => showWorkoutInfo(ctx),
  // --- roles / pairing / trainer dashboard ---
  "role:ai": (ctx) => startInterview(ctx), // language already chosen first → AI interview directly
  "role:find": (ctx) => openFindTrainer(ctx),
  "role:trainer": (ctx) => cmdBecomeTrainer(ctx),
  "find:browse": (ctx) => showCatalog(ctx),
  "catf:goal": async (ctx) => {
    const tag = goalToTag(ctx.user.profile.goal);
    if (tag) await showCatalog(ctx, { tag });
    else await showTagPicker(ctx);
  },
  "catf:tag": (ctx) => showTagPicker(ctx),
  "catf:lang": (ctx) => showLangPicker(ctx),
  "find:code": async (ctx) => {
    await setMode(ctx, "client_code");
    await reply(ctx, t(ctx.user.lang, "enter_code_prompt"));
  },
  "cal:noop": () => {},
  "shr:all": (ctx) => toggleShareAll(ctx),
  "shr:go": (ctx) => shareAssignToClients(ctx),
  "photo:skip": async (ctx) => {
    ctx.user.session = { ...ctx.user.session, photoReviewFor: undefined };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(ctx.user.lang, "photo_req_skipped"), menuBtn(ctx.user.lang));
  },
  "tr:toggle": async (ctx) => {
    const tr = await getTrainer(ctx.db, ctx.user._id);
    if (tr) await updateTrainer(ctx.db, ctx.user._id, { accepting: !tr.accepting });
    await cmdTrainer(ctx);
  },
  "tr:limit": (ctx) => onTrainerLimitCycle(ctx),
  "tr:bio": (ctx) => openTrainerEdit(ctx),
  "tr:edit": (ctx) => openTrainerEdit(ctx),
  "tr:broadcast": (ctx) => cmdTrainerBroadcast(ctx),
  // Solo self-correct: browse own past days and rewrite a workout/nutrition day.
  "mylog:open": (ctx) => showMyLogHub(ctx, "workout"),
  "mylog:tab:w": (ctx) => showMyLogHub(ctx, "workout"),
  "mylog:tab:n": (ctx) => showMyLogHub(ctx, "nutrition"),
  "undo:del": (ctx) => undoDelete(ctx),
  "ex:yes": (ctx) => handleExerciseConfirmation(ctx, true),
  "ex:no": (ctx) => handleExerciseConfirmation(ctx, false),
  "exa:type": async (ctx) => {
    const pending = ctx.user.session.pendingExercise;
    if (!pending) { await setMode(ctx, "idle"); await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang)); return; }
    if (pending.action === "swap" && pending.index !== undefined) {
      await startSwapCustom(ctx, pending.weekday, pending.index);
    } else {
      await startAddExercise(ctx, pending.weekday);
    }
  },
  "exa:ai": async (ctx) => {
    const pending = ctx.user.session.pendingExercise;
    await setMode(ctx, "idle");
    if (!pending) { await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang)); return; }
    await aiAuthorAndAdd(ctx, pending);
  },
  "diff:ok": (ctx, _r, data) => adjustDifficulty(ctx, data.slice(5) as "ok" | "up" | "down"),
  "diff:up": (ctx, _r, data) => adjustDifficulty(ctx, data.slice(5) as "ok" | "up" | "down"),
  "diff:down": (ctx, _r, data) => adjustDifficulty(ctx, data.slice(5) as "ok" | "up" | "down"),
  "ord:noop": (ctx) => ctx.answerCallbackQuery().catch(() => {}),
  // Plan-day management (add/delete whole days).
  "pday:open": (ctx) => showDayManager(ctx),
  "pday:add": (ctx) => showAddDayPicker(ctx),
  "wt:open": (ctx) => openWeightEditor(ctx),
  "st:open": (ctx) => openSetsEditor(ctx),
  "set:compete": (ctx) => toggleCompete(ctx),
  "set:alias": (ctx) => reply(ctx, t(ctx.user.lang, "alias_prompt"), aliasMenu(ctx.user.lang)),
  "alias:name": (ctx) => setAlias(ctx, ctx.user.profile.name ?? ""),
  "alias:anon": (ctx) => setAlias(ctx, ""),
  "alias:custom": async (ctx) => {
    await setMode(ctx, "records_alias");
    await reply(ctx, t(ctx.user.lang, "alias_ask"));
  },
  "set:reminders": (ctx) => showReminderSettings(ctx),
  "set:share": (ctx) => showShareSettings(ctx),
  "share:skip": (ctx) => reply(ctx, t(ctx.user.lang, "share_skipped")),
  "set:cycle": (ctx) => showCycleSettings(ctx),
  "cycle:toggle": (ctx) => toggleCycleTracking(ctx),
  "cycle:logstart": (ctx) => showCycleCalendar(ctx),
  "cardio:menu": (ctx) => showCardioMenu(ctx),
  "cycle:len": (ctx) => pickCycleLength(ctx),
  "set:vacation": (ctx) => cmdVacation(ctx),
  "vac:custom": async (ctx) => { await setMode(ctx, "vacation_custom"); await reply(ctx, t(ctx.user.lang, "vacation_custom_prompt")); },
  "vac:end": (ctx) => endVacation(ctx),
  "clean:all": (ctx) => onCleanupAll(ctx, false),
  "clean:allyes": (ctx) => onCleanupAll(ctx, true),
  "clean:ask": (ctx) => cmdAskInactive(ctx),
  "inact:stay": (ctx) => onInactiveReply(ctx, "stay"),
  "inact:leave": (ctx) => onInactiveReply(ctx, "leave"),
  "inact:fbskip": async (ctx) => { await setMode(ctx, "idle"); await reply(ctx, t(ctx.user.lang, "inact_fb_thanks"), menuBtn(ctx.user.lang)); },
  "meal:ok": (ctx) => onMealConfirm(ctx, "ok"),
  "meal:fix": (ctx) => onMealConfirm(ctx, "fix"),
  "meal:cancel": (ctx) => onMealConfirm(ctx, "cancel"),
  "meal:edit": (ctx) => showMealItemEditor(ctx),
  "meal:back": (ctx) => showMealConfirm(ctx, ctx.user.session.pendingMeal ?? []),
  "food:recent": (ctx) => showRecentFoods(ctx),
  "exlist": (ctx) => showExerciseList(ctx),
  "std": (ctx) => cmdStandards(ctx),
  "vol": (ctx) => cmdVolume(ctx),
  "inj:report": (ctx) => showInjuryAreas(ctx),
  "calc": (ctx) => cmdPlates(ctx),
  "well": (ctx) => cmdWellbeing(ctx),
  "food:suggest": (ctx) => onMacrosSuggest(ctx),
  "wn:ask": (ctx) => showWhatsNewConfirm(ctx),
  "wn:send": (ctx) => onWhatsNewSend(ctx),
  "chal:new": (ctx) => showChallengePicker(ctx),
  "del:confirm": async (ctx) => {
    await deleteUserData(ctx.db, ctx.user._id);
    await reply(ctx, t(ctx.user.lang, "deleteme_done"));
  },
  "del:cancel": (ctx) => reply(ctx, t(ctx.user.lang, "deleteme_cancelled")),
  "invite": async (ctx) => {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.user._id}`;
    await reply(ctx, t(ctx.user.lang, "invite_msg", { link }), menuBtn(ctx.user.lang));
  },
  "photo:self": async (ctx) => {
    ctx.user.session = { ...ctx.user.session, photoSelf: true };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(ctx.user.lang, "photo_self_prompt"));
  },
  "tr:group": (ctx) => startGroupBooking(ctx),
  "meso:open": (ctx) => showMesocycle(ctx),
  "meso:on": (ctx) => setMesocycle(ctx, true),
  "meso:off": (ctx) => setMesocycle(ctx, false),
};

// Block periodization control: show current phase or offer to start/stop the cycle.
export async function showMesocycle(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) { await reply(ctx, t(lang, "meso_noplan"), menuBtn(lang)); return; }
  if (plan.mesocycle) {
    const g = phaseGuidance(plan.mesocycle.phase);
    const kb = new InlineKeyboard().text(t(lang, "meso_stop_btn"), "meso:off").row().text(t(lang, "menu_open"), "menu:open");
    await reply(ctx, `${g.emoji} <b>${t(lang, phaseKey(plan.mesocycle.phase) as TKey)}</b> · ${t(lang, "meso_week", { n: plan.mesocycle.weekInBlock, total: plan.mesocycle.phase === "deload" ? 1 : plan.mesocycle.blockLength })}\n${g.reps} · ${g.intensity}\n\n${t(lang, "meso_explain")}`, kb);
  } else {
    const kb = new InlineKeyboard().text(t(lang, "meso_start_btn"), "meso:on").row().text(t(lang, "menu_open"), "menu:open");
    await reply(ctx, t(lang, "meso_intro"), kb);
  }
}

export async function setMesocycle(ctx: MyContext, on: boolean) {
  const lang = ctx.user.lang;
  await updatePlanMesocycle(ctx.db, ctx.user._id, on ? defaultMesocycle() : null);
  await reply(ctx, t(lang, on ? "meso_started" : "meso_stopped"), menuBtn(lang));
}

// Booking calendars: bk:*/tb:* share handlers that read the full callback data.
const bookNav: CbHandler = (ctx, _rest, data) => {
  const [prefix, , tid, ym] = data.split(":");
  return onBookNav(ctx, prefix, Number(tid), ym);
};
const bookDate: CbHandler = (ctx, _rest, data) => {
  const [prefix, , tid, date] = data.split(":");
  return onBookDate(ctx, prefix, Number(tid), date);
};

export const CB_PREFIX: [string, CbHandler][] = [
  ["orep:", (ctx, rest) => sendOwnerSection(ctx, rest)],
  ["ob:", (ctx, rest) => onboardingButton(ctx, rest)],
  ["tw:", (ctx, _r, data) => trainerWizardButton(ctx, data)],
  ["twf:", (ctx, rest) => twEditField(ctx, rest)],
  ["rev:start:", (ctx, rest) => startReview(ctx, Number(rest))],
  ["rev:rate:", (ctx, _r, data) => { const [, , tid, n] = data.split(":"); return onReviewRate(ctx, Number(tid), Number(n)); }],
  ["log:ex:", (ctx, rest) => logPickExercise(ctx, Number(rest))],
  // On-the-fly swap while logging: pick an alternative for slot #i (does not touch the plan).
  ["logsw:", (ctx, rest) => showLogSwapAlternatives(ctx, Number(rest))],
  ["lswc:", (ctx, _r, data) => { const [, idx, cid] = data.split(":"); return logSwapFromCatalog(ctx, Number(idx), cid); }],
  ["lset:", (ctx, _r, data) => { const [, ei, si] = data.split(":"); return startSetEdit(ctx, Number(ei), Number(si)); }],
  ["srpe:", (ctx, _r, data) => { const [, ei, r] = data.split(":"); return setEntryRpe(ctx, Number(ei), Number(r)); }],
  ["logpast:", (ctx, rest) => startPastLog(ctx, rest)],
  ["skip:", (ctx, rest) => handleSkipReason(ctx, rest)],
  ["rest:", (ctx, rest) => onRestTimer(ctx, Number(rest))],
  ["msg:reply:", async (ctx, rest) => {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "msg_trainer", targetId: Number(rest) } });
    await reply(ctx, t(ctx.user.lang, "msg_reply_prompt"));
  }],
  ["mpa:", (ctx, rest) => mealAllergenButton(ctx, rest)],
  ["checkin:", (ctx, _r, data) => handleCheckinCallback(ctx, data)],
  ["sv:", (ctx, rest) => onSurveyItem(ctx, rest)],
  ["workout:add:", (ctx, rest) => startAddExercise(ctx, Number(rest) as Weekday)],
  ["workout:delete:", (ctx, _r, data) => {
    const parts = data.split(":");
    if (parts.length === 3) return showDeleteExerciseMenu(ctx, Number(parts[2]) as Weekday);
    return deleteExerciseFromToday(ctx, Number(parts[2]) as Weekday, Number(parts[3]));
  }],
  ["catft:", (ctx, rest) => showCatalog(ctx, { tag: rest })],
  ["catfl:", (ctx, rest) => showCatalog(ctx, { lang: rest })],
  ["cat:", (ctx, rest) => showTrainerProfile(ctx, Number(rest))],
  ["catreq:", (ctx, rest) => requestTrainerStart(ctx, Number(rest))],
  ["book:", (ctx, rest) => startClientBooking(ctx, Number(rest))],
  ["cal:nav:", (ctx, rest) => onCalNav(ctx, rest)],
  ["cal:d:", (ctx, rest) => onCalDay(ctx, rest)],
  ["tcal:nav:", (ctx, rest) => onTrainerCalNav(ctx, rest)],
  ["tcal:d:", (ctx, rest) => onTrainerCalDay(ctx, rest)],
  ["bk:nav:", bookNav],
  ["tb:nav:", bookNav],
  ["bk:d:", bookDate],
  ["tb:d:", bookDate],
  ["bk:h:", (ctx, _r, data) => { const [, , tid, date, h] = data.split(":"); return onClientBookHour(ctx, Number(tid), date, Number(h)); }],
  ["tb:h:", (ctx, _r, data) => { const [, , cid, date, h] = data.split(":"); return onTrainerBookHour(ctx, Number(cid), date, Number(h)); }],
  ["gb:nav:", (ctx, _r, data) => { const [, , , ym] = data.split(":"); return onBookNav(ctx, "gb", 0, ym); }],
  ["gb:d:", (ctx, _r, data) => { const [, , , date] = data.split(":"); return onBookDate(ctx, "gb", 0, date); }],
  ["gb:h:", (ctx, _r, data) => { const [, , , date, h] = data.split(":"); return onGroupBookHour(ctx, date, Number(h)); }],
  ["gb:back:", (ctx) => groupPickDone(ctx)],
  ["gpick:done", (ctx) => groupPickDone(ctx)],
  ["gpick:", (ctx, rest) => toggleGroupPick(ctx, Number(rest))],
  ["bk:back:", (ctx, rest) => startClientBooking(ctx, Number(rest))],
  ["tb:back:", (ctx, rest) => startTrainerBooking(ctx, Number(rest))],
  ["sess:ok:", (ctx, rest) => onSessionAction(ctx, "ok", Number(rest))],
  ["sess:link:", (ctx, rest) => startSessionLink(ctx, Number(rest))],
  ["tpldel:", (ctx, rest) => onTemplateDelete(ctx, Number(rest))],
  ["shr:t:", (ctx, rest) => shareTemplateMenu(ctx, Number(rest))],
  ["shr:sel:", (ctx, rest) => startShareSelect(ctx, Number(rest))],
  ["shr:link:", (ctx, rest) => shareLink(ctx, Number(rest))],
  ["shr:pub:", (ctx, rest) => sharePublish(ctx, Number(rest))],
  ["shrc:", (ctx, rest) => toggleShareClient(ctx, Number(rest))],
  ["prog:take:", (ctx, rest) => takeSharedProgram(ctx, rest)],
  ["prog:view:", (ctx, rest) => showSharedProgram(ctx, rest)],
  ["ics:", (ctx, rest) => sendSessionIcs(ctx, Number(rest))],
  ["sess:no:", (ctx, rest) => onSessionAction(ctx, "no", Number(rest))],
  ["sess:cx:", (ctx, rest) => onSessionAction(ctx, "cx", Number(rest))],
  ["req:accept:", (ctx, rest) => onRequestAccept(ctx, Number(rest))],
  ["req:decline:", (ctx, rest) => onRequestDecline(ctx, Number(rest))],
  ["req:cancel:", (ctx, rest) => onRequestCancel(ctx, Number(rest))],
  ["trainer:approve:", (ctx, rest) => onTrainerApprove(ctx, Number(rest))],
  ["trainer:reject:", (ctx, rest) => onTrainerReject(ctx, Number(rest))],
  ["clogedit:", (ctx, _r, data) => { const [, cid, date] = data.split(":"); return startClientLogEdit(ctx, Number(cid), date); }],
  ["clog:", (ctx, _r, data) => { const [, cid, date] = data.split(":"); return showClientLogDay(ctx, Number(cid), date); }],
  ["mylog:w:", (ctx, rest) => showMyLogWorkoutDay(ctx, rest)],
  ["mylog:n:", (ctx, rest) => showMyLogNutritionDay(ctx, rest)],
  ["mylogedit:w:", (ctx, rest) => startMyLogWorkoutEdit(ctx, rest)],
  ["mylogedit:n:", (ctx, rest) => startMyLogNutritionEdit(ctx, rest)],
  ["nlog:medit:", (ctx, _r, data) => { const parts = data.split(":"); const date = parts.slice(2, parts.length - 1).join(":"); const idx = Number(parts[parts.length - 1]); return startMealMacroEdit(ctx, date, idx); }],
  ["cl:", (ctx, _r, data) => { const [, id, action, arg] = data.split(":"); return clientCardAction(ctx, Number(id), action, arg); }],
  ["ou:", (ctx, _r, data) => { const [, id, action, arg] = data.split(":"); return ownerUserAction(ctx, Number(id), action, arg); }],
  ["cact:", (ctx, _r, data) => { const [, kind, idx] = data.split(":"); return handleCoachAction(ctx, kind, Number(idx)); }],
  ["q:send:", (ctx, rest) => onQuestionSend(ctx, Number(rest))],
  ["q:own:", (ctx, rest) => onQuestionOwn(ctx, Number(rest))],
  ["q:skip:", (ctx, rest) => onQuestionSkip(ctx, Number(rest))],
  ["swap:", (ctx, rest) => swapMenu(ctx, Number(rest) as Weekday)],
  ["sw:custom:", (ctx, _r, data) => { const [, , wd, idx] = data.split(":"); return startSwapCustom(ctx, Number(wd) as Weekday, Number(idx)); }],
  ["sw:", (ctx, _r, data) => { const [, wd, idx] = data.split(":"); return showSwapAlternatives(ctx, Number(wd) as Weekday, Number(idx)); }],
  ["swc:", (ctx, _r, data) => { const [, wd, idx, catalogId] = data.split(":"); return swapFromCatalog(ctx, Number(wd) as Weekday, Number(idx), catalogId); }],
  ["vid:pick:", (ctx, rest) => startVideoPick(ctx, Number(rest))],
  ["vid:set:", (ctx, _r, data) => { const [, , wd, idx] = data.split(":"); return startVideoSet(ctx, Number(wd) as Weekday, Number(idx)); }],
  ["exa:pick:", async (ctx, rest) => {
    const pending = ctx.user.session.pendingExercise;
    await setMode(ctx, "idle");
    if (!pending) { await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang)); return; }
    const catalog = await getCatalogExercise(ctx.db, rest);
    if (!catalog) { await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang)); return; }
    await applyCatalogExerciseChoice(ctx, pending, catalog);
  }],
  ["wu:ai:", (ctx, rest) => suggestWarmup(ctx, Number(rest) as Weekday)],
  ["wu:clear:", (ctx, rest) => saveWarmup(ctx, Number(rest) as Weekday, [])],
  ["wu:open:", (ctx, rest) => showWarmupEditor(ctx, Number(rest) as Weekday)],
  ["diff:up:", (ctx, _r, data) => { const parts = data.split(":"); return adjustDifficulty(ctx, parts[1] as "up" | "down", parseInt(parts[2])); }],
  ["diff:down:", (ctx, _r, data) => { const parts = data.split(":"); return adjustDifficulty(ctx, parts[1] as "up" | "down", parseInt(parts[2])); }],
  ["eds:done:", (ctx, rest) => endSelfEdit(ctx, rest)],
  // Reorder exercises within a day (⬆️/⬇️).
  ["ord:open:", (ctx, rest) => showReorder(ctx, Number(rest) as Weekday)],
  ["ord:back:", (ctx, rest) => endReorder(ctx, Number(rest) as Weekday)],
  ["ord:up:", (ctx, _r, data) => { const parts = data.split(":"); return moveExercise(ctx, Number(parts[2]) as Weekday, Number(parts[3]), parts[1] as "up" | "down"); }],
  ["ord:down:", (ctx, _r, data) => { const parts = data.split(":"); return moveExercise(ctx, Number(parts[2]) as Weekday, Number(parts[3]), parts[1] as "up" | "down"); }],
  // Trainer mini-interview for a client (stateless: answers ride in the callback data).
  ["mi:", (ctx, rest) => onMiniInterview(ctx, rest)],
  ["pday:wd:", (ctx, rest) => showDayGroupPicker(ctx, Number(rest) as Weekday)],
  ["pday:new:", (ctx, rest) => { const [wd, gid] = rest.split(":"); return createPlanDay(ctx, Number(wd) as Weekday, gid); }],
  // "delok" before "del" — prefix overlap.
  ["pday:delok:", (ctx, rest) => deletePlanDay(ctx, Number(rest) as Weekday)],
  ["pday:del:", (ctx, rest) => confirmDeleteDay(ctx, Number(rest) as Weekday)],
  ["wt:open:", (ctx, rest) => openWeightEditor(ctx, parseInt(rest))],
  ["wt:", (ctx, rest) => selectExerciseWeight(ctx, rest)],
  ["st:open:", (ctx, rest) => openSetsEditor(ctx, parseInt(rest))],
  ["st:", (ctx, rest) => selectExerciseSets(ctx, rest)],
  ["rec:", (ctx, rest) => cmdRecords(ctx, rest as "weekly" | "hall" | "badges" | "prs")],
  // share:tog: taps can also arrive from the post-link consent prompt (client's own chat) —
  // toggling from there edits that message into the settings screen, which is fine.
  ["share:tog:", (ctx, rest) => (rest === "body" || rest === "health" ? toggleShare(ctx, rest) : undefined)],
  ["cyd:m:", (ctx, rest) => onCycleCalNav(ctx, rest)],
  ["cyd:pick:", (ctx, rest) => pickCycleDate(ctx, rest)],
  ["qr:", (ctx, rest) => onQualityRating(ctx, Number(rest))],
  ["cardio:t:", (ctx, rest) => startCardioLog(ctx, rest)],
  ["cardio:plans", (ctx) => showCardioPlans(ctx)],
  ["cardio:p:", (ctx, rest) => showCardioSession(ctx, rest)],
  ["cycle:setlen:", (ctx, rest) => setCycleLength(ctx, Number(rest))],
  ["remtog:", (ctx, rest) => onReminderToggle(ctx, rest)],
  ["vac:set:", (ctx, rest) => setVacationDays(ctx, Number(rest))],
  ["cmb:", (ctx, _r, data) => comebackButton(ctx, data)],
  ["clean:del:", (ctx, rest) => onCleanupDelete(ctx, Number(rest))],
  ["meal:x:", (ctx, rest) => onMealPortion(ctx, Number(rest))],
  ["mealitem:", (ctx, rest) => onMealItemMenu(ctx, Number(rest))],
  ["mealdel:", (ctx, rest) => onMealItemDelete(ctx, Number(rest))],
  ["mealrepl:", (ctx, rest) => onMealItemReplace(ctx, Number(rest))],
  ["food:item:", (ctx, rest) => showFoodItem(ctx, Number(rest))],
  ["food:del:", (ctx, rest) => onFoodDelete(ctx, Number(rest))],
  ["food:wt:", (ctx, rest) => onFoodEditWeight(ctx, Number(rest))],
  ["food:prod:", (ctx, rest) => onFoodEditProduct(ctx, Number(rest))],
  ["relog:", (ctx, rest) => onReLog(ctx, Number(rest))],
  ["exch:", (ctx, rest) => onExerciseChart(ctx, Number(rest))],
  ["inj:a:", (ctx, rest) => showInjurySeverity(ctx, rest)],
  ["inj:s:", (ctx, _r, data) => {
    const [, , area, sev] = data.split(":");
    if (INJURY_AREAS.includes(area as InjuryArea) && (sev === "mild" || sev === "strong")) {
      return reportInjury(ctx, area as InjuryArea, sev);
    }
    return undefined;
  }],
  ["inj:ok:", (ctx, rest) => onInjuryRecovered(ctx, Number(rest))],
  ["inj:more:", (ctx, rest) => onInjuryExtend(ctx, Number(rest))],
  // Numeric pain check-in (0..10, 4 preset taps) + trend view for the "how has my knee been?" answer.
  ["inj:sc:", (ctx, _r, data) => { const [, , id, sc] = data.split(":"); return onInjuryScore(ctx, Number(id), Number(sc)); }],
  ["inj:trend:", (ctx, rest) => showInjuryTrend(ctx, Number(rest))],
  ["shour:", (ctx, rest) => onSmartHour(ctx, rest)],
  ["water:", (ctx, rest) => onWaterAction(ctx, rest)],
  ["chal:join:", (ctx, rest) => onChallengeJoin(ctx, rest)],
  ["set:", (ctx, rest) => openSetting(ctx, rest)],
  ["hour:", (ctx, rest) => onSetHour(ctx, Number(rest))],
  ["day:", (ctx, rest) => onToggleDay(ctx, rest)],
  ["tz:", (ctx, rest) => onSetTz(ctx, rest)],
];

// Sanity: with first-match-wins dispatch, an earlier prefix must never be a prefix OF a later
// one (it would shadow it). Runs at module load, so tests/CI catch a bad registration before
// any tap can be mis-routed in production.
for (let i = 0; i < CB_PREFIX.length; i++) {
  for (let j = i + 1; j < CB_PREFIX.length; j++) {
    if (CB_PREFIX[j][0].startsWith(CB_PREFIX[i][0])) {
      throw new Error(`callback prefix conflict: "${CB_PREFIX[i][0]}" shadows "${CB_PREFIX[j][0]}" — register the longer prefix first`);
    }
  }
}

// Test seam: which registered route (exact key or prefix) would take this callback data.
export function cbRouteFor(data: string): string | null {
  if (CB_EXACT[data]) return data;
  for (const [p] of CB_PREFIX) if (data.startsWith(p)) return p;
  return null;
}

// ===================== Text routing by session mode =====================
// EVERY SessionMode is classified in exactly one of the two structures below — a dedicated
// text handler, or the deliberate coach-fallthrough list. The `_ModeUnclassified` assertion
// makes adding a new SessionMode a compile error until it's placed here, so a mode can no
// longer silently leak typed text into the AI coach (the "answered 32 to the trainer" family
// of bugs).
type TextHandler = (ctx: MyContext, text: string) => Promise<unknown>;

export const MODE_TEXT_HANDLERS = {
  onboarding: (ctx, text) => onboardingStep(ctx, text),
  plan_pending: (ctx) => resumePendingPlan(ctx),
  nutrition: (ctx, text) => handleNutrition(ctx, text),
  // A button-guided per-exercise entry (sets→weight→reps) takes the text first; if no
  // exercise is mid-entry, fall back to parsing a full free-text log.
  log: async (ctx, text) => { if (!(await handleLogDraftInput(ctx, text))) await handleWorkoutLog(ctx, text); },
  measure: (ctx, text) => handleMeasure(ctx, text),
  body_edit: (ctx, text) => handleBodyEdit(ctx, text),
  steps_log: (ctx, text) => handleStepsLog(ctx, text),
  cardio_log: (ctx, text) => handleCardioLog(ctx, text),
  feedback: (ctx, text) => handleFeedback(ctx, text),
  client_code: (ctx, text) => joinByCode(ctx, text),
  client_note: (ctx, text) => handleClientNote(ctx, text),
  trainer_note: (ctx, text) => handleTrainerNote(ctx, text),
  share_myplan_name: (ctx, text) => handleShareMyPlanName(ctx, text),
  trainer_health: (ctx, text) => handleTrainerHealth(ctx, text),
  trainer_personal: (ctx, text) => handleTrainerPersonal(ctx, text),
  trainer_bday: (ctx, text) => handleTrainerBirthday(ctx, text),
  edit_client_log: (ctx, text) => handleClientLogEdit(ctx, text),
  edit_own_log: (ctx, text) => handleMyLogWorkoutEdit(ctx, text),
  edit_own_nutrition: (ctx, text) => handleMyLogNutritionEdit(ctx, text),
  meal_edit_macros: (ctx, text) => handleMealMacroEdit(ctx, text),
  goal_weight: (ctx, text) => handleGoalWeight(ctx, text),
  calc_weight: (ctx, text) => handleCalcWeight(ctx, text),
  trainer_setup: (ctx, text) => handleTwText(ctx, text),
  trainer_broadcast: (ctx, text) => handleTrainerBroadcast(ctx, text),
  review_text: (ctx, text) => handleReviewText(ctx, text),
  comeback: (ctx, text) => handleComebackText(ctx, text),
  vacation_custom: (ctx, text) => handleVacationCustom(ctx, text),
  inact_feedback: (ctx, text) => handleInactiveFeedback(ctx, text),
  meal_confirm: (ctx, text) => handleMealClarify(ctx, text),
  meal_item: (ctx, text) => handleMealItemFix(ctx, text),
  food_wt: (ctx, text) => handleFoodWeight(ctx, text),
  food_prod: (ctx, text) => handleFoodProduct(ctx, text),
  msg_client: (ctx, text) => handleTrainerMessage(ctx, text),
  msg_trainer: (ctx, text) => handleClientReply(ctx, text),
  answer_q: (ctx, text) => handleAnswerQuestion(ctx, text),
  records_alias: (ctx, text) => handleAliasInput(ctx, text),
  weight_edit: (ctx, text) => handleWeightEdit(ctx, text),
  sets_edit: (ctx, text) => handleSetsEdit(ctx, text),
  swap_custom: (ctx, text) => handleSwapCustom(ctx, text),
  add_exercise: (ctx, text) => handleAddExercise(ctx, text),
  exercise_alt: (ctx, text) => handleExerciseAltText(ctx, text),
  warmup_edit: (ctx, text) => handleWarmupEdit(ctx, text),
  video_url: (ctx, text) => handleVideoUrl(ctx, text),
  announce: (ctx, text) => handleAnnounce(ctx, text),
  checkin_adaptive: (ctx, text) => handleAdaptiveCheckin(ctx, text),
  mp_likes: (ctx, text) => mealIntakeText(ctx, text),
  mp_dislikes: (ctx, text) => mealIntakeText(ctx, text),
  tpl_name: (ctx, text) => handleTemplateName(ctx, text),
  billing_paid: (ctx, text) => handleBillingPaid(ctx, text),
  billing_sessions: (ctx, text) => handleBillingSessions(ctx, text),
  sess_link: (ctx, text) => handleSessionLink(ctx, text),
} satisfies Partial<Record<SessionMode, TextHandler>>;

// Modes where typed text DELIBERATELY falls through to the AI coach: either the mode is
// button-driven (checkin_*, exercise_confirm, mp_allergens, role_pick, photo_review) or the
// coach IS the handler (idle, coach).
export const COACH_TEXT_MODES = [
  "idle", "coach", "role_pick", "photo_review", "exercise_confirm",
  "checkin_energy", "checkin_sleep", "checkin_stress", "mp_allergens",
] as const satisfies readonly SessionMode[];

// Compile-time exhaustiveness: this type is `never` only when every SessionMode is classified.
type _ModeUnclassified = Exclude<SessionMode, keyof typeof MODE_TEXT_HANDLERS | (typeof COACH_TEXT_MODES)[number]>;
const _assertAllModesClassified: _ModeUnclassified[] = []; // becomes unassignable if a mode is missed
void _assertAllModesClassified;

// Modes a NOT-yet-onboarded athlete may legitimately be in; anything else is drift → pull back.
const PRE_ONBOARD_MODES = new Set<SessionMode>(["onboarding", "plan_pending", "role_pick", "client_code", "trainer_setup"]);

export async function routeUserText(ctx: MyContext, text: string) {
  const mode = ctx.user.session.mode;
  if (mode !== "onboarding") {
    // Common athlete actions apply to every role; trainers also match their extra buttons.
    const action =
      menuActionFor(ctx.user.lang, text) ??
      (ctx.user.role === "trainer" ? trainerMenuActionFor(ctx.user.lang, text) : undefined);
    if (action) {
      // Reply-keyboard tap away from an unsaved guided log → ask Save/Discard/Continue first.
      if (await guardLogExit(ctx, `kbtext:${text}`)) return;
      await action(ctx);
      return;
    }
  }
  // Safety net: a non-onboarded athlete (solo/client) must finish the interview first. If their
  // session drifted into a non-onboarding conversational mode (e.g. they tapped "message trainer"
  // and never sent, then answered an onboarding question), their typed answer used to route to
  // that stale mode — so they could NEVER complete registration. Pull them back into the wizard.
  if (!ctx.user.onboarded && (ctx.user.role === "solo" || ctx.user.role === "client") && !PRE_ONBOARD_MODES.has(mode)) {
    const step = obProgress(ctx.user.profile).next;
    ctx.user.session = { mode: "onboarding", step };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await onboardingStep(ctx, text);
    return;
  }
  const handler = (MODE_TEXT_HANDLERS as Partial<Record<SessionMode, TextHandler>>)[mode];
  if (handler) { await handler(ctx, text); return; }
  // While editing someone ELSE's plan, free text must NOT fall to the coach — the coach acts on
  // the operator's OWN plan, so a typed exercise name silently edited the wrong plan. Point them
  // at the deterministic edit buttons (tap the exercise → 🔄 → ✏️ Ввести свою to type a swap).
  if (isEditingOther(ctx)) { await reply(ctx, t(ctx.user.lang, "edit_use_buttons")); return; }
  await handleCoach(ctx, text);
}

export async function downloadImage(ctx: MyContext, fileId: string): Promise<InlineImage> {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return { mimeType: "image/jpeg", dataBase64: abToB64(buf) };
}

export async function downloadFile(ctx: MyContext, fileId: string): Promise<ArrayBuffer> {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  return res.arrayBuffer();
}

export function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

