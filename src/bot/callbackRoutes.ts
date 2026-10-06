// Inline-keyboard callback routing: exact-match and prefix tables from callback_data to handlers.
// createBot (router.ts) dispatches every callback_query through cbRouteFor.
import { applyKitFit } from "./kitFit";
import { applyRecoverySwap } from "./recoverySwap";
import { onSupportAmount } from "./support";
import { InlineKeyboard } from "grammy";
import { aliasMenu, menuBtn, roleMenu } from "./keyboards";
import { onWhatsNewSend, showWhatsNewConfirm } from "./owner";
import { onPlanRegenAi } from "./plan";
import { showCardioMenu } from "./survey";
import { cmdBecomeTrainer, cmdTrainer, cmdTrainerBroadcast, onTrainerLimitCycle, openFindTrainer } from "../features/trainer/trainer";
import { openTrainerEdit } from "../features/trainer/trainerWizard";
import { shareAssignToClients, toggleShareAll } from "../features/trainer/programSharing";
import { deleteUserData } from "../adapters/d1/v2Account";
import { upsertWorkoutLog } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getTrainer, updateTrainer } from "../adapters/d1/v2Trainer";
import { updateUser } from "../adapters/d1/v2Users";
import { phaseKey } from "../domain/mesocycle";
import { localParts } from "../domain/localTime";
import { t } from "../locales/i18n";
import { type Lang, type Weekday } from "../types";
import { MyContext, TKey, reply, setMode } from "../adapters/telegram/context";
import { adjustDifficulty, applyGymSwap, showGymSwapPicker, logBackToPick, openSetsEditor, openWeightEditor, startSwapCustom } from "./planExerciseEdit";
import { aiAuthorAndAdd, handleExerciseConfirmation } from "./exerciseCatalog";
import { startAddExercise, undoDelete } from "./todayEdit";
import { cmdAskInactive, onCleanupAll, onInactiveReply } from "./cleanup";
import { cmdExportJson } from "./exportData";
import { cmdLog, cmdLogPast, logFinish, logSwitchToText, onLogExit } from "./guidedLog";
import { cmdMenu } from "./menus";
import { cmdToday, showWorkoutInfo } from "./planView";
import { startInterview } from "./start";
import { cmdPlanChanges } from "./plan";
import { cmdPlates, cmdStandards, cmdVolume, cmdWeekCard, cmdWellbeing, onMacrosSuggest, showExerciseList } from "./progressCmds";
import { cmdRecords, setAlias, toggleCompete } from "./recordsCmds";
import { cmdVacation, endVacation } from "./vacation";
import { handleCoach } from "./coach";
import { handleNutrition, onMealConfirm, showMealConfirm, showMealItemEditor } from "../features/nutrition/nutritionLog";
import { handleWorkoutLog, notifyTrainerWorkout, showNextSession } from "./workoutSave";
import { onGoalMaintain, onLevelUp } from "./planGen";
import { pickCycleLength, showCycleCalendar, showCycleSettings, toggleCycleTracking } from "./cycle";
import { showAddDayPicker, showDayManager } from "./planDays";
import { showChallengePicker } from "../features/gamification/challenges";
import { showInjuryAreas } from "./injury";
import { showMyLogHub } from "./logSelfEdit";
import { showRecentFoods } from "./nutritionCmds";
import { showReminderSettings } from "./settingsCmds";
import { showShareSettings } from "./shareConsent";
import { updatePlanMesocycle } from "../adapters/d1/v2Plans";
import { getCatalogExercise } from "../adapters/d1/v2Catalog";
import { INJURY_AREAS, type InjuryArea } from "../domain/injury";
import { defaultMesocycle, phaseGuidance } from "../domain/mesocycle";
import { onboardingButton } from "./onboarding";
import { ownerUserAction, sendOwnerSection } from "./owner";
import { startVideoPick, startVideoSet } from "./ownerVideos";
import { onSurveyItem, showCardioPlans, showCardioSession, startCardioLog } from "./survey";
import { clientCardAction, onTemplateDelete } from "../features/trainer/clientCard";
import { onMiniInterview } from "../features/trainer/trainerInterview";
import { onQuestionOwn, onQuestionSend, onQuestionSkip, showClientLogDay, startClientLogEdit } from "../features/trainer/trainerComms";
import { onRequestAccept, onRequestCancel, onRequestDecline, onTrainerApprove, onTrainerReject, startProspectInvite } from "../features/trainer/trainer";
import { shareLink, sharePublish, shareTemplateMenu, showSharedProgram, startShareSelect, takeSharedProgram, toggleShareClient } from "../features/trainer/programSharing";
import { trainerWizardButton, twEditField } from "../features/trainer/trainerWizard";
import { applyCatalogExerciseChoice } from "./exerciseCatalog";
import { deleteExerciseFromToday, showDeleteExerciseMenu } from "./todayEdit";
import { comebackButton, setVacationDays } from "./vacation";
import { confirmDeleteDay, createPlanDay, deletePlanDay, showDayGroupPicker } from "./planDays";
import { endReorder, endSelfEdit, logSwapFromCatalog, moveExercise, selectExerciseSets, selectExerciseWeight, showLogSwapAlternatives, showReorder, showSwapAlternatives, swapFromCatalog, swapMenu } from "./planExerciseEdit";
import { handleCoachAction } from "./coach";
import { handleSkipReason, logPickExercise, onRestTimer, setEntryRpe, startPastLog, startSetEdit } from "./guidedLog";
import { onCalDay, onCalNav } from "./calendar";
import { onChallengeJoin } from "../features/gamification/challenges";
import { onCleanupDelete } from "./cleanup";
import { onCycleCalNav, pickCycleDate, setCycleLength } from "./cycle";
import { onExerciseChart } from "./progressCmds";
import { onFoodDelete, onFoodEditProduct, onFoodEditWeight, onReLog, onWaterAction, showFoodItem } from "./nutritionCmds";
import { onInjuryExtend, onInjuryRecovered, onInjuryScore, reportInjury, showInjurySeverity, showInjuryTrend } from "./injury";
import { onMealItemDelete, onMealItemMenu, onMealItemReplace, onMealPortion } from "../features/nutrition/nutritionLog";
import { onQualityFollowupSkip, onQualityRating } from "./feedbackIntake";
import { onReminderToggle, onWeighInAction, onSetHour, onSetTz, onSmartHour, onToggleDay, openSetting } from "./settingsCmds";
import { saveWarmup, showWarmupEditor, suggestWarmup } from "./warmup";
import { showMyLogNutritionDay, showMyLogWorkoutDay, startMealMacroEdit, startMyLogNutritionEdit, startMyLogWorkoutEdit } from "./logSelfEdit";
import { toggleShare } from "./shareConsent";
import { cmdGrocery, showGroceryList, startMealPlanIntake, beginMealPlanIntake, mealAllergenButton, mealSkip, startMealGeneration, onMealWeekly, onMealRegenAi } from "./mealPlanCmds";
import { cmdCheckin, handleCheckinCallback } from "./checkinCmds";
import { routeUserText } from "./textRoutes";

// ===================== Callback routing tables =====================
// Every callback_query route is declared here instead of a 570-line if-chain. Dispatch order:
// exact match first, then CB_PREFIX scanned IN REGISTRATION ORDER (first match wins) — so a
// more specific prefix MUST be registered before the shorter one it extends ("pday:delok:"
// before "pday:del:", "wt:open:" before "wt:"). A module-load sanity check below throws on any
// registration where an earlier prefix would shadow a later one, so a bad ordering fails in
// tests instead of silently mis-routing taps in production.
export type CbHandler = (ctx: MyContext, rest: string, data: string) => Promise<unknown> | unknown;

export const pickLang: CbHandler = async (ctx, _rest, data) => {
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
export const voiceRoute: CbHandler = async (ctx, _rest, data) => {
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
  "lang:en": pickLang,
  "export:json": (ctx) => cmdExportJson(ctx),
  "qr:skip": (ctx) => onQualityFollowupSkip(ctx),
  "menu:open": (ctx) => cmdMenu(ctx),
  "log:back": (ctx) => logBackToPick(ctx),
  "log:finish": (ctx) => logFinish(ctx),
  "log:text": (ctx) => logSwitchToText(ctx),
  "logpast:menu": (ctx) => cmdLogPast(ctx),
  "xexit:save": (ctx) => onLogExit(ctx, "save"),
  "xexit:drop": (ctx) => onLogExit(ctx, "drop"),
  "xexit:stay": (ctx) => onLogExit(ctx, "stay"),
  "share:week": (ctx) => cmdWeekCard(ctx),
  "gro:open": (ctx) => cmdGrocery(ctx),
  "mp:skip": (ctx) => mealSkip(ctx),
  "mp:regen": (ctx) => startMealPlanIntake(ctx),
  "mp:useprev": (ctx) => startMealGeneration(ctx),
  "mp:redo": (ctx) => beginMealPlanIntake(ctx),
  "mp:week": (ctx) => onMealWeekly(ctx),
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
  "gymswap:open": (ctx) => showGymSwapPicker(ctx),
  "gymswap:bodyweight": (ctx) => applyGymSwap(ctx, "bodyweight"),
  "gymswap:dumbbells": (ctx) => applyGymSwap(ctx, "dumbbells"),
  "gymswap:band": (ctx) => applyGymSwap(ctx, "band"),
  // --- roles / pairing / trainer dashboard ---
  "role:ai": (ctx) => startInterview(ctx), // language already chosen first → AI interview directly
  "role:find": (ctx) => openFindTrainer(ctx),
  "role:trainer": (ctx) => cmdBecomeTrainer(ctx),
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
  "tr:prospect": (ctx) => startProspectInvite(ctx),
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
  "ord:noop": (ctx) => ctx.answerCallbackQuery().catch(() => {}),
  // "What changed in my plan and why" — the adaptive check-in's own recorded trail.
  "plan:changes": (ctx) => cmdPlanChanges(ctx),
  // Plan-day management (add/delete whole days).
  // Activation-arc nudge: "start the first session" opens today's session view.
  "act:today": (ctx) => cmdToday(ctx),
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
    await deleteUserData(ctx.env, ctx.user._id);
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

export const CB_PREFIX: [string, CbHandler][] = [
  ["kitfit:", (ctx, rest) => applyKitFit(ctx, rest)],
  ["orep:", (ctx, rest) => sendOwnerSection(ctx, rest)],
  ["support:", (ctx, rest) => onSupportAmount(ctx, rest)],
  ["ob:", (ctx, rest) => onboardingButton(ctx, rest)],
  ["tw:", (ctx, _r, data) => trainerWizardButton(ctx, data)],
  ["twf:", (ctx, rest) => twEditField(ctx, rest)],
  ["log:ex:", (ctx, rest) => logPickExercise(ctx, Number(rest))],
  // On-the-fly swap while logging: pick an alternative for slot #i (does not touch the plan).
  ["logsw:", (ctx, rest) => showLogSwapAlternatives(ctx, Number(rest))],
  ["lswc:", (ctx, _r, data) => { const [, idx, cid] = data.split(":"); return logSwapFromCatalog(ctx, Number(idx), cid); }],
  ["lset:", (ctx, _r, data) => { const [, ei, si] = data.split(":"); return startSetEdit(ctx, Number(ei), Number(si)); }],
  ["srpe:", (ctx, _r, data) => { const [, ei, r] = data.split(":"); return setEntryRpe(ctx, Number(ei), Number(r)); }],
  ["logpast:", (ctx, rest) => startPastLog(ctx, rest)],
  // Recovery swap under /today: trade today's plan day with a later one (bot/recoverySwap.ts).
  ["rswap:", (ctx, _r, data) => { const [, a, b] = data.split(":"); return applyRecoverySwap(ctx, Number(a), Number(b)); }],
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
  ["cal:nav:", (ctx, rest) => onCalNav(ctx, rest)],
  ["cal:d:", (ctx, rest) => onCalDay(ctx, rest)],
  ["tpldel:", (ctx, rest) => onTemplateDelete(ctx, Number(rest))],
  ["shr:t:", (ctx, rest) => shareTemplateMenu(ctx, Number(rest))],
  ["shr:sel:", (ctx, rest) => startShareSelect(ctx, Number(rest))],
  ["shr:link:", (ctx, rest) => shareLink(ctx, Number(rest))],
  ["shr:pub:", (ctx, rest) => sharePublish(ctx, Number(rest))],
  ["shrc:", (ctx, rest) => toggleShareClient(ctx, Number(rest))],
  ["prog:take:", (ctx, rest) => takeSharedProgram(ctx, rest)],
  ["prog:view:", (ctx, rest) => showSharedProgram(ctx, rest)],
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
  ["cact:", (ctx, _r, data) => { const [, kind, turn, idx] = data.split(":"); return handleCoachAction(ctx, kind, Number(turn), Number(idx)); }],
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
  ["gro:n:", (ctx, _r, data) => showGroceryList(ctx, parseInt(data.split(":")[2], 10))],
  ["diff:up:", (ctx, _r, data) => { const parts = data.split(":"); return adjustDifficulty(ctx, parts[1] as "up" | "down", parseInt(parts[2], 10)); }],
  ["diff:down:", (ctx, _r, data) => { const parts = data.split(":"); return adjustDifficulty(ctx, parts[1] as "up" | "down", parseInt(parts[2], 10)); }],
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
  ["wt:open:", (ctx, rest) => openWeightEditor(ctx, parseInt(rest, 10))],
  ["wt:", (ctx, rest) => selectExerciseWeight(ctx, rest)],
  ["st:open:", (ctx, rest) => openSetsEditor(ctx, parseInt(rest, 10))],
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
  ["wi:", (ctx, rest) => onWeighInAction(ctx, rest)],
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
