import { GrammyError, InlineKeyboard, InputFile, Keyboard, type Context } from "grammy";
import type { CatalogExercise, Env, ExerciseMetric, ExerciseVideo, Lang, NutritionTargets, PlanDay, PlanDoc, PlanExercise, SetEntry, Supplement, UserDoc, Weekday } from "./types";
import { appendMeals, getDayMeals, setDayMeals, getRecentFoods, deleteMealItem, bodyLogsByUser, countClientsOf, countCompletedWorkouts, eventCountsByUser, planStatusByUser, recordError, getCatalogExercise, listExercisesByMusclesAnyLevel, getExerciseTranslation, upsertExerciseTranslation, getExerciseVideos, getUserVideos, listAchievements, listCandidatesByMuscles, searchExercisesByName, dailyCheckinsSince, getActivePlan, getWorkoutLog, getTrainer, getUser, listClients, listStrength, pendingRequestForClient, updateActivePlanSplit, nutritionLogsSince, saveDraftPlan, getStepLog, addWater, setWater, getWater, setRestTimer, userStatCounts, upsertExercise, upsertBodyLog, upsertStepLog, upsertWorkoutLog, updateUser, workoutLogsSince } from "./db/repos";
import { cleanAi, escapeHtml, LANG_NAME, t } from "./locales/i18n";
import { aiJSON, aiText } from "./ai";
import { computeTargets } from "./domain/mealplan";
import { pickGymSwaps, type EquipmentPreset, type GymSwapCandidate, type GymSwapSlot } from "./domain/gymSwap";
import { pickDifficultySwaps } from "./domain/difficultySwap";
import * as P from "./ai/prompts";
import { buildActivityCells, deloadDue, deloadSets, mesocyclePhase, getPlanDay, localParts, parseMeasurements, parseHeightWeight, parseSteps, parseWorkoutText, shouldDeload, weeksSincePlan, exerciseMetric, formatSetEntry, formatRecordBest, fmtDuration, parseDuration, parseDistance } from "./domain/progression";
import { e1rm, weekStartStr, weekStreak } from "./domain/records";
import { exerciseVideoKey, renderActivityGrid, renderBoard, renderPlan, renderSchedule, renderStrength, exerciseChart, wellbeingChart, renderToday, upcomingSessions, weekdayName } from "./render";
import { strengthStandard, type StrengthLevel } from "./domain/standards";
import { cmdReport, localCutoff } from "./bot/report";
import { cmdReplan, prDate } from "./bot/exportData";
import { resumePendingPlan } from "./bot/planGen";
import { num, verifyItems } from "./bot/nutritionLog";
import { finalizeWorkoutLog, renderDayInline } from "./bot/workoutSave";
import { interviewProgress, isOwner } from "./bot/owner";
import { joinByCode, requireTrainer, showSharedProgram, showPlanEditDay, trainerMenu, trainerMenuActionFor } from "./bot/trainer";
export { buildOwnerReport, buildErrorReport } from "./bot/owner";
// Extracted modules — imported for internal use AND re-exported so every existing consumer
// (scheduler, webapp, tests) keeps importing from "./bot" unchanged.
import { computeBoards, isoDateMinus, recordsTabs, renderBadges } from "./bot/boards";
import { buildWeekCard } from "./bot/weekCard";
import { showEveningSurvey } from "./bot/survey";
import { OB_WEEKDAY_KEYS, onboardingStep, renderObStep } from "./bot/onboarding";
export * from "./bot/boards";
export * from "./bot/weekCard";
export * from "./bot/survey";
export * from "./bot/onboarding";
import { mainMenu, moreMenu, progressHubMenu, trainerHubMenu, trainerClientsMenu, appendOwnerRow, ownerHubMenu, menuBtn, planViewKb, langMenu, hourMenu, tzMenu, settingsMenu } from "./bot/keyboards";
export * from "./bot/keyboards";
import { botDeepLink } from "./bot/links";
import { translatePlanExercises, healPlanIfDegenerate } from "./bot/plan";
export * from "./bot/plan";
import { MENU_MAP, deferAi, onError } from "./bot/router";
export * from "./bot/router";
export * from "./bot/challenges";
export * from "./bot/vacation";
export * from "./bot/injury";
export * from "./bot/cleanup";
export * from "./bot/cycle";
export * from "./bot/shareConsent";
export * from "./bot/calendar";
export * from "./bot/planDays";
export * from "./bot/report";
export * from "./bot/exportData";
export * from "./bot/planGen";
export * from "./bot/nutritionLog";
export * from "./bot/coach";
export * from "./bot/workoutSave";
export * from "./bot/feedbackIntake";
export * from "./bot/logSelfEdit";

import { computeXp, levelFromXp } from "./domain/gamification";
import { parseSetLine, parseSetEdit } from "./domain/setLine";
import { switchMode, unsavedLogCount } from "./domain/session";
import { weeklyVolume, projectWeight, stalledLifts, type MuscleVolume } from "./domain/analysis";
import { platePlan, warmupRamp } from "./domain/calc";
import { showInjuryMenu } from "./bot/injury";
import { progressBar, resolveWaterGoal } from "./domain/challenges";
import { lookupExerciseVideoCached } from "./youtube";
import { APP_VERSION } from "./webapp/appVersion";

export const COMMON_TZ = [
  "Europe/Kyiv",
  "Europe/Warsaw",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "UTC",
];

export type MyContext = Context & {
  env: Env;
  db: D1Database;
  user: UserDoc;
  // Defer heavy background work past the webhook response (Cloudflare ExecutionContext.waitUntil).
  // Falls back to fire-and-forget if no ExecutionContext was provided (e.g. tests).
  waitUntil: (p: Promise<unknown>) => void;
};

export const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
export const REPORT_DAYS = 14;

// A valid training day must carry a full session — used to reject degenerate AI plans.
export const MIN_EXERCISES_PER_DAY = 5;

export interface AiPlan {
  split: {
    weekday: number;
    muscleGroup: string;
    sessionType?: string;
    durationMin?: number;
    warmUp?: string[];
    coolDown?: string[];
    exercises: {
      name: string;
      sets: string;
      startWeight: string;
      technique: string;
      muscles?: string;
      isKeyLift?: boolean;
      metric?: string;
      exerciseId?: string;
      canonicalName?: string;
      rpe?: string;
      rir?: string;
      rest?: string;
      tempo?: string;
      heartRateZone?: string;
      movementPattern?: string;
      role?: string;
      warmupScheme?: string;
      supersetGroup?: string;
    }[];
  }[];
  nutrition: NutritionTargets;
  restDayNutrition?: NutritionTargets;
  supplements: Supplement[];
  methodology: string;
  movementAudit?: string;
  stepsTarget?: number;
}

export function defaultLang(code?: string): Lang {
  return code?.toLowerCase().startsWith("uk") ? "uk" : "en";
}

// Reduce a callback_data string to a stable analytics key: drop numeric ids and dates, keep the
// first two meaningful segments. "cl:123:plan"→"cl:plan", "vid:pick:0"→"vid:pick", "menu:plan" stays.
export function normalizeEvent(data: string): string {
  const parts = data.split(":").filter((p) => p && !/^\d+$/.test(p) && !/^\d{4}-\d{2}-\d{2}$/.test(p));
  return parts.slice(0, 2).join(":") || "other";
}

// Mini App base URL, captured once in createBot so pure keyboard builders can use it without
// threading env through every call site. Undefined (e.g. local dev) hides the dashboard buttons.
export let APP_URL: string | undefined;
// Setter so the extracted router module can populate this module-owned binding at bot startup
// (an imported binding can't be assigned to across modules).
export function setAppUrl(v: string | undefined): void { APP_URL = v; }

export function dashboardUrl(): string | undefined {
  return APP_URL ? `${APP_URL}/app?v=${APP_VERSION}` : undefined;
}



export async function showMoreMenu(ctx: MyContext) {
  await reply(ctx, t(ctx.user.lang, "more_title"), moreMenu(ctx.user.lang, ctx.user.role === "solo"));
}


export async function showProgressHub(ctx: MyContext) {
  await reply(ctx, t(ctx.user.lang, "proghub_title"), progressHubMenu(ctx.user.lang));
}

// ================= Solo self-correct: user rewrites a past workout / nutrition day =================
// Mirrors the trainer's clog* flow but scoped to ctx.user._id so a solo athlete who logged the
// wrong weight (or wrong meal) yesterday doesn't have to wait for a coach. Both surfaces list the
// same 30-day window; picking a day shows a summary + a "Rewrite" button that re-parses the whole
// day in one message.

// Moved to bot/logSelfEdit.ts (god-file split); re-exported below so existing from "./bot"
// imports (router.ts) keep working.

// startMealMacroEdit/handleMealMacroEdit moved to bot/logSelfEdit.ts (they end by calling
// showMyLogNutritionDay, defined there) — re-exported via the barrel below.

// On-demand trainer report — the owner's /users table scoped to this trainer's clients
// (same columns minus trainer/ban), plus one-tap "finish the interview" nudges below.
export async function cmdTrainerReport(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.role !== "trainer") return;
  const clients = await listClients(ctx.db, ctx.user._id);
  if (!clients.length) {
    await reply(ctx, t(lang, "tr_report_noclients"), menuBtn(lang));
    return;
  }
  const [eventCounts, planStatus] = await Promise.all([
    eventCountsByUser(ctx.db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(ctx.db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
  ]);
  // Retention snapshot: active in the last 7 days / total clients.
  const todayStr = localParts(ctx.user.profile.timezone).date;
  const active7 = clients.filter((c) => c.lastSeenAt && c.lastSeenAt.toISOString().slice(0, 10) >= isoDateMinus(todayStr, 7)).length;
  const retentionPct = clients.length ? Math.round((active7 / clients.length) * 100) : 0;
  const biz = [
    `💰 <b>${t(lang, "tr_biz")}</b>`,
    `• ${t(lang, "tr_biz_clients")}: <b>${clients.length}</b> · ${t(lang, "tr_biz_active")}: <b>${active7}</b> (${retentionPct}%)`,
    "",
  ].join("\n");
  const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
  // Most-active first, same ranking as the owner table.
  const ranked = [...clients]
    .map((u) => ({ u, ev: eventCounts.get(u._id) ?? zero }))
    .sort((a, b) => {
      const sum = (e: typeof zero) => e.workouts + e.checkins + e.nutrition + e.steps;
      return sum(b.ev) - sum(a.ev);
    });
  const header = ["name", "nick", "stat", "pln", "drf", "W", "C", "N", "S", "last", "blk"];
  const cells = [
    header,
    ...ranked.map(({ u, ev }) => {
      const prog = interviewProgress(u.profile);
      const ps = planStatus.get(u._id);
      return [
        (u.profile.name || `id ${u._id}`).slice(0, 16),
        u.username ? `@${u.username}` : "-",
        u.onboarded ? "ok" : `${prog.filled}/${prog.total}`,
        ps?.active ? "y" : "-",
        ps?.draft ? "y" : "-",
        String(ev.workouts), String(ev.checkins), String(ev.nutrition), String(ev.steps),
        u.lastSeenAt ? u.lastSeenAt.toISOString().slice(5, 10) : "—",
        u.botBlocked ? "x" : "-",
      ];
    }),
  ];
  const widths = header.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const rightAlign = new Set([5, 6, 7, 8]); // numeric columns W/C/N/S
  const tbl = cells.map((r) =>
    r.map((cell, i) => (rightAlign.has(i) ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join(" "),
  );
  const kb = new InlineKeyboard();
  for (const c of clients) {
    if (!c.onboarded) kb.text(`🔔 ${(c.profile.name ?? String(c._id)).slice(0, 24)}`, `cl:${c._id}:intvping`).row();
  }
  kb.text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, `${biz}${t(lang, "tr_report_legend")}\n<pre>${escapeHtml(tbl.join("\n"))}</pre>`, kb);
}

export async function cmdTrainerBroadcast(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const n = await countClientsOf(ctx.db, ctx.user._id);
  if (!n) { await reply(ctx, t(ctx.user.lang, "tr_broadcast_noclients"), trainerMenu(ctx.user.lang)); return; }
  await setMode(ctx, "trainer_broadcast");
  await reply(ctx, t(ctx.user.lang, "tr_broadcast_prompt", { n }));
}

export async function handleTrainerBroadcast(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  await setMode(ctx, "idle");
  const clients = await listClients(ctx.db, ctx.user._id);
  const who = escapeHtml(ctx.user.profile.name ?? "trainer");
  let sent = 0;
  for (const c of clients) {
    try {
      await ctx.api.sendMessage(c.chatId, t(c.lang, "tr_broadcast_from", { name: who }) + `\n\n${escapeHtml(text.slice(0, 1500))}`, HTML);
      sent++;
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 403) await updateUser(ctx.db, c._id, { botBlocked: true }).catch(() => {});
      else console.error("trainer broadcast", c._id, err);
    }
  }
  await reply(ctx, t(lang, "tr_broadcast_sent", { n: sent }), trainerMenu(lang));
}



export async function showOwnerHub(ctx: MyContext) {
  if (!(await isOwner(ctx))) return;
  await reply(ctx, t(ctx.user.lang, "owner_hub_title"), ownerHubMenu(ctx.user.lang));
}



export function difficultyKeyboard(lang: Lang, weekday: number): InlineKeyboard {
  const wd = weekday;
  return new InlineKeyboard()
    .text(t(lang, "swap_btn"), `swap:${wd}`)
    .text(t(lang, "workout_info_btn"), "workout:info").row()
    .text(t(lang, "plan_diff_edit_weight"), `wt:open:${wd}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:open:${wd}`);
}

export function todayWorkoutKeyboard(lang: Lang, weekday: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "log_done"), "log:done")
    .text(t(lang, "log_skip"), "log:skip")
    .row()
    .text(t(lang, "swap_btn"), `swap:${weekday}`)
    .text(t(lang, "workout_info_btn"), "workout:info")
    .row()
    .text(t(lang, "gym_swap_btn"), "gymswap:open")
    .row()
    .text(t(lang, "workout_add_btn"), `workout:add:${weekday}`)
    .text(t(lang, "workout_delete_btn"), `workout:delete:${weekday}`)
    .row()
    .text(t(lang, "plan_diff_edit_weight"), `wt:open:${weekday}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:open:${weekday}`)
    .row()
    .text(t(lang, "warmup_edit_btn"), `wu:open:${weekday}`);
}

export function difficultyLabel(lang: Lang, difficulty?: string): string {
  if (!difficulty) return "";
  const map: Record<string, string> =
    lang === "uk"
      ? { beginner: "початковий", intermediate: "середній", expert: "просунутий" }
      : { beginner: "beginner", intermediate: "intermediate", expert: "expert" };
  return map[difficulty] ?? difficulty;
}


// Persistent bottom button menu (reply keyboard) — always visible after onboarding.
// Map a tapped reply-keyboard label (in the user's language) to its command.
// Kept so a lingering legacy bottom keyboard (pre-update users) still routes correctly
// until ReplyKeyboardRemove clears it on their next plain reply.
export function menuActionFor(lang: Lang, text: string): ((c: MyContext) => Promise<void>) | undefined {
  const map: Record<string, (c: MyContext) => Promise<void>> = {
    [t(lang, "menu_today")]: cmdToday,
    [t(lang, "menu_plan")]: cmdPlan,
    [t(lang, "menu_log")]: cmdLog,
    [t(lang, "menu_progress")]: cmdProgress,
    [t(lang, "menu_nutrition")]: cmdNutrition,
    [t(lang, "menu_measure")]: cmdMeasure,
    [t(lang, "menu_steps")]: cmdSteps,
    [t(lang, "menu_report")]: cmdReport,
    [t(lang, "menu_coach")]: cmdCoach,
    [t(lang, "menu_feedback")]: cmdFeedback,
    [t(lang, "menu_help")]: cmdHelp,
    [t(lang, "menu_settings")]: cmdSettings,
    [t(lang, "menu_hide")]: cmdHideKeyboard,
  };
  return map[text];
}

// Open the menu — a single inline keyboard composed as common base + role extras.
// Everyone gets the full athlete menu; trainers/owner get extra rows appended (a user can
// be both a trainer AND the owner, so the rows are additive, not exclusive).
export async function cmdMenu(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const owner = await isOwner(ctx);
  // Trainers get a compact hub (own training vs clients vs profile); everyone else the full
  // athlete menu. The owner row is additive in both cases.
  if (ctx.user.role === "trainer") {
    const kb = trainerHubMenu(lang);
    // Instructors (owner-granted) + owner get the "share a program" entry.
    const tr = await getTrainer(ctx.db, ctx.user._id).catch(() => null);
    if (owner || tr?.isInstructor) kb.row().text(t(lang, "menu_share_program"), "menu:share");
    if (owner) appendOwnerRow(kb, lang);
    await ctx.reply(t(lang, "trainer_hub_title"), { ...HTML, reply_markup: kb });
    return;
  }
  const kb = mainMenu(lang);
  // Find-a-trainer / become-a-trainer moved into the "More" screen (moreMenu) to keep the
  // top level light; the owner entry stays here as a single hub button.
  if (owner) appendOwnerRow(kb, lang);
  await ctx.reply(t(lang, "menu_title"), { ...HTML, reply_markup: kb });
}

// Trainer hub → "My training": the trainer's OWN athlete side (separate entity from their coach
// profile). If they never did the athlete interview, offer to start it; otherwise the full menu.
export async function showAthleteMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!ctx.user.onboarded) {
    const kb = new InlineKeyboard()
      .text(t(lang, "tr_start_athlete"), "role:ai")
      .row()
      .text(t(lang, "tr_back_hub"), "menu:open");
    await ctx.reply(t(lang, "tr_athlete_intro"), { ...HTML, reply_markup: kb });
    return;
  }
  const kb = mainMenu(lang).row().text(t(lang, "tr_back_hub"), "menu:open");
  await ctx.reply(t(lang, "menu_title"), { ...HTML, reply_markup: kb });
}

// Trainer hub → "Clients": client list + incoming requests.
export async function showTrainerClientsMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.reply(t(lang, "tr_clients_title"), { ...HTML, reply_markup: trainerClientsMenu(lang) });
}

// Hide the button menu (remove the reply keyboard).
export async function cmdHideKeyboard(ctx: MyContext) {
  await ctx.reply(t(ctx.user.lang, "kbd_hidden"), { ...HTML, reply_markup: { remove_keyboard: true } });
}

export async function reply(ctx: MyContext, text: string, kb?: InlineKeyboard | Keyboard) {
  await sendLong(ctx, text, kb);
}

// Telegram caps messages at 4096 chars; split on newlines if needed.
// When a reply carries no inline keyboard we send ReplyKeyboardRemove so the
// legacy persistent bottom keyboard is cleared (the menu is the inline button now).
export async function sendLong(ctx: MyContext, text: string, kb?: InlineKeyboard | Keyboard) {
  const LIMIT = 3800;
  const tail = kb ? { reply_markup: kb } : { reply_markup: { remove_keyboard: true } as const };
  if (text.length <= LIMIT) {
    await ctx.reply(text, { ...HTML, ...tail });
    return;
  }
  const chunks: string[] = [];
  let buf = "";
  for (const block of text.split("\n")) {
    if ((buf + "\n" + block).length > LIMIT) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = buf ? buf + "\n" + block : block;
    }
  }
  if (buf) chunks.push(buf);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await ctx.reply(chunks[i], { ...HTML, ...(last ? tail : {}) });
  }
}

export async function setMode(ctx: MyContext, mode: UserDoc["session"]["mode"]) {
  // switchMode carries the context fields (editPlanOwner/editPlanPrefix/photoReviewFor) and
  // drops all transient flow state — see domain/session.ts for why this lives in one place.
  const session = switchMode(ctx.user.session, mode);
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// Whose plan the current plan-EDIT operation targets: a managed client (trainer/owner) or self.
export function planOwnerId(ctx: MyContext): number {
  return ctx.user.session.editPlanOwner ?? ctx.user._id;
}

// Fetch the active plan for the current edit target (managed client or self); if there is none,
// send the standard "no plan" reply and return undefined — the caller should then `return`.
export async function getActivePlanOrReply(
  ctx: MyContext,
  ownerId = planOwnerId(ctx),
): Promise<Awaited<ReturnType<typeof getActivePlan>>> {
  const plan = await getActivePlan(ctx.db, ownerId);
  if (!plan) await reply(ctx, t(ctx.user.lang, "no_plan"), menuBtn(ctx.user.lang));
  return plan;
}

// A weekday + exercise index packed into a single numeric session.targetId (weekday*1000 + idx).
export function encodePlanRef(weekday: number, index: number): number {
  return weekday * 1000 + index;
}
export function decodePlanRef(ref: number): { weekday: number; index: number } {
  return { weekday: Math.floor(ref / 1000), index: ref % 1000 };
}

// The LANGUAGE of the plan owner — so a trainer/owner editing a client's plan persists the
// client's exercise names in the CLIENT's language, not the editor's.
export async function planOwnerLang(ctx: MyContext): Promise<Lang> {
  const owner = ctx.user.session.editPlanOwner;
  if (owner === undefined || owner === ctx.user._id) return ctx.user.lang;
  const u = await getUser(ctx.db, owner);
  return u?.lang ?? ctx.user.lang;
}

// Begin editing another user's plan (trainer→client / owner→anyone). Sets the edit context.
// `prefix` records which card owns the edit ("cl"/"ou") so post-action re-renders can rebuild
// the edit-day keyboard instead of the self logging view.
export async function setEditOwner(ctx: MyContext, ownerId: number | undefined, prefix?: "cl" | "ou") {
  const session = { ...ctx.user.session, editPlanOwner: ownerId, editPlanPrefix: prefix };
  if (ownerId === undefined) { delete session.editPlanOwner; delete session.editPlanPrefix; }
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// True when the current edit targets someone else's plan (trainer→client / owner→user), so
// the shared edit handlers must render the edit-day view, never the self "log workout" view.
export function isEditingOther(ctx: MyContext): boolean {
  return ctx.user.session.editPlanOwner !== undefined && ctx.user.session.editPlanOwner !== ctx.user._id;
}

// Re-show the managed user's edit-day view after a shared edit action (delete/swap/…), so the
// trainer/owner stays in the client's plan instead of being dropped into their OWN today view.
export async function reRenderEditDay(ctx: MyContext, weekday: Weekday) {
  const owner = ctx.user.session.editPlanOwner;
  const prefix = ctx.user.session.editPlanPrefix ?? "cl";
  if (owner === undefined) return;
  await showPlanEditDay(ctx, owner, prefix, weekday);
}

// Clear any "editing someone else's plan" context (called when the user navigates to their
// own home / today / menu so self-edits never leak onto a managed client).
export async function clearEditOwner(ctx: MyContext) {
  if (ctx.user.session.editPlanOwner === undefined) return;
  await setEditOwner(ctx, undefined);
}

// ---------------- command implementations ----------------


// Start (or restart) the deterministic button-based intake wizard (no per-turn AI).
export async function startInterview(ctx: MyContext) {
  await updateUser(ctx.db, ctx.user._id, { session: { mode: "onboarding", step: 0 } });
  ctx.user.session = { mode: "onboarding", step: 0 };
  await renderObStep(ctx, 0);
}

// Menu: continue an in-progress interview, or restart the intake to rebuild the plan.
export async function cmdInterview(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode === "onboarding") {
    await onboardingStep(ctx); // resume where they left off
    return;
  }
  await reply(ctx, t(lang, "interview_restart"));
  await startInterview(ctx);
}

export async function cmdStart(ctx: MyContext, payload?: string) {
  await clearEditOwner(ctx);
  const u = ctx.user;
  const lang = u.lang;
  const hi = u.profile.name ? `${escapeHtml(u.profile.name)}! ` : "";

  // Deep link to a shared program → preview + "take it".
  if (payload?.startsWith("prog_")) {
    await showSharedProgram(ctx, payload.slice(5));
    return;
  }
  // Deep link from a trainer's invite → auto-pair.
  if (payload?.startsWith("tr_")) {
    await joinByCode(ctx, payload.slice(3));
    return;
  }
  // Referral link: remember who invited (once, and only before onboarding — no retro-claims).
  // Falls through to the normal start flow; the inviter's reward fires when this user onboards.
  if (payload?.startsWith("ref_")) {
    const inviter = Number(payload.slice(4));
    if (Number.isFinite(inviter) && inviter > 0 && inviter !== u._id && !u.onboarded && !u.profile.referredBy) {
      u.profile = { ...u.profile, referredBy: inviter };
      await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
    }
  }
  // Accountability buddy link: pair two users mutually so each sees the other's weekly activity.
  if (payload?.startsWith("buddy_")) {
    const mate = Number(payload.slice(6));
    if (Number.isFinite(mate) && mate > 0 && mate !== u._id) {
      const other = await getUser(ctx.db, mate).catch(() => null);
      if (other) {
        u.profile = { ...u.profile, buddyId: mate };
        await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
        await updateUser(ctx.db, mate, { profile: { ...other.profile, buddyId: u._id } }).catch(() => {});
        await reply(ctx, t(lang, "buddy_paired", { name: escapeHtml(other.profile.name ?? `id ${mate}`) })).catch(() => {});
        await ctx.api.sendMessage(other.chatId, t(other.lang, "buddy_paired", { name: escapeHtml(u.profile.name ?? `id ${u._id}`) }), HTML).catch(() => {});
      }
    }
  }
  if (u.session.mode === "plan_pending") {
    await resumePendingPlan(ctx);
    return;
  }
  if (u.role === "trainer") {
    await reply(ctx, hi + t(lang, "trainer_home"), trainerMenu(lang));
    return;
  }
  if (u.role === "client") {
    await reply(ctx, hi + t(lang, "welcome_back"), mainMenu(lang));
    return;
  }
  // solo
  const pending = await pendingRequestForClient(ctx.db, u._id);
  if (pending) {
    const tr = await getUser(ctx.db, pending.trainerId);
    const kb = new InlineKeyboard().text(t(lang, "req_cancel"), `req:cancel:${pending.id}`);
    await reply(ctx, t(lang, "req_waiting", { name: escapeHtml(tr?.profile.name ?? "trainer") }), kb);
    return;
  }
  if (u.onboarded) {
    await reply(ctx, hi + t(lang, "welcome_back"), mainMenu(lang));
    return;
  }
  // Stuck mid-interview (started but never finished) → resume and re-send the current
  // question instead of bouncing back to the language picker and losing their answers.
  if (u.session.mode === "onboarding") {
    await reply(ctx, t(lang, "interview_resume"));
    await onboardingStep(ctx);
    return;
  }
  // brand new → ask LANGUAGE first; the lang choice then leads to disclaimer + role choice.
  await reply(ctx, t(lang, "choose_language"), langMenu());
}

export async function cmdHelp(ctx: MyContext) {
  const lang = ctx.user.lang;
  const body =
    ctx.user.role === "trainer"
      ? t(lang, "help_body_trainer")
      : ctx.user.role === "client"
        ? t(lang, "help_body_client")
        : t(lang, "help_body");
  await reply(ctx, `${t(lang, "help_title")}\n\n${t(lang, "help_modes")}\n\n${body}`, menuBtn(lang));
}

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
  if (APP_URL) {
    for (const [k, v] of map) {
      if (v.url) map.set(k, { ...v, url: `${APP_URL}/v?u=${encodeURIComponent(v.url)}&uid=${ctx.user._id}` });
    }
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

export async function cmdPlan(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  let plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"));
    return;
  }
  plan = await healPlanIfDegenerate(ctx, plan);
  plan = await healPlanNamesForDisplay(ctx, plan, lang);
  await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), planViewKb(lang));
}

// Instructions + safety for an exercise in the user's language. English is served straight
// from the catalog; other languages are translated on first use and cached so /today is
// instant afterwards. Falls back to the English original if translation fails.
export async function exerciseInfoEntry(
  ctx: MyContext,
  exerciseId: string,
  lang: Lang,
): Promise<{ name: string; instructions: string; safety: string } | null> {
  const catalog = await getCatalogExercise(ctx.db, exerciseId);
  if (!catalog) return null;
  if (lang === "en") return { name: catalog.name, instructions: catalog.instructions, safety: catalog.safetyInfo };
  const cached = await getExerciseTranslation(ctx.db, exerciseId, lang);
  // A name-only seed (curated names, empty instructions) is a partial cache: keep the curated
  // name but still translate the technique/safety on first view, then store the full row.
  if (cached && cached.instructions) return { name: cached.name, instructions: cached.instructions, safety: cached.safetyInfo };
  try {
    const tr = await aiJSON<P.ExerciseInfoResult>(ctx.env, {
      system: P.exerciseInfoSystem(lang),
      user: P.exerciseInfoUser(catalog.name, catalog.instructions, catalog.safetyInfo),
      schema: P.EXERCISE_INFO_SCHEMA,
      temperature: 0.2,
      kind: "translate",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const out = {
      // Prefer a curated seeded name over the AI's; only fall back to AI/English when unseeded.
      name: (cached?.name && cleanAi(cached.name)) || cleanAi(tr.name) || catalog.name,
      instructions: cleanAi(tr.instructions),
      safety: cleanAi(tr.safety),
    };
    await upsertExerciseTranslation(ctx.db, exerciseId, lang, {
      name: out.name,
      instructions: out.instructions,
      safetyInfo: out.safety,
    });
    return out;
  } catch {
    return { name: catalog.name, instructions: catalog.instructions, safety: catalog.safetyInfo };
  }
}

export async function translateExerciseQueryToEnglish(ctx: MyContext, query: string): Promise<string> {
  if (ctx.user.lang === "en") return query.trim();
  try {
    const translated = await aiText(ctx.env, {
      system:
        "Translate exercise names and movement names to canonical English gym terminology only. Return only the English exercise name, with no explanation, punctuation, or quotes.",
      user: query,
      temperature: 0.2,
      kind: "translate",
      db: ctx.db,
      userId: ctx.user._id,
    });
    return cleanAi(translated) || query.trim();
  } catch {
    return query.trim();
  }
}

export function extractExerciseQuery(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;

  const parsed = parseWorkoutText(trimmed);
  if (parsed.length > 0 && parsed[0].exercise.trim()) {
    return parsed[0].exercise.trim();
  }

  const markers = [
    /\b\d+(?:[.,]\d+)?\s*[xх×•·]\s*\d+\b/iu,
    /\b\d+(?:[.,]\d+)?\s*(?:kg|кг)\b/iu,
    /\b\d+\s*підход[а-я]*\b/iu,
    /\b\d+\s*раз[а-я]*\b/iu,
    /\b(?:bw|bodyweight|власна|своя)\b/iu,
  ];
  let cut = trimmed.length;
  for (const re of markers) {
    const match = trimmed.match(re);
    if (match?.index !== undefined) cut = Math.min(cut, match.index);
  }
  return trimmed.slice(0, cut).replace(/[\s,;:–—•·-]+$/u, "").trim() || trimmed;
}

// Drop the implement/equipment qualifier so a movement matches regardless of dumbbell/kettlebell/
// barbell/machine — e.g. "goblet squat with dumbbell" / "присідання кубком з гантеллю" → "goblet squat".
export function stripEquipmentWords(s: string): string {
  return s
    .replace(/\b(?:dumbbells?|kettlebells?|barbells?|cable|machine|smith|resistance bands?|band|plate)\b/gi, " ")
    .replace(/\bз\s+(?:гантел\w*|гир\w*)\b/giu, " ")
    .replace(/\bзі?\s+штанг\w*\b/giu, " ")
    .replace(/\b(?:на|у|в)\s+тренажер\w*\b/giu, " ")
    .replace(/\b(?:with|using|on)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function searchExerciseCatalog(ctx: MyContext, query: string, limit = 5): Promise<CatalogExercise[]> {
  const cleaned = extractExerciseQuery(query);
  const english = await translateExerciseQueryToEnglish(ctx, cleaned);
  // Specific phrasings first; the equipment-stripped forms are last-resort so exact matches win
  // and we still find the movement (not a near-duplicate) when only the implement differs.
  const variants = [...new Set(
    [english, cleaned, query, stripEquipmentWords(english), stripEquipmentWords(cleaned)]
      .map((q) => q.trim())
      .filter(Boolean),
  )];
  for (const q of variants) {
    const found = await searchExercisesByName(ctx.db, q, limit, ctx.user.lang);
    if (found.length) return found;
  }
  return [];
}

export async function promptExerciseConfirmation(
  ctx: MyContext,
  payload: {
    action: "swap" | "add";
    weekday: Weekday;
    query: string;
    englishQuery: string;
    catalog: CatalogExercise;
    index?: number;
  },
) {
  const lang = ctx.user.lang;
  const localized = lang === "en" ? payload.catalog.name : (await exerciseInfoEntry(ctx, payload.catalog.id, lang))?.name ?? payload.catalog.name;
  const session = switchMode(ctx.user.session, "exercise_confirm", {
    pendingExercise: {
      action: payload.action,
      weekday: payload.weekday,
      index: payload.index,
      query: payload.query,
      englishQuery: payload.englishQuery,
      catalogId: payload.catalog.id,
    },
  });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const kb = new InlineKeyboard()
    .text(t(lang, "confirm_yes"), "ex:yes")
    .text(t(lang, "confirm_no"), "ex:no");
  await reply(ctx, t(lang, "exercise_confirm_question", { name: localized }), kb);
}

// After a swap/add, offer the new exercise's weight & sets right away — the replacement
// almost always needs different numbers, and these are the same wt:/st: flows the day editor uses.
function swapTuneKb(lang: Lang, weekday: Weekday, index: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "plan_diff_edit_weight"), `wt:${weekday}:${index}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:${weekday}:${index}`);
}

export async function applyCatalogExerciseChoice(
  ctx: MyContext,
  payload: NonNullable<MyContext["user"]["session"]["pendingExercise"]>,
  catalog: CatalogExercise,
) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  const day = getPlanDay(plan, payload.weekday);
  if (!day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // Localize the single new exercise directly from the (cached) catalog translation — the same
  // entry the confirmation showed. This is deterministic and avoids running the whole split
  // through the bulk AI translator, which could fail and leave the exercise in English.
  const oLang = await planOwnerLang(ctx);
  const info = oLang === "en" ? null : await exerciseInfoEntry(ctx, catalog.id, oLang).catch(() => null);
  const exName = info?.name || catalog.name;
  const exTech = info?.instructions || catalog.instructions;
  // Classify the NEW exercise by its canonical name so a plank/cardio swapped or added via the
  // catalog gets the right metric + sensible default sets — not the reps scheme it replaced.
  const metric = exerciseMetric({ name: catalog.name });
  const timed = metric !== "reps";
  let fromName = "";
  if (payload.action === "swap") {
    const current = payload.index !== undefined ? day.exercises[payload.index] : undefined;
    if (!current) {
      await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
      return;
    }
    fromName = current.name;
    day.exercises[payload.index!] = {
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      // Keep the rep scheme for a like-for-like reps swap, but never carry the old absolute load
      // (e.g. a 100 kg back squat → goblet squat). Timed/cardio get their own default sets.
      sets: timed ? defaultSetsForMetric(metric, catalog) : current.sets,
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech || current.technique,
      isKeyLift: timed ? false : current.isKeyLift,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    };
  } else {
    day.exercises.push({
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      sets: defaultSetsForMetric(metric, catalog),
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech,
      isKeyLift: false,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    });
  }

  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);

  const updatedDay = plan.split.find((d) => d.weekday === payload.weekday);
  if (payload.action === "swap") {
    const swapped = updatedDay?.exercises[payload.index ?? 0];
    await reply(
      ctx,
      t(lang, "swap_done", { from: fromName, to: swapped?.name ?? catalog.name }),
      swapTuneKb(lang, payload.weekday, payload.index ?? 0),
    );
  } else {
    await reply(
      ctx,
      t(lang, "add_exercise_done", { name: updatedDay?.exercises.at(-1)?.name ?? catalog.name }),
      updatedDay ? swapTuneKb(lang, payload.weekday, updatedDay.exercises.length - 1) : undefined,
    );
  }
  // Re-show the full edit-day menu automatically after an add / custom swap (both surfaces).
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, payload.weekday);
  else await endSelfEdit(ctx, String(payload.weekday));
}

export type PendingExercise = NonNullable<MyContext["user"]["session"]["pendingExercise"]>;

export async function handleExerciseConfirmation(ctx: MyContext, accept: boolean) {
  const lang = ctx.user.lang;
  const pending = ctx.user.session.pendingExercise;
  if (!pending) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // "✅ Так" → add the resolved catalog exercise.
  if (accept) {
    await setMode(ctx, "idle");
    if (pending.catalogId) {
      const catalog = await getCatalogExercise(ctx.db, pending.catalogId);
      if (catalog) {
        await applyCatalogExerciseChoice(ctx, pending, catalog);
        return;
      }
    }
    // Accepted, but the suggestion had no stored catalog entry (rare) — author it.
    await aiAuthorAndAdd(ctx, pending);
    return;
  }
  // "✏️ Ні, інша вправа" → don't guess: offer real catalog alternatives for the user's query,
  // plus "type another name" and an explicit "let the bot create it" fallback. Nothing is
  // added until the user picks.
  await showExerciseConfirmAlternatives(ctx, pending);
}

// AI-author one exercise from the user's free-text query and add it. Used only when the user
// explicitly asks the bot to create it (no catalog match they liked).
export async function aiAuthorAndAdd(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, pending.weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const current = pending.action === "swap" && pending.index !== undefined ? day.exercises[pending.index] : undefined;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = await createExerciseCatalogEntry(ctx, pending.query, day, pending.action, current, pending.englishQuery, pending.catalogId);
    await applyCatalogExerciseChoice(ctx, pending, catalog);
  } catch (err) {
    await onError(ctx, err, "exercise_confirm");
  }
}

// Show other library matches for the user's query (the rejected suggestion excluded). Keeps the
// pending request in the session and switches to "exercise_alt" mode so a typed reply re-searches.
export async function showExerciseConfirmAlternatives(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const session = switchMode(ctx.user.session, "exercise_alt", { pendingExercise: pending });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;

  // Re-use the already-resolved English query / original query — no extra AI translate call.
  const variants = [...new Set([pending.englishQuery, pending.query].map((q) => q.trim()).filter(Boolean))];
  let matches: CatalogExercise[] = [];
  for (const q of variants) {
    const found = await searchExercisesByName(ctx.db, q, 6, lang);
    if (found.length) { matches = found; break; }
  }
  const alts = matches.filter((m) => m.id !== pending.catalogId).slice(0, 4);

  if (!alts.length) {
    const kb = new InlineKeyboard()
      .text(t(lang, "exercise_alt_type_btn"), "exa:type")
      .row()
      .text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
    await reply(ctx, t(lang, "exercise_alt_none"), kb);
    return;
  }

  const kb = new InlineKeyboard();
  for (const c of alts) {
    // Localizing each label is best-effort — a translate failure must not crash the menu.
    let name = c.name;
    if (lang !== "en") {
      try { name = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name; } catch { /* keep English */ }
    }
    kb.text(cleanAi(name).slice(0, 60), `exa:pick:${c.id}`).row();
  }
  kb.text(t(lang, "exercise_alt_type_btn"), "exa:type").row();
  kb.text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
  await reply(ctx, t(lang, "exercise_alt_pick"), kb);
}

// Text handler for "exercise_alt": a typed reply is a fresh exercise name → re-run the
// add/swap-by-name flow (which prompts confirmation again).
export async function handleExerciseAltText(ctx: MyContext, text: string) {
  const pending = ctx.user.session.pendingExercise;
  await setMode(ctx, "idle");
  if (!pending) {
    await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang));
    return;
  }
  const query = extractExerciseQuery(text);
  if (pending.action === "swap" && pending.index !== undefined) {
    await swapExerciseByName(ctx, pending.weekday, pending.index, query);
  } else {
    await addExerciseByName(ctx, pending.weekday, query);
  }
}

// ---------------- warm-up editing (user + trainer/owner) ----------------

// Show the current warm-up for `weekday` and enter "warmup_edit" mode (typed reply = new steps).
export async function showWarmupEditor(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const session = switchMode(ctx.user.session, "warmup_edit", { targetId: weekday });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const current = day.warmUp?.length ? day.warmUp.map((s) => `• ${cleanAi(s)}`).join("\n") : t(lang, "warmup_empty");
  const kb = new InlineKeyboard()
    .text(t(lang, "warmup_ai_btn"), `wu:ai:${weekday}`)
    .row()
    .text(t(lang, "warmup_clear_btn"), `wu:clear:${weekday}`);
  await reply(ctx, t(lang, "warmup_edit_ask", { current }), kb);
}

// Persist `steps` as the warm-up for `weekday` (empty list clears it), then re-render the day.
export async function saveWarmup(ctx: MyContext, weekday: Weekday, steps: string[]) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const cleaned = steps.map((s) => cleanAi(s).trim()).filter(Boolean).slice(0, 8);
  if (cleaned.length) day.warmUp = cleaned;
  else delete day.warmUp;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, cleaned.length ? "warmup_saved" : "warmup_cleared"));
  await reply(ctx, renderToday(lang, day, undefined, undefined, await videosForDays(ctx, [day])));
}

// "🤖 Suggest a warm-up" → AI-generate steps for the day's muscle group, in the plan owner's language.
export async function suggestWarmup(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const oLang = await planOwnerLang(ctx);
    const result = await aiJSON<P.WarmupResult>(ctx.env, {
      system: P.warmupSystem(oLang),
      user: P.warmupUser(day.muscleGroup, day.exercises.map((e) => e.name), ctx.user.profile.level ?? "beginner"),
      schema: P.WARMUP_SCHEMA,
      temperature: 0.4,
      kind: "plan",
      db: ctx.db,
      userId: ctx.user._id,
    });
    await saveWarmup(ctx, weekday, result.steps ?? []);
  } catch (err) {
    await onError(ctx, err, "warmup_ai");
  }
}

// Text handler for "warmup_edit": split the reply into one warm-up step per line / "·" / ";".
export async function handleWarmupEdit(ctx: MyContext, text: string) {
  const weekday = (ctx.user.session.targetId ?? 0) as Weekday;
  const steps = text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[;·]/))
    .map((s) => s.replace(/^[\s•*-]+/, "").trim())
    .filter(Boolean);
  await saveWarmup(ctx, weekday, steps);
}

// Resolve a catalog id + canonical name for one (ungrounded) plan exercise: match the
// catalog by its name (UA/EN), else AI-author a catalog entry (coach). No mutation here.
export async function groundExercise(
  ctx: MyContext,
  day: PlanDay,
  ex: PlanExercise,
): Promise<{ id: string; name: string } | null> {
  try {
    const matches = await searchExerciseCatalog(ctx, ex.name, 1);
    if (matches.length) return { id: matches[0].id, name: matches[0].name };
    const cat = await createExerciseCatalogEntry(
      ctx,
      ex.name,
      day,
      "add",
      undefined,
      await translateExerciseQueryToEnglish(ctx, ex.name),
    );
    return { id: cat.id, name: cat.name };
  } catch {
    return null;
  }
}

// Localize a plan's exercise DISPLAY names into `lang`, preserving the English canonicalName for
// matching/PRs/videos. adaptPlan (bank/template/shared-program snapshots) copies exercise names
// verbatim, so a uk client assigned an English-authored template sees "Dumbbell Bench Press"
// instead of "Жим гантелей лежачи". This grounds any ungrounded exercise (so the catalog holds a
// translation), then swaps in the cached/seeded/AI-translated name. English plans and
// already-Cyrillic names are skipped, so a healthy plan costs only a scan — no AI, no writes.
// Mutates `plan` in place; returns whether anything changed. Call right after adaptPlan().
export async function localizePlanNames(ctx: MyContext, plan: PlanDoc, lang: Lang): Promise<boolean> {
  if (lang === "en") return false;
  const CYR = /[Ѐ-ӿ]/;
  let changed = false;
  for (const day of plan.split) {
    for (const ex of day.exercises ?? []) {
      if (CYR.test(ex.name)) continue; // already localized
      let id = ex.exerciseId;
      if (!id) {
        const g = await groundExercise(ctx, day, ex);
        if (g) { id = ex.exerciseId = g.id; ex.canonicalName = g.name; changed = true; }
      }
      if (!id) continue;
      const info = await exerciseInfoEntry(ctx, id, lang).catch(() => null);
      const localized = info?.name ? cleanAi(info.name) : "";
      if (localized && CYR.test(localized) && localized !== ex.name) {
        if (!ex.canonicalName) ex.canonicalName = ex.name; // keep the English name for matching
        ex.name = localized;
        changed = true;
      }
    }
  }
  return changed;
}

// Render-time self-heal: localize a plan's exercise names on display and persist the result once,
// so a plan that stored English names (a pre-localization template/shared assign, or an ungrounded
// draft) is corrected the first time anyone views it — not only when it's next (re)assigned. A
// healthy (already-Cyrillic) plan costs a scan and no write. `lang` is the plan OWNER's language
// (not the viewer's), so a trainer opening a client's plan persists names in the client's language.
export async function healPlanNamesForDisplay(ctx: MyContext, plan: PlanDoc, lang: Lang): Promise<PlanDoc> {
  const changed = await localizePlanNames(ctx, plan, lang);
  if (changed) {
    if (plan.status === "draft") await saveDraftPlan(ctx.db, plan).catch(() => {});
    else await updateActivePlanSplit(ctx.db, plan.userId, plan.split).catch(() => {});
  }
  return plan;
}

// Send full 📖 instructions + ⚠️ safety for EVERY exercise of a day as a separate message.
// Exercises that aren't catalog-grounded yet are grounded on demand (match or AI-author) and
// the new ids are persisted so info works for all of them. Each block is a single-line
// <b>name</b> header + plain escaped text → sendLong can chunk safely (no entity spans a chunk).
export async function sendExerciseDescriptions(ctx: MyContext, dayArg: PlanDay, lang: Lang) {
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan?.split.find((d) => d.weekday === dayArg.weekday) ?? dayArg;
  if (!day.exercises.length) return;

  // Ground any ungrounded exercises (in parallel), then persist if anything changed.
  const ungrounded = day.exercises.filter((e) => !e.exerciseId);
  if (ungrounded.length) {
    const grounds = await Promise.all(ungrounded.map((e) => groundExercise(ctx, day, e)));
    let changed = false;
    ungrounded.forEach((e, i) => {
      const g = grounds[i];
      if (g) {
        e.exerciseId = g.id;
        e.canonicalName = g.name;
        changed = true;
      }
    });
    if (changed && plan) await updateActivePlanSplit(ctx.db, ctx.user._id, plan.split);
  }

  const results = await Promise.all(
    day.exercises.map((e) => (e.exerciseId ? exerciseInfoEntry(ctx, e.exerciseId, lang) : null)),
  );
  const blocks: string[] = [];
  day.exercises.forEach((e, i) => {
    const r = results[i];
    const instr = (r?.instructions ?? "").replace(/\s+/g, " ").trim();
    const safety = (r?.safety ?? "").replace(/\s+/g, " ").trim();
    let b = `📖 <b>${escapeHtml(cleanAi(r?.name || e.name))}</b>`;
    if (instr) b += `\n${escapeHtml(instr)}`;
    if (safety) b += `\n⚠️ ${escapeHtml(safety)}`;
    blocks.push(b);
  });
  if (blocks.length) await reply(ctx, blocks.join("\n\n"));
}

export async function exerciseIdForName(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(name.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function createExerciseCatalogEntry(
  ctx: MyContext,
  query: string,
  day: PlanDay,
  mode: "swap" | "add",
  current?: PlanExercise,
  normalizedQuery?: string,
  excludeId?: string,
): Promise<CatalogExercise> {
  const currentCatalog = current?.exerciseId ? await getCatalogExercise(ctx.db, current.exerciseId) : null;
  // When the user rejected a suggestion ("Ні, інша вправа"), tell the AI to pick a different one.
  const excluded = excludeId ? await getCatalogExercise(ctx.db, excludeId) : null;
  const hint = excluded
    ? `${normalizedQuery ?? ""} — IMPORTANT: do NOT return "${excluded.name}"; the user said that is a different exercise, so author the exercise they actually mean.`
    : normalizedQuery;
  const result = await aiJSON<P.ExerciseCatalogResult>(ctx.env, {
    system: P.exerciseCatalogSystem(ctx.user.lang),
    user: P.exerciseCatalogUser(
      query,
      hint,
      current?.name ?? "",
      day.muscleGroup,
      ctx.user.profile.equipment ?? "n/a",
      ctx.user.profile.level ?? "beginner",
      mode,
    ),
    schema: P.EXERCISE_CATALOG_SCHEMA,
    temperature: 0.3,
    kind: "plan",
    db: ctx.db,
    userId: ctx.user._id,
  });
  const name = cleanAi(result.name) || cleanAi(query);
  const muscle = cleanAi(result.muscle) || currentCatalog?.muscle || muscleGroupToEnum(day.muscleGroup) || "middle back";
  const difficulty = cleanAi(result.difficulty) || currentCatalog?.difficulty || ctx.user.profile.level || "beginner";
  const equipment = (result.equipments ?? []).map((e) => cleanAi(e)).filter(Boolean);
  const catalog: CatalogExercise = {
    id: await exerciseIdForName(name),
    name,
    type: cleanAi(result.type) || undefined,
    muscle,
    difficulty,
    equipments: equipment,
    instructions: cleanAi(result.instructions),
    safetyInfo: cleanAi(result.safetyInfo),
  };
  await upsertExercise(ctx.db, catalog);
  return catalog;
}

export async function cmdToday(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  let plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"));
    return;
  }
  plan = await healPlanIfDegenerate(ctx, plan);
  plan = await healPlanNamesForDisplay(ctx, plan, lang);
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 6);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today);
  if (todays && todays.status === "pending") {
    // Overview + action buttons. Full instructions/safety are available on demand via the
    // "📖 Інфо про вправи" button (showWorkoutInfo) — not auto-sent here, to avoid clutter.
    // Auto-deload week: same exercises, ~40% fewer sets, with a notice (no manual /replan).
    const deload = shouldDeload(plan, today);
    const day = deload
      ? { ...todays.day, exercises: todays.day.exercises.map((e) => ({ ...e, sets: deloadSets(e.sets) })) }
      : todays.day;
    // Periodization awareness: show the current mesocycle phase. When a volume-deload is active
    // the deload notice already conveys it, so we don't double up the phase line.
    const meso = mesocyclePhase(weeksSincePlan(plan.generatedAt.toISOString(), today));
    const phaseKey = {
      accumulation: "phase_accumulation",
      intensification: "phase_intensification",
      peak: "phase_peak",
      deload: "phase_deload",
    } as const;
    const phaseLine =
      !deload && meso.phase !== "deload"
        ? t(lang, "periodization_line", { phase: t(lang, phaseKey[meso.phase]), week: meso.weekInBlock }) + "\n\n"
        : "";
    const notice = deload ? t(lang, "deload_today") + "\n\n" : "";
    await reply(ctx, phaseLine + notice + renderToday(lang, day, todays.label, undefined, await videosForDays(ctx, [day])), todayWorkoutKeyboard(lang, todays.weekday));
    return;
  } else {
    // Rest day or already logged → show the dated schedule then next session with action buttons.
    const next = sessions.find((s) => s.isNext);
    await reply(ctx, renderSchedule(lang, sessions, next ? await videosForDays(ctx, [next.day]) : undefined));
    if (next) {
      await reply(
        ctx,
        `🏋️ <b>${escapeHtml(next.label)} — ${escapeHtml(next.day.muscleGroup)}</b>\n` + renderDayInline(next.day),
        difficultyKeyboard(lang, next.weekday),
      );
    } else {
      // No upcoming session — a bare menu button with an empty body renders as a blank message.
      await reply(ctx, t(lang, "today_rest"), menuBtn(lang));
    }
  }
}

export async function cmdSchedule(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"));
    return;
  }
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 8);
  const next = sessions.find((s) => s.isNext) ?? sessions[0];
  await reply(ctx, renderSchedule(lang, sessions, next ? await videosForDays(ctx, [next.day]) : undefined), menuBtn(lang));
}

export async function showWorkoutInfo(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"), menuBtn(lang));
    return;
  }
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 6);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today && s.status === "pending");
  const next = todays ? todays.day : sessions.find((s) => s.isNext)?.day ?? sessions[0]?.day;
  if (!next) {
    await reply(ctx, t(lang, "exercise_info_unavailable"), menuBtn(lang));
    return;
  }
  await reply(ctx, `${t(lang, "exercise_info_header")}\n📖 <b>${escapeHtml(next.muscleGroup)}</b>`);
  await sendExerciseDescriptions(ctx, next, lang);
}

export async function startAddExercise(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const session = switchMode(ctx.user.session, "add_exercise", { targetId: weekday });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "add_exercise_prompt"));
}

export async function showDeleteExerciseMenu(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day || !day.exercises.length) {
    await reply(ctx, t(lang, "exercise_info_unavailable"), menuBtn(lang));
    return;
  }
  const kb = new InlineKeyboard();
  day.exercises.forEach((e, i) => {
    const label = `${i + 1}. ${e.name}`.slice(0, 60);
    kb.text(label, `workout:delete:${weekday}:${i}`).row();
  });
  await reply(ctx, t(lang, "delete_pick"), kb);
}

export async function deleteExerciseFromToday(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const current = day?.exercises[index];
  if (!plan || !day || !current) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const owner = planOwnerId(ctx);
  day.exercises.splice(index, 1);
  await updateActivePlanSplit(ctx.db, owner, plan.split);
  // Stash for one-tap undo.
  const session = { ...ctx.user.session, lastDeleted: { ownerId: owner, weekday, index, exercise: current } };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const updatedDay = plan.split.find((d) => d.weekday === weekday);
  await reply(ctx, t(lang, "delete_done", { name: current.name }), new InlineKeyboard().text(t(lang, "undo_delete"), "undo:del"));
  // Editing a client/user → return to their edit-day view; editing own today → self log view.
  if (isEditingOther(ctx)) {
    await reRenderEditDay(ctx, weekday);
  } else if (updatedDay) {
    await reply(ctx, renderToday(lang, updatedDay, undefined, undefined, await videosForDays(ctx, [updatedDay])), todayWorkoutKeyboard(lang, weekday));
  }
}

// Restore the most recently deleted exercise to its original position.
export async function undoDelete(ctx: MyContext) {
  const lang = ctx.user.lang;
  const d = ctx.user.session.lastDeleted;
  if (!d) {
    await reply(ctx, t(lang, "nothing_to_undo"), menuBtn(lang));
    return;
  }
  const plan = await getActivePlan(ctx.db, d.ownerId);
  const day = plan ? getPlanDay(plan, d.weekday as Weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  day.exercises.splice(Math.min(d.index, day.exercises.length), 0, d.exercise);
  await updateActivePlanSplit(ctx.db, d.ownerId, plan.split);
  const session = { ...ctx.user.session };
  delete session.lastDeleted;
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "undo_done", { name: d.exercise.name }), menuBtn(lang));
}

export function defaultSetsForExercise(catalog: CatalogExercise): string {
  switch (catalog.difficulty) {
    case "expert":
      return "4 × 6-8";
    case "intermediate":
      return "4 × 8-10";
    default:
      return "3 × 10-12";
  }
}

export function defaultStartWeightForExercise(catalog: CatalogExercise): string {
  const eq = catalog.equipments.join(" ").toLowerCase();
  const bodyweightish = catalog.type?.toLowerCase().includes("bodyweight") || eq.includes("bodyweight");
  return bodyweightish ? "Bodyweight" : "—";
}

// Default sets string by metric: timed holds → seconds, cardio → duration, else reps by difficulty.
export function defaultSetsForMetric(metric: ExerciseMetric, catalog: CatalogExercise): string {
  if (metric === "time") return "3 × 30-45s";
  if (metric === "distance") return "10 min";
  return defaultSetsForExercise(catalog);
}

// Resolve an exercise by name (catalog match, else AI-author) and ask the user to confirm
// before adding it to `weekday`. Shared by the typed add flow and the coach chat.
export async function addExerciseByName(ctx: MyContext, weekday: Weekday, query: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  try {
    const englishQuery = await translateExerciseQueryToEnglish(ctx, query);
    const matches = await searchExerciseCatalog(ctx, query, 5);
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = matches[0] ?? (await createExerciseCatalogEntry(ctx, query, day, "add", undefined, englishQuery));
    await promptExerciseConfirmation(ctx, { action: "add", weekday, query, englishQuery, catalog });
  } catch (err) {
    await onError(ctx, err, "add_exercise");
  }
}

export async function handleAddExercise(ctx: MyContext, text: string) {
  const weekday = (ctx.user.session.targetId ?? 0) as Weekday;
  await setMode(ctx, "idle");
  await addExerciseByName(ctx, weekday, extractExerciseQuery(text));
}

// Maps localized/English muscle group display names to catalog muscle enum values.
export function muscleGroupToEnum(group: string): string | null {
  const g = group.toLowerCase();
  const map: [string, string][] = [
    ["shoulder", "shoulders"], ["плеч", "shoulders"],
    ["chest", "chest"], ["груд", "chest"],
    ["back", "middle back"], ["спин", "middle back"],
    ["lat", "lats"], ["широч", "lats"],
    ["leg", "quadriceps"], ["квадр", "quadriceps"], ["ног", "quadriceps"],
    ["hamstr", "hamstrings"], ["підколін", "hamstrings"],
    ["glute", "glutes"], ["сідн", "glutes"],
    ["bicep", "biceps"], ["біцеп", "biceps"],
    ["tricep", "triceps"], ["трицеп", "triceps"],
    ["abs", "abdominals"], ["прес", "abdominals"], ["черев", "abdominals"],
    ["calf", "calves"], ["ікр", "calves"],
    ["trap", "traps"], ["трапец", "traps"],
    ["forearm", "forearms"], ["передпліч", "forearms"],
  ];
  for (const [key, val] of map) {
    if (g.includes(key)) return val;
  }
  return null;
}

// ============ Plan-day management: add / delete whole days ============
// Moved to bot/planDays.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working. See that file's header comment for why the rest of this
// region (swap variants, weight/sets direct-edit, difficulty-adjust, reorder) stayed put.

// Show exercises of a day as buttons to pick one to replace.
export async function swapMenu(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day) {
    await reply(ctx, t(lang, "no_plan"));
    return;
  }
  const kb = new InlineKeyboard();
  day.exercises.forEach((e, i) => {
    kb.text(`${i + 1}. ${e.name}`.slice(0, 60), `sw:${weekday}:${i}`).row();
  });
  // Self-edits loop back to this picker after each swap — give them an explicit exit.
  if (!isEditingOther(ctx)) kb.text(t(lang, "edit_done"), `eds:done:${weekday}`);
  await reply(ctx, t(lang, "swap_pick"), kb);
}

// User picked which exercise to swap → show 3 catalog alternatives + "type your own".
export async function showSwapAlternatives(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const current = day?.exercises[index];
  if (!current) { await reply(ctx, t(lang, "error_generic")); return; }

  let candidates: CatalogExercise[] = [];

  if (current.exerciseId) {
    // 1) Best case: grounded exercise — find alternatives by same muscle.
    const cur = await getCatalogExercise(ctx.db, current.exerciseId);
    if (cur) {
      candidates = (await listCandidatesByMuscles(ctx.db, [cur.muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== current.exerciseId);
    }
  }

  if (!candidates.length) {
    // 2) Fallback: search catalog by English canonical name or current name.
    const searchName = current.canonicalName ?? current.name;
    const nameMatch = await searchExerciseCatalog(ctx, searchName, 1);
    if (nameMatch.length) {
      candidates = (await listCandidatesByMuscles(ctx.db, [nameMatch[0].muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== nameMatch[0].id);
    }
  }

  if (!candidates.length) {
    // 3) Last resort: map muscleGroup display name to catalog muscle enum.
    const muscle = muscleGroupToEnum(day!.muscleGroup);
    if (muscle) {
      candidates = await listCandidatesByMuscles(ctx.db, [muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 });
    }
  }

  // Pick 3 random alternatives from candidates.
  const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 3);
  const kb = new InlineKeyboard();
  for (const c of shuffled) {
    // Translating each label is best-effort — a translate failure must not crash the menu.
    let translatedName = c.name;
    if (lang !== "en") {
      try {
        translatedName = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name;
      } catch {
        /* keep English name */
      }
    }
    const diff = difficultyLabel(lang, c.difficulty);
    const label = `${cleanAi(translatedName)}${diff ? ` (${diff})` : ""}`.slice(0, 60);
    kb.text(label, `swc:${weekday}:${index}:${c.id}`).row();
  }
  kb.text(t(lang, "swap_custom_btn"), `sw:custom:${weekday}:${index}`);
  await reply(ctx, t(lang, "swap_pick_alt", { name: current.name }), kb);
}

// User chose a catalog alternative — apply immediately.
export async function swapFromCatalog(ctx: MyContext, weekday: Weekday, index: number, catalogId: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) { await reply(ctx, t(lang, "no_plan")); return; }
  const day = getPlanDay(plan, weekday);
  const current = day?.exercises[index];
  if (!current) { await reply(ctx, t(lang, "error_generic")); return; }
  const alt = await getCatalogExercise(ctx.db, catalogId);
  if (!alt) { await reply(ctx, t(lang, "error_generic")); return; }
  const fromName = current.name;
  day.exercises[index] = {
    exerciseId: alt.id,
    canonicalName: alt.name,
    name: alt.name,
    sets: current.sets,
    startWeight: current.startWeight || "—",
    technique: alt.instructions ?? current.technique,
    isKeyLift: current.isKeyLift,
    muscles: alt.muscle,
  };
  // Translate if needed.
  let split = plan.split;
  const oLang = await planOwnerLang(ctx);
  if (oLang !== "en") split = await translatePlanExercises(ctx.env, oLang, split, ctx.db, planOwnerId(ctx));
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), split);
  const swapped = split.find((d) => d.weekday === weekday)?.exercises[index];
  await reply(ctx, t(lang, "swap_done", { from: fromName, to: swapped?.name ?? alt.name }), swapTuneKb(lang, weekday, index));
  // Re-show the full edit-day menu automatically (both surfaces).
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday);
  else await endSelfEdit(ctx, String(weekday));
}

// ============ On-the-fly swap DURING a logging session (equipment busy, etc.) ============
// Different from plan-time swap: does NOT mutate the active plan (tomorrow's session keeps the
// original exercise). Just stores a per-slot name override on the current logDraft so all
// prompts, the checklist and the eventual saved entry use the alternative name.

export async function showLogSwapAlternatives(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) { await cmdLog(ctx); return; }
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, draft.weekday) : undefined;
  const current = day?.exercises[index];
  if (!current) { await reply(ctx, t(lang, "error_generic")); return; }

  let candidates: CatalogExercise[] = [];
  if (current.exerciseId) {
    const cur = await getCatalogExercise(ctx.db, current.exerciseId);
    if (cur) {
      candidates = (await listCandidatesByMuscles(ctx.db, [cur.muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== current.exerciseId);
    }
  }
  if (!candidates.length) {
    const searchName = current.canonicalName ?? current.name;
    const nameMatch = await searchExerciseCatalog(ctx, searchName, 1);
    if (nameMatch.length) {
      candidates = (await listCandidatesByMuscles(ctx.db, [nameMatch[0].muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== nameMatch[0].id);
    }
  }
  if (!candidates.length && day) {
    const muscle = muscleGroupToEnum(day.muscleGroup);
    if (muscle) {
      candidates = await listCandidatesByMuscles(ctx.db, [muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 });
    }
  }

  const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 3);
  const kb = new InlineKeyboard();
  for (const c of shuffled) {
    let translatedName = c.name;
    if (lang !== "en") {
      try { translatedName = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name; } catch { /* keep English */ }
    }
    const diff = difficultyLabel(lang, c.difficulty);
    const label = `${cleanAi(translatedName)}${diff ? ` (${diff})` : ""}`.slice(0, 60);
    kb.text(label, `lswc:${index}:${c.id}`).row();
  }
  // Fall back to the plan's swap flow (mutates plan) if the user wants a permanent change.
  if (!shuffled.length) kb.text(t(lang, "log_swap_none"), `sw:custom:${draft.weekday}:${index}`).row();
  kb.text(t(lang, "back"), "log:back");
  await reply(ctx, t(lang, "log_swap_pick", { name: draft.swaps?.[index]?.name ?? current.name }), kb);
}

// ============ "Not my gym today" — one tap re-fits the WHOLE session, not one exercise ============
// Same non-mutating mechanism as the on-the-fly swap above (logDraft.swaps), just computed for
// every slot at once from a chosen equipment preset instead of picked one at a time by hand.

export async function showGymSwapPicker(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const { weekday } = localParts(ctx.user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day || !day.exercises.length) { await reply(ctx, t(lang, "gym_swap_none"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard()
    .text(t(lang, "gym_swap_bodyweight"), "gymswap:bodyweight")
    .row()
    .text(t(lang, "gym_swap_dumbbells"), "gymswap:dumbbells")
    .row()
    .text(t(lang, "gym_swap_band"), "gymswap:band")
    .row()
    .text(t(lang, "back"), "menu:today");
  await reply(ctx, t(lang, "gym_swap_prompt"), kb);
}

export async function applyGymSwap(ctx: MyContext, preset: EquipmentPreset) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const { weekday } = localParts(ctx.user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day || !day.exercises.length) { await cmdToday(ctx); return; }

  // Resolve each exercise's catalog muscle the same way the single-exercise on-the-fly swap
  // above does: grounded exerciseId first, else a name search, else the day's own muscle group.
  const slots: GymSwapSlot[] = [];
  const musclesNeeded = new Set<string>();
  for (let i = 0; i < day.exercises.length; i++) {
    const ex = day.exercises[i];
    let muscle: string | null = null;
    if (ex.exerciseId) {
      const cat = await getCatalogExercise(ctx.db, ex.exerciseId);
      muscle = cat?.muscle ?? null;
    }
    if (!muscle) {
      const nameMatch = await searchExerciseCatalog(ctx, ex.canonicalName ?? ex.name, 1);
      muscle = nameMatch[0]?.muscle ?? null;
    }
    if (!muscle) muscle = muscleGroupToEnum(day.muscleGroup);
    if (!muscle) continue;
    musclesNeeded.add(muscle);
    slots.push({ index: i, exerciseId: ex.exerciseId, muscle });
  }

  const candidatesByMuscle = new Map<string, GymSwapCandidate[]>();
  if (musclesNeeded.size) {
    const pool = await listCandidatesByMuscles(ctx.db, [...musclesNeeded], {
      level: ctx.user.profile.level, perMuscle: 20, total: 20 * musclesNeeded.size,
    });
    for (const c of pool) {
      const bucket = candidatesByMuscle.get(c.muscle) ?? [];
      bucket.push({ id: c.id, name: c.name, canonicalName: c.name, equipments: c.equipments });
      candidatesByMuscle.set(c.muscle, bucket);
    }
  }

  const picked = pickGymSwaps(slots, candidatesByMuscle, preset);
  if (!picked.size) { await reply(ctx, t(lang, "gym_swap_empty"), menuBtn(lang)); return; }

  // Translate the picked names before they land in the swap map, same as a manual single-slot
  // swap does — logDraft display and prompts read straight from swaps[i].name.
  const swaps: LogDraft["swaps"] = {};
  for (const [index, pick] of picked) {
    let name = pick.name;
    if (lang !== "en") {
      try { name = (await exerciseInfoEntry(ctx, pick.id, lang))?.name ?? pick.name; } catch { /* keep English */ }
    }
    swaps[index] = { name, canonicalName: pick.name };
  }
  await reply(ctx, t(lang, "gym_swap_applied", { n: picked.size }));
  await cmdLog(ctx, swaps);
}

export async function logSwapFromCatalog(ctx: MyContext, index: number, catalogId: string) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) { await cmdLog(ctx); return; }
  const alt = await getCatalogExercise(ctx.db, catalogId);
  if (!alt) { await reply(ctx, t(lang, "error_generic")); return; }
  let altName = alt.name;
  if (lang !== "en") {
    try { altName = (await exerciseInfoEntry(ctx, alt.id, lang))?.name ?? alt.name; } catch { /* keep English */ }
  }
  draft.swaps = { ...(draft.swaps ?? {}), [index]: { name: altName, canonicalName: alt.name } };
  await persistLogDraft(ctx, draft);
  await reply(ctx, t(lang, "log_swap_done", { to: altName }));
  await logPickExercise(ctx, index);
}

// Return to the exercise picker (used as "back" from the log-swap sub-menu).
export async function logBackToPick(ctx: MyContext) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) { await cmdLog(ctx); return; }
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, draft.weekday) : undefined;
  if (!day) { await cmdLog(ctx); return; }
  await reply(ctx, t(lang, "log_pick_exercise"), logExerciseKeyboard(lang, day, draft));
}

// User wants to type their own exercise name.
export async function startSwapCustom(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const ref = encodePlanRef(weekday, index);
  const session = switchMode(ctx.user.session, "swap_custom", { targetId: ref });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "swap_custom_ask"));
}

// Resolve a replacement exercise by name (catalog match, else AI-author) and confirm before
// swapping exercise #index of `weekday`. Shared by the typed swap flow and the coach chat.
export async function swapExerciseByName(ctx: MyContext, weekday: Weekday, index: number, query: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const current = day?.exercises[index];
  if (!current || !plan) { await reply(ctx, t(lang, "error_generic")); return; }
  try {
    const englishQuery = await translateExerciseQueryToEnglish(ctx, query);
    const matches = await searchExerciseCatalog(ctx, query, 5);
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = matches[0] ?? (await createExerciseCatalogEntry(ctx, query, day, "swap", current, englishQuery));
    await promptExerciseConfirmation(ctx, { action: "swap", weekday, index, query, englishQuery, catalog });
  } catch (err) {
    await onError(ctx, err, "swap_custom");
  }
}

// Text handler for swap_custom mode.
export async function handleSwapCustom(ctx: MyContext, text: string) {
  const { weekday, index } = decodePlanRef(ctx.user.session.targetId ?? 0);
  await setMode(ctx, "idle");
  await swapExerciseByName(ctx, weekday as Weekday, index, extractExerciseQuery(text));
}

// Set a specific exercise's weight (coach chat). Mirrors handleWeightEdit's normalization.
export async function setExerciseWeight(ctx: MyContext, weekday: Weekday, index: number, value: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const ex = day?.exercises[index];
  if (!plan || !ex) { await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  const num = parseFloat(value.replace(",", ".").replace(/[^\d.]/g, ""));
  if (Number.isFinite(num) && num > 0) ex.startWeight = `${Math.round(num * 2) / 2} kg`;
  else ex.startWeight = value.trim() || ex.startWeight;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_weight_saved", { name: ex.name, weight: ex.startWeight }), menuBtn(lang));
}

// Set a specific exercise's sets/reps (coach chat).
export async function setExerciseSets(ctx: MyContext, weekday: Weekday, index: number, value: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const ex = day?.exercises[index];
  if (!plan || !ex) { await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  ex.sets = cleanAi(value).replace(/x/i, "×").trim() || ex.sets;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_sets_saved", { name: ex.name, sets: ex.sets }), menuBtn(lang));
}

export async function adjustDifficulty(ctx: MyContext, direction: "ok" | "up" | "down", weekday?: number) {
  const lang = ctx.user.lang;
  if (direction === "ok") {
    await reply(ctx, t(lang, "plan_diff_ok_ack"), menuBtn(lang));
    return;
  }
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const wd = weekday ?? 0;
  const targetDay = plan.split.find((d) => d.weekday === wd);
  if (!targetDay) { await reply(ctx, t(lang, "no_plan"), menuBtn(lang)); return; }

  const usedIds = (targetDay.exercises ?? []).map((e) => e.exerciseId).filter(Boolean) as string[];

  // One catalog lookup per exercise (cheap PK reads) to know each one's own muscle/tier, then
  // ONE bulk candidate fetch across every distinct muscle in the day — replacing what used to be
  // up to 4 sequential RANDOM()-ordered bucket scans PER exercise (one per difficulty tier tried).
  const catalogByExerciseId = new Map<string, CatalogExercise>();
  for (const ex of targetDay.exercises ?? []) {
    if (!ex.exerciseId) continue;
    const catalog = await getCatalogExercise(ctx.db, ex.exerciseId);
    if (catalog) catalogByExerciseId.set(ex.exerciseId, catalog);
  }
  const muscles = [...new Set([...catalogByExerciseId.values()].map((c) => c.muscle))];
  const pool = await listExercisesByMusclesAnyLevel(ctx.db, muscles);
  const candidatesByMuscle = new Map<string, CatalogExercise[]>();
  for (const c of pool) {
    const bucket = candidatesByMuscle.get(c.muscle) ?? [];
    bucket.push(c);
    candidatesByMuscle.set(c.muscle, bucket);
  }

  const { exercises: updatedExercises, swappedCount } = pickDifficultySwaps(
    targetDay.exercises ?? [],
    direction,
    catalogByExerciseId,
    candidatesByMuscle,
    usedIds,
  );

  const newSplit = plan.split.map((day) =>
    day.weekday === wd ? { ...day, exercises: updatedExercises } : day
  );
  let finalSplit = newSplit;
  if (swappedCount > 0 && lang !== "en") {
    finalSplit = await translatePlanExercises(ctx.env, lang, newSplit, ctx.db, ctx.user._id);
  }
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), finalSplit);

  if (swappedCount === 0) {
    await reply(ctx, t(lang, "plan_diff_no_swap"), menuBtn(lang));
  } else {
    const base = direction === "up" ? t(lang, "plan_diff_adjusted_up") : t(lang, "plan_diff_adjusted_down");
    await reply(ctx, `${base}\n${t(lang, "plan_diff_upgraded", { n: String(swappedCount) })}`, menuBtn(lang));
  }
}

// Show exercises only for the specified weekday as buttons.
export async function openWeightEditor(ctx: MyContext, weekday?: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const kb = new InlineKeyboard();
  const days = weekday !== undefined
    ? plan.split.filter((d) => d.weekday === weekday)
    : plan.split;
  for (const day of days) {
    for (let i = 0; i < (day.exercises ?? []).length; i++) {
      const ex = day.exercises[i];
      const label = `${ex.name} — ${ex.startWeight || "—"}`.slice(0, 64);
      kb.text(label, `wt:${day.weekday}:${i}`).row();
    }
  }
  // Self-edits loop back to this picker after each save — give them an explicit exit.
  if (!isEditingOther(ctx)) kb.text(t(lang, "edit_done"), `eds:done:${weekday ?? "x"}`);
  await reply(ctx, t(lang, "plan_diff_pick_exercise"), kb);
}

export async function openSetsEditor(ctx: MyContext, weekday?: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const kb = new InlineKeyboard();
  const days = weekday !== undefined
    ? plan.split.filter((d) => d.weekday === weekday)
    : plan.split;
  for (const day of days) {
    for (let i = 0; i < (day.exercises ?? []).length; i++) {
      const ex = day.exercises[i];
      const label = `${ex.name} — ${ex.sets || "—"}`.slice(0, 64);
      kb.text(label, `st:${day.weekday}:${i}`).row();
    }
  }
  // Self-edits loop back to this picker after each save — give them an explicit exit.
  if (!isEditingOther(ctx)) kb.text(t(lang, "edit_done"), `eds:done:${weekday ?? "x"}`);
  await reply(ctx, t(lang, "plan_diff_pick_sets"), kb);
}

// Self plan-edit day menu — the editing hub for one's OWN plan (mirrors the trainer's editDayKb,
// but with self callbacks and no logging buttons). After every self edit we re-show THIS, so the
// full edit menu is always one glance away — tap another action or ✅ Done to finish.
export function selfEditDayKb(lang: Lang, weekday: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "swap_btn"), `swap:${weekday}`)
    .text(t(lang, "workout_add_btn"), `workout:add:${weekday}`)
    .row()
    .text(t(lang, "workout_delete_btn"), `workout:delete:${weekday}`)
    .text(t(lang, "reorder_btn"), `ord:open:${weekday}`)
    .row()
    .text(t(lang, "plan_diff_edit_weight"), `wt:open:${weekday}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:open:${weekday}`)
    .row()
    .text(t(lang, "warmup_edit_btn"), `wu:open:${weekday}`)
    .text(t(lang, "video_btn"), `vid:pick:${weekday}`)
    .row()
    .text(t(lang, "edit_done"), "menu:plan");
}

// Re-show the self edit-day hub (day + full edit menu). Called after each self edit and when the
// user opens a day from the day manager or taps ✅ Done in a picker.
export async function endSelfEdit(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (arg === "x") {
    await reply(ctx, t(lang, "edit_done"), menuBtn(lang));
    return;
  }
  const weekday = Number(arg) as Weekday;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  await reply(
    ctx,
    renderToday(lang, day, weekdayName(lang, weekday as Weekday), undefined, await videosForDays(ctx, [day]), { noCta: true }),
    selfEditDayKb(lang, weekday),
  );
}

// ============ Reorder exercises within a day (drag-free ⬆️/⬇️) — self and trainer/owner ============
// Operates on the plan being edited (planOwnerId), so it serves both a user editing their own
// program and a trainer/owner editing a client's. After each move the list re-renders in place.
export async function showReorder(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = getPlanDay(plan, weekday);
  if (!day || !day.exercises.length) { await reply(ctx, t(lang, "error_generic")); return; }
  const kb = new InlineKeyboard();
  day.exercises.forEach((ex, i) => {
    kb.text(`${i + 1}. ${ex.name}`.slice(0, 40), "ord:noop");
    kb.text(i > 0 ? "⬆️" : " ", i > 0 ? `ord:up:${weekday}:${i}` : "ord:noop");
    kb.text(i < day.exercises.length - 1 ? "⬇️" : " ", i < day.exercises.length - 1 ? `ord:down:${weekday}:${i}` : "ord:noop");
    kb.row();
  });
  kb.text(t(lang, "back"), `ord:back:${weekday}`);
  await reply(ctx, t(lang, "reorder_title"), kb);
}

export async function moveExercise(ctx: MyContext, weekday: Weekday, index: number, dir: "up" | "down") {
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = getPlanDay(plan, weekday);
  if (!day) return;
  const j = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || j < 0 || index >= day.exercises.length || j >= day.exercises.length) {
    await showReorder(ctx, weekday);
    return;
  }
  [day.exercises[index], day.exercises[j]] = [day.exercises[j], day.exercises[index]];
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await showReorder(ctx, weekday);
}

// Back from the reorder view → the edit-day menu of whichever context we're in.
export async function endReorder(ctx: MyContext, weekday: Weekday) {
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday);
  else await endSelfEdit(ctx, String(weekday));
}

// User tapped a specific exercise — ask for the new weight.
export async function selectExerciseWeight(ctx: MyContext, ref: string) {
  const lang = ctx.user.lang;
  const [wdStr, idxStr] = ref.split(":");
  const weekday = parseInt(wdStr, 10);
  const idx = parseInt(idxStr, 10);
  // Read the plan being edited (managed client or self) so a trainer/owner edit targets the
  // same plan that handleWeightEdit/handleSetsEdit save back to.
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const ex = plan?.split.find((d) => d.weekday === weekday)?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  const ref2 = encodePlanRef(weekday, idx);
  const session = switchMode(ctx.user.session, "weight_edit", { targetId: ref2 });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(
    ctx,
    t(lang, "plan_diff_enter_weight", { name: ex.name, current: ex.startWeight || "—" }),
  );
}

export async function selectExerciseSets(ctx: MyContext, ref: string) {
  const lang = ctx.user.lang;
  const [wdStr, idxStr] = ref.split(":");
  const weekday = parseInt(wdStr, 10);
  const idx = parseInt(idxStr, 10);
  // Read the plan being edited (managed client or self) so a trainer/owner edit targets the
  // same plan that handleWeightEdit/handleSetsEdit save back to.
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const ex = plan?.split.find((d) => d.weekday === weekday)?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  const ref2 = encodePlanRef(weekday, idx);
  const session = switchMode(ctx.user.session, "sets_edit", { targetId: ref2 });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(
    ctx,
    t(lang, "plan_diff_enter_sets", { name: ex.name, current: ex.sets || "—" }),
  );
}

// User typed the new weight for the previously selected exercise.
export async function handleWeightEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { weekday, index: idx } = decodePlanRef(ctx.user.session.targetId ?? 0);
  await setMode(ctx, "idle");
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = plan.split.find((d) => d.weekday === weekday);
  const ex = day?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  // Accept "80", "80kg", "80 kg"
  const raw = text.trim().replace(",", ".").replace(/[^\d.]/g, "");
  const kg = parseFloat(raw);
  if (!kg || kg <= 0 || kg > 1000) {
    await reply(ctx, t(lang, "plan_diff_invalid_kg"));
    return;
  }
  const rounded = Math.max(2.5, Math.round(kg / 2.5) * 2.5);
  ex.startWeight = `${rounded} kg`;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_weight_saved", { name: ex.name, weight: ex.startWeight }));
  // Re-show the full edit-day menu automatically (both surfaces), so the next action is a glance
  // away — trainer/owner get the client's edit-day view, a self-edit gets its own edit hub.
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday as Weekday);
  else await endSelfEdit(ctx, String(weekday));
}

export async function handleSetsEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { weekday, index: idx } = decodePlanRef(ctx.user.session.targetId ?? 0);
  await setMode(ctx, "idle");
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = plan.split.find((d) => d.weekday === weekday);
  const ex = day?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  const normalized = text.trim().replace(/\s+/g, " ").replace(/[xх•·]/gi, "×");
  if (!/^\d+\s*×\s*\d+(?:\s*[-–]\s*\d+)?$/.test(normalized)) {
    await reply(ctx, t(lang, "plan_diff_invalid_sets"));
    return;
  }
  ex.sets = normalized.replace(/\s*×\s*/g, " × ");
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_sets_saved", { name: ex.name, sets: ex.sets }));
  // Re-show the full edit-day menu automatically — same continuity as handleWeightEdit above.
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday as Weekday);
  else await endSelfEdit(ctx, String(weekday));
}

export type LogDraft = NonNullable<UserDoc["session"]["logDraft"]>;

// Plan display strings → numeric prefill hints for the guided logger (user types freely).
export function planSetsCount(sets: string): number {
  const m = /^\s*(\d+)/.exec(sets || "");
  const n = m ? parseInt(m[1], 10) : 0;
  return n > 0 && n <= 20 ? n : 3;
}
export function planRepsMid(sets: string): number {
  const m = /[x×]\s*(\d+)(?:\s*[-–]\s*(\d+))?/i.exec(sets || "");
  if (!m) return 8;
  const lo = parseInt(m[1], 10);
  const hi = m[2] ? parseInt(m[2], 10) : lo;
  return Math.max(1, Math.round((lo + hi) / 2));
}
export function planWeight(startWeight: string): number {
  const m = /(\d+(?:[.,]\d+)?)/.exec(startWeight || "");
  return m ? parseFloat(m[1].replace(",", ".")) : 0;
}
export function parseFirstNumber(text: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)/.exec(text);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

// Today's exercises as tappable buttons; logged ones are checked. Footer: finish + text fallback.
export function logExerciseKeyboard(lang: Lang, day: PlanDay, draft: LogDraft): InlineKeyboard {
  const done = new Set(draft.entries.map((e) => e.name));
  const kb = new InlineKeyboard();
  day.exercises.forEach((e, i) => {
    // Effective name honors an in-draft swap (equipment busy, no barbell today, etc.) so the
    // checkmark and label match what the user actually logged / will log.
    const effective = draft.swaps?.[i]?.name ?? e.name;
    const check = done.has(effective) ? "✅ " : "▫️ ";
    kb.text(`${check}${effective}`, `log:ex:${i}`).text("↔", `logsw:${i}`).row();
  });
  kb.text(t(lang, "log_finish"), "log:finish").row();
  kb.text(t(lang, "log_as_text"), "log:text");
  return kb;
}

export async function persistLogDraft(ctx: MyContext, draft: LogDraft) {
  const session: UserDoc["session"] = { ...ctx.user.session, mode: "log", logDraft: draft };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// ISO weekday (1=Mon … 7=Sun) of a YYYY-MM-DD date string.
export function isoWeekdayOf(dateStr: string): Weekday {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  return (dow === 0 ? 7 : dow) as Weekday;
}

// A guided log with entered-but-unsaved sets is the one flow whose in-progress state is real
// user data (sets they did). Returns the exercise count when such a draft is open, else null.
export function pendingLogGuard(ctx: MyContext): number | null {
  return unsavedLogCount(ctx.user.session);
}

// Called before navigating AWAY from the guided logger. If sets are entered but not saved,
// stash where the user was heading, ask Save/Discard/Continue, and return true (handled).
// `resumeToken` is a MENU_MAP key ("menu:nutrition") or "kbtext:<reply-keyboard label>".
export async function guardLogExit(ctx: MyContext, resumeToken: string): Promise<boolean> {
  const n = pendingLogGuard(ctx);
  if (n === null) return false;
  const lang = ctx.user.lang;
  const session = { ...ctx.user.session, pendingExitResume: resumeToken };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const kb = new InlineKeyboard()
    .text(t(lang, "log_exit_save"), "xexit:save")
    .text(t(lang, "log_exit_discard"), "xexit:drop")
    .row()
    .text(t(lang, "log_exit_resume"), "xexit:stay");
  await reply(ctx, t(lang, "log_exit_prompt", { n }), kb);
  return true;
}

// Run the navigation the user was heading to when the exit guard interrupted them.
async function runExitResume(ctx: MyContext) {
  const resume = ctx.user.session.pendingExitResume;
  if (!resume) { await cmdMenu(ctx); return; }
  if (resume.startsWith("kbtext:")) {
    const label = resume.slice("kbtext:".length);
    const act =
      menuActionFor(ctx.user.lang, label) ??
      (ctx.user.role === "trainer" ? trainerMenuActionFor(ctx.user.lang, label) : undefined);
    await (act ?? cmdMenu)(ctx);
  } else {
    await (MENU_MAP[resume] ?? cmdMenu)(ctx);
  }
}

// "💾 Save" / "🗑 Discard" / "↩️ Continue" on the unsaved-log prompt.
export async function onLogExit(ctx: MyContext, action: "save" | "drop" | "stay") {
  const lang = ctx.user.lang;
  // Read the destination BEFORE any setMode (logFinish → setMode idle would wipe it).
  const resume = ctx.user.session.pendingExitResume;
  if (action === "stay") {
    const session = { ...ctx.user.session };
    delete session.pendingExitResume;
    await updateUser(ctx.db, ctx.user._id, { session });
    ctx.user.session = session;
    await reply(ctx, t(lang, "log_exit_resumed"), new InlineKeyboard().text(t(lang, "log_finish"), "log:finish"));
    return;
  }
  if (action === "save") {
    await logFinish(ctx); // finalizes + post-save UX + setMode idle
  } else {
    await setMode(ctx, "idle"); // drops the draft
    await reply(ctx, t(lang, "log_exit_dropped"));
  }
  // setMode inside logFinish/here doesn't carry pendingExitResume — use the local copy.
  ctx.user.session = { ...ctx.user.session, pendingExitResume: resume };
  await runExitResume(ctx);
  const cleared = { ...ctx.user.session };
  delete cleared.pendingExitResume;
  ctx.user.session = cleared;
}

export async function cmdLog(ctx: MyContext, initialSwaps?: LogDraft["swaps"]) {
  const lang = ctx.user.lang;
  await clearEditOwner(ctx); // logging is always about the user's OWN workout — drop any client-edit context
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const { weekday } = localParts(ctx.user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  // No plan day for today (rest day / no plan) → open free-text logging with a copyable
  // format template the user edits in place. parseWorkoutText reads it back on submit.
  if (!day || !day.exercises.length) {
    await setMode(ctx, "log");
    const tmpl = `<code>${escapeHtml(t(lang, "log_freeform_template"))}</code>`;
    const kb = new InlineKeyboard()
      .text(t(lang, "cardio_btn"), "cardio:menu")
      .row()
      .text(t(lang, "log_past_btn"), "logpast:menu");
    await reply(ctx, `${t(lang, "log_no_today")}\n\n${t(lang, "log_prompt")}\n\n${tmpl}`, kb);
    return;
  }
  const draft: LogDraft = { weekday: weekday as Weekday, entries: [], ...(initialSwaps ? { swaps: initialSwaps } : {}) };
  await persistLogDraft(ctx, draft);
  const kb = logExerciseKeyboard(lang, day, draft)
    .row()
    .text(t(lang, "cardio_btn"), "cardio:menu")
    .text(t(lang, "log_past_btn"), "logpast:menu");
  await reply(ctx, t(lang, "log_pick_exercise"), kb);
}

// Separate flow: log a workout the user missed logging — the last 3 days that had a planned
// session. Each day carries its own date onto the draft so logFinish stamps the right date.
export async function cmdLogPast(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) { await reply(ctx, t(lang, "log_past_none"), menuBtn(lang)); return; }
  const { date: today } = localParts(ctx.user.profile.timezone);
  const kb = new InlineKeyboard();
  let any = false;
  for (let d = 1; d <= 3; d++) {
    const ds = isoDateMinus(today, d);
    const wd = isoWeekdayOf(ds);
    const day = getPlanDay(plan, wd);
    if (!day || !day.exercises.length) continue; // rest day → nothing to log
    const logged = await getWorkoutLog(ctx.db, ctx.user._id, ds);
    const label = `${logged ? "✅ " : "▫️ "}${t(lang, OB_WEEKDAY_KEYS[wd])} ${ds.slice(5)} — ${day.muscleGroup}`;
    kb.text(label.slice(0, 60), `logpast:${ds}`).row();
    any = true;
  }
  if (!any) { await reply(ctx, t(lang, "log_past_none"), menuBtn(lang)); return; }
  await reply(ctx, t(lang, "log_past_title"), kb);
}

export async function startPastLog(ctx: MyContext, dateStr: string) {
  const lang = ctx.user.lang;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const wd = isoWeekdayOf(dateStr);
  const day = plan ? getPlanDay(plan, wd) : undefined;
  if (!day || !day.exercises.length) { await reply(ctx, t(lang, "log_past_none"), menuBtn(lang)); return; }
  const draft: LogDraft = { weekday: wd, date: dateStr, entries: [] };
  const session: UserDoc["session"] = { mode: "log", logDraft: draft };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, `${t(lang, "log_past_picked", { date: dateStr })}\n\n${t(lang, "log_pick_exercise")}`, logExerciseKeyboard(lang, day, draft));
}

// Tap an exercise → start its text entry. Reps exercises ask sets→weight→reps; timed holds ask
// sets→duration; distance cardio asks distance→(optional) time.
export async function logPickExercise(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) { await cmdLog(ctx); return; }
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const ex = plan ? getPlanDay(plan, draft.weekday)?.exercises[index] : undefined;
  if (!ex) return;
  // Honor an on-the-fly swap: if the user replaced this slot for this session, all prompts,
  // stored entries, and PR reconciliation use the alternative name instead of the plan's.
  const effectiveName = draft.swaps?.[index]?.name ?? ex.name;
  const metric = exerciseMetric(ex);
  if (metric === "distance") {
    draft.cur = { name: effectiveName, metric, field: "meters" };
    await persistLogDraft(ctx, draft);
    await reply(ctx, t(lang, "log_ask_distance", { name: effectiveName }));
    return;
  }
  if (metric === "time") {
    draft.cur = { name: effectiveName, metric, field: "sets" };
    await persistLogDraft(ctx, draft);
    await reply(ctx, t(lang, "log_ask_sets", { name: effectiveName, n: String(planSetsCount(ex.sets)) }));
    return;
  }
  draft.cur = { name: effectiveName, metric, field: "line" };
  await persistLogDraft(ctx, draft);
  const w = planWeight(ex.startWeight);
  const n = planSetsCount(ex.sets) || 3;
  const r = planRepsMid(ex.sets) || 8;
  const hint = w ? `${w} ${Array.from({ length: n }, () => r).join(",")}` : Array.from({ length: n }, () => r).join(",");
  await reply(ctx, t(lang, "log_ask_line", { name: effectiveName, sets: ex.sets, hint }));
}

// Persist one finished exercise into the draft and prompt for the next pick.
export async function finishLogEntry(ctx: MyContext, draft: NonNullable<UserDoc["session"]["logDraft"]>, name: string, setsDone: SetEntry[], summary: string) {
  const lang = ctx.user.lang;
  draft.entries = draft.entries.filter((e) => e.name !== name); // replace a re-logged exercise
  draft.entries.push({ name, setsDone });
  draft.cur = undefined;
  await persistLogDraft(ctx, draft);
  await replyEntrySaved(ctx, draft, draft.entries[draft.entries.length - 1], t(lang, "log_exercise_saved", { name, summary }));
}

// Saved-exercise message: per-set edit buttons (tap a set to fix its reps/weight before Done),
// then the next-exercise picker and the rest-timer row.
async function replyEntrySaved(
  ctx: MyContext,
  draft: NonNullable<UserDoc["session"]["logDraft"]>,
  entry: { name: string; setsDone: SetEntry[] },
  header: string,
) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, draft.weekday) : undefined;
  const kb = new InlineKeyboard();
  const entryIdx = draft.entries.indexOf(entry);
  // Reps-metric sets only (a rowing/plank entry has nothing tap-editable in this shape).
  if (entryIdx >= 0 && entry.setsDone.length && entry.setsDone.every((s) => s.reps > 0 && !s.seconds && !s.meters)) {
    entry.setsDone.slice(0, 8).forEach((s, j) => {
      kb.text(s.weight ? `${s.weight}×${s.reps}` : `BW×${s.reps}`, `lset:${entryIdx}:${j}`);
    });
    kb.row();
  }
  // How hard was it? One-tap RIR→RPE so autoregulation has real effort data instead of guessing.
  // Buttons carry RPE×10 (100/85/70/55); the chosen one is checkmarked.
  if (entryIdx >= 0) {
    const cur = Math.round(((entry as { rpe?: number }).rpe ?? 0) * 10);
    const mark = (v: number, label: string) => (cur === v ? `✓ ${label}` : label);
    kb.row()
      .text(mark(100, t(lang, "rpe_failure")), `srpe:${entryIdx}:100`)
      .text(mark(85, t(lang, "rpe_hard")), `srpe:${entryIdx}:85`)
      .text(mark(70, t(lang, "rpe_moderate")), `srpe:${entryIdx}:70`)
      .text(mark(55, t(lang, "rpe_easy")), `srpe:${entryIdx}:55`);
  }
  if (day) {
    const picker = logExerciseKeyboard(lang, day, draft);
    for (const row of picker.inline_keyboard) kb.inline_keyboard.push([...row]);
  }
  kb.row()
    .text(t(lang, "rest_1m"), "rest:60")
    .text(t(lang, "rest_2m"), "rest:120")
    .text(t(lang, "rest_3m"), "rest:180");
  const body = `${header}\n${t(lang, "log_set_tap_hint")}`;
  await reply(ctx, body, kb);
}

// One-tap effort (RIR→RPE) for a just-logged exercise; drives progression autoregulation.
export async function setEntryRpe(ctx: MyContext, entryIdx: number, rpe10: number) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  const entry = draft?.entries[entryIdx];
  if (!draft || !entry) { await ctx.answerCallbackQuery().catch(() => {}); return; }
  entry.rpe = rpe10 / 10;
  await persistLogDraft(ctx, draft);
  const label = rpe10 >= 100 ? "rpe_failure" : rpe10 >= 85 ? "rpe_hard" : rpe10 >= 70 ? "rpe_moderate" : "rpe_easy";
  await ctx.answerCallbackQuery({ text: t(lang, "rpe_saved", { level: t(lang, label) }) }).catch(() => {});
  await replyEntrySaved(ctx, draft, entry, t(lang, "log_exercise_saved", { name: entry.name, summary: entry.setsDone.map(formatSetEntry).join(", ") }));
}

// Tap on a set button — park the edit target; the user's next message corrects that set.
export async function startSetEdit(ctx: MyContext, entryIdx: number, setIdx: number) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  const entry = draft?.entries[entryIdx];
  const set = entry?.setsDone[setIdx];
  if (!draft || !entry || !set) {
    await reply(ctx, t(lang, "log_set_gone"));
    return;
  }
  draft.editSet = { entry: entryIdx, set: setIdx };
  await persistLogDraft(ctx, draft);
  await reply(ctx, t(lang, "log_set_edit_prompt", { n: setIdx + 1, name: entry.name, cur: formatSetEntry(set) }));
}

// Schedule the one-shot rest nudge; the every-minute cron sweep delivers it.
export async function onRestTimer(ctx: MyContext, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 30 || seconds > 900) return;
  const dueAt = new Date(Date.now() + seconds * 1000).toISOString();
  await setRestTimer(ctx.db, ctx.user._id, ctx.user.chatId, dueAt, ctx.user.lang);
  await reply(ctx, t(ctx.user.lang, "rest_set", { m: Math.round(seconds / 60) }));
}

// Lines that mean "no time recorded" when answering the optional cardio-time prompt.
export const SKIP_TIME_RE = /^(?:-|—|0|skip|пропуст\w*|нема\w*|no|none)$/i;

// Free-text answer for the exercise mid-entry. Returns false when no exercise is being entered
// (so the caller falls back to full free-text log parsing).
export async function handleLogDraftInput(ctx: MyContext, text: string): Promise<boolean> {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) return false;
  // A tapped set button parked an edit target — this message corrects that single set.
  if (draft.editSet) {
    const entry = draft.entries[draft.editSet.entry];
    const set = entry?.setsDone[draft.editSet.set];
    if (!entry || !set) {
      draft.editSet = undefined;
      await persistLogDraft(ctx, draft);
      return false;
    }
    const upd = parseSetEdit(text);
    if (!upd) {
      await reply(ctx, t(lang, "log_set_edit_bad"));
      return true;
    }
    if (upd.weight !== undefined) set.weight = upd.weight;
    set.reps = upd.reps;
    // A per-set edit can also update the effort. If the user wants to clear the RPE they can
    // omit it — we only overwrite when explicitly provided ("75x8@9").
    if (typeof upd.rpe === "number") set.rpe = upd.rpe;
    draft.editSet = undefined;
    await persistLogDraft(ctx, draft);
    await replyEntrySaved(ctx, draft, entry, t(lang, "log_set_edited"));
    return true;
  }
  const cur = draft.cur;
  if (!cur) return false;
  const num = parseFirstNumber(text);
  const metric = cur.metric ?? "reps";
  const planEx = () => getActivePlan(ctx.db, ctx.user._id)
    .then((p) => (p ? getPlanDay(p, draft.weekday)?.exercises.find((e) => e.name === cur.name) : undefined));

  // One-line compact entry (reps metric): the whole exercise in a single message.
  if (cur.field === "line") {
    const ex = await planEx();
    const bodyweight = !planWeight(ex?.startWeight ?? "");
    const parsed = parseSetLine(text, { defaultSets: planSetsCount(ex?.sets ?? "") || 3, bodyweight });
    if (!parsed) {
      await reply(ctx, t(lang, "log_line_bad"));
      return true;
    }
    if (parsed.kind === "weight") {
      // Only a weight was given — graceful fallback: ask reps (still 2 messages, not 3).
      cur.weight = parsed.weight;
      cur.sets = planSetsCount(ex?.sets ?? "") || 3;
      cur.field = "reps";
      await persistLogDraft(ctx, draft);
      await reply(ctx, t(lang, "log_ask_reps", { name: cur.name, n: String(planRepsMid(ex?.sets ?? "")) }));
      return true;
    }
    await finishLogEntry(ctx, draft, cur.name, parsed.sets, parsed.sets.map(formatSetEntry).join(", "));
    return true;
  }

  // Distance cardio (rowing, run): distance → optional time, recorded as a single set.
  if (metric === "distance") {
    if (cur.field === "meters") {
      const meters = parseDistance(text) ?? num;
      if (meters === undefined || meters < 1 || meters > 200_000) { await reply(ctx, t(lang, "log_bad_distance")); return true; }
      cur.meters = Math.round(meters);
      cur.field = "seconds";
      await persistLogDraft(ctx, draft);
      await reply(ctx, t(lang, "log_ask_time_opt", { name: cur.name }));
      return true;
    }
    const skip = SKIP_TIME_RE.test(text.trim());
    const seconds = skip ? undefined : (parseDuration(text) ?? num);
    if (!skip && (seconds === undefined || seconds < 1 || seconds > 86_400)) { await reply(ctx, t(lang, "log_bad_time")); return true; }
    const set: SetEntry = { weight: 0, reps: 0, meters: cur.meters ?? 0, ...(seconds ? { seconds: Math.round(seconds) } : {}) };
    await finishLogEntry(ctx, draft, cur.name, [set], formatSetEntry(set));
    return true;
  }

  // Timed holds (plank, dead hang): sets → duration per set.
  if (metric === "time") {
    if (cur.field === "sets") {
      if (num === undefined || num < 1 || num > 20) { await reply(ctx, t(lang, "log_bad_sets")); return true; }
      cur.sets = Math.round(num);
      cur.field = "seconds";
      await persistLogDraft(ctx, draft);
      await reply(ctx, t(lang, "log_ask_seconds", { name: cur.name }));
      return true;
    }
    const seconds = parseDuration(text) ?? num;
    if (seconds === undefined || seconds < 1 || seconds > 86_400) { await reply(ctx, t(lang, "log_bad_time")); return true; }
    const sec = Math.round(seconds);
    const sets = cur.sets ?? 1;
    const setsDone: SetEntry[] = Array.from({ length: sets }, () => ({ weight: 0, reps: 0, seconds: sec }));
    await finishLogEntry(ctx, draft, cur.name, setsDone, `${sets} × ${fmtDuration(sec)}`);
    return true;
  }

  // Reps (default): sets → weight → reps. Weight & reps apply to every set.
  if (cur.field === "sets") {
    if (num === undefined || num < 1 || num > 20) { await reply(ctx, t(lang, "log_bad_sets")); return true; }
    cur.sets = Math.round(num);
    cur.field = "weight";
    await persistLogDraft(ctx, draft);
    const ex = await planEx();
    await reply(ctx, t(lang, "log_ask_weight", { name: cur.name, n: String(planWeight(ex?.startWeight ?? "")) }));
    return true;
  }
  if (cur.field === "weight") {
    if (num === undefined || num < 0 || num > 1000) { await reply(ctx, t(lang, "log_bad_weight")); return true; }
    cur.weight = num;
    cur.field = "reps";
    await persistLogDraft(ctx, draft);
    const ex = await planEx();
    await reply(ctx, t(lang, "log_ask_reps", { name: cur.name, n: String(planRepsMid(ex?.sets ?? "")) }));
    return true;
  }
  // reps → record N identical sets of (weight × reps).
  if (num === undefined || num < 1 || num > 1000) { await reply(ctx, t(lang, "log_bad_reps")); return true; }
  const reps = Math.round(num);
  const sets = cur.sets ?? 1;
  const weight = cur.weight ?? 0;
  const setsDone: SetEntry[] = Array.from({ length: sets }, () => ({ weight, reps }));
  const wTxt = weight ? `${weight} kg` : t(lang, "log_bodyweight");
  await finishLogEntry(ctx, draft, cur.name, setsDone, `${sets} × ${wTxt} × ${reps}`);
  return true;
}

// "✅ Готово" — persist everything logged this session and run the shared post-save UX.
export async function logFinish(ctx: MyContext) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft || !draft.entries.length) { await reply(ctx, t(lang, "log_nothing")); return; }
  // A missed past day carries its own date on the draft; otherwise log against today.
  const date = draft.date ?? localParts(ctx.user.profile.timezone).date;
  const byExercise = new Map<string, SetEntry[]>();
  const rpeByExercise = new Map<string, number>();
  for (const e of draft.entries) {
    byExercise.set(e.name, e.setsDone);
    if (typeof e.rpe === "number") rpeByExercise.set(e.name, e.rpe);
  }
  const rawText = draft.entries
    .map((e) => `${e.name} ${e.setsDone.map(formatSetEntry).join(", ")}`)
    .join("\n");
  await finalizeWorkoutLog(ctx, date, draft.weekday, byExercise, rpeByExercise, rawText);
}

// Skip-triggered adaptive check-in: the user tapped why they missed today's session. Mark it
// skipped (so the schedule rolls forward) and reply with a response tailored to the reason.
export async function handleSkipReason(ctx: MyContext, reason: string) {
  const lang = ctx.user.lang;
  const { date, weekday } = localParts(ctx.user.profile.timezone);
  await upsertWorkoutLog(ctx.db, ctx.user._id, date, weekday as Weekday, [], false).catch(() => {});
  const replies = { illness: "skip_reply_illness", busy: "skip_reply_busy", nomotiv: "skip_reply_nomotiv" } as const;
  const key = replies[reason as keyof typeof replies] ?? "skip_reply_busy";
  await reply(ctx, t(lang, key), menuBtn(lang));
}

// "✍️ Текстом" — drop the draft and accept a full free-text log instead.
// ============ Guided cardio quick-log (rowing / bike / run — time & distance, no weight×reps) ============
// The free-text parser already reads "Гребля 20 хв 5 км", but users don't discover that. This walks
// them: pick a type → type the time and/or distance → it's saved via the same log path. The chosen
// name is prepended so records track it on the seconds/meters axis (metricOfSets infers the metric).
export async function logSwitchToText(ctx: MyContext) {
  const lang = ctx.user.lang;
  await setMode(ctx, "log"); // clears logDraft
  let prompt = t(lang, "log_prompt");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const { weekday } = localParts(ctx.user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (day) {
    const template = day.exercises.map((e) => `${e.name} ___x__`).join("\n");
    prompt += `\n\n<code>${escapeHtml(template)}</code>`;
  }
  await reply(ctx, prompt);
}

export async function cmdProgress(ctx: MyContext) {
  const lang = ctx.user.lang;
  const records = await listStrength(ctx.db, ctx.user._id);
  if (!records.length) {
    await reply(ctx, t(lang, "progress_none"), menuBtn(lang));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  // Personal 28-day streak calendar (gamification, no leaderboard).
  const since28 = localCutoff(ctx.user.profile.timezone, 28);
  const [wLogs, nLogs, total, plan, bodyLogs, statCounts] = await Promise.all([
    workoutLogsSince(ctx.db, ctx.user._id, since28),
    nutritionLogsSince(ctx.db, ctx.user._id, since28),
    countCompletedWorkouts(ctx.db, ctx.user._id),
    getActivePlan(ctx.db, ctx.user._id),
    bodyLogsByUser(ctx.db, ctx.user._id).catch(() => []),
    userStatCounts(ctx.db, ctx.user._id).catch(() => ({ workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 })),
  ]);
  const completed = wLogs.filter((l) => l.completed);
  const workoutDates = new Set(completed.map((l) => l.date));
  const nutritionDates = new Set(nLogs.map((l) => l.date));
  // Off-plan vs planned: a completed log on a weekday the plan doesn't schedule is a bonus session.
  const planWeekdays = new Set((plan?.split ?? []).map((d) => d.weekday));
  const offPlan = completed.filter((l) => planWeekdays.size > 0 && !planWeekdays.has(l.weekday)).length;
  const weekStart = weekStartStr(date);
  const thisWeek = completed.filter((l) => l.date >= weekStart).length;
  const streak = weekStreak([...workoutDates], date, ctx.user.reminders?.lastVacation);
  // Rest-day activity: days fed/tracked but not trained — so a rest day isn't "empty".
  const restActive = [...nutritionDates].filter((d) => !workoutDates.has(d)).length;
  const lv = levelFromXp(computeXp(statCounts));
  const summary =
    `${t(lang, "progress_summary")}\n` +
    `${t(lang, "progress_level_line", { level: lv.level, xp: lv.xp, bar: progressBar((lv.intoLevel / lv.needed) * 100) })}\n` +
    `${t(lang, "progress_total_line", { total, week: thisWeek })}\n` +
    `${t(lang, "progress_streak_line", { n: streak })}\n` +
    (offPlan > 0 ? `${t(lang, "progress_offplan_line", { n: offPlan })}\n` : "") +
    `${t(lang, "progress_restdays_line", { n: restActive })}`;
  let msg = `${summary}\n\n${renderStrength(lang, records)}`;
  msg += `\n\n${renderActivityGrid(lang, buildActivityCells(date, workoutDates, nutritionDates, 28))}`;
  if (deloadDue(records, date)) msg += `\n\n${t(lang, "deload_due")}`;
  try {
    const narrative = await aiText(ctx.env, {
      system: P.progressSystem(lang),
      user: JSON.stringify(
        records.map((r) => ({
          exercise: r.exercise,
          best: `${r.bestWeight}x${r.bestReps}`,
          history: r.history.slice(-6),
        })),
      ),
      temperature: 0.5,
      kind: "progress",
      db: ctx.db,
      userId: ctx.user._id,
    });
    msg += `\n\n💬 <i>${escapeHtml(narrative)}</i>`;
  } catch {
    /* narrative is optional */
  }
  const weights = bodyLogs.filter((b) => typeof b.weight === "number" && b.weight > 0).map((b) => ({ date: b.date, weight: b.weight as number }));
  // Weight-goal projection: trend toward the target, with an ETA when on track.
  const goalLine = weightGoalLine(ctx, weights);
  if (goalLine) msg += `\n\n${goalLine}`;
  // Plateau heads-up: lifts with no recent e1RM gain.
  const stalled = stalledLifts(records, date);
  if (stalled.length) msg += `\n\n${t(lang, "plateau_line", { lifts: stalled.slice(0, 3).map(escapeHtml).join(", ") })}`;
  // Visual charts (weight trend, e1RM, measurements) live in the Mini App dashboard now —
  // no more external QuickChart PNG round-trips on every /progress.
  const kb = new InlineKeyboard()
    .text(t(lang, "exchart_btn"), "exlist")
    .text(t(lang, "standards_btn"), "std")
    .row()
    .text(t(lang, "volume_btn"), "vol")
    .text(t(lang, "calc_btn"), "calc")
    .row()
    .text(t(lang, "wellbeing_btn"), "well")
    .text(t(lang, "wcard_btn"), "share:week")
    .row();
  const app = dashboardUrl();
  if (app) kb.webApp(t(lang, "menu_dashboard"), app).row();
  kb.text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, msg, kb);
}

// Shareable week card — a <pre> summary of the last 7 days the user can forward to friends.
export async function cmdWeekCard(ctx: MyContext) {
  const lang = ctx.user.lang;
  const card = await buildWeekCard(ctx.db, ctx.user._id, ctx.user.profile.timezone, ctx.user.profile.name ?? "", lang, ctx.user.reminders?.lastVacation);
  if (!card) {
    await reply(ctx, t(lang, "wcard_empty"), menuBtn(lang));
    return;
  }
  // The card gets forwarded into group chats as-is, so it carries the sender's referral link:
  // every forward becomes a click target instead of just a screenshot. Only on the self-serve
  // path — a trainer forwarding a CLIENT's card (buildWeekCard's other callers) must not attach
  // the client's link.
  const ref = botDeepLink(ctx.env, `ref_${ctx.user._id}`);
  const footer = ref ? t(lang, "wcard_ref", { link: ref }) : t(lang, "wcard_share_hint");
  await reply(ctx, `${card}\n\n${footer}`, menuBtn(lang));
}

// Strength standards — classify the user's tracked big lifts (squat/bench/deadlift/OHP/row) into
// a bodyweight-relative bracket, with the load needed for the next level. Approximate, motivational.
export async function cmdStandards(ctx: MyContext) {
  const lang = ctx.user.lang;
  const sex = ctx.user.profile.sex;
  const records = await listStrength(ctx.db, ctx.user._id);
  // Bodyweight: latest logged weight, else profile weight.
  const bodyLogs = await bodyLogsByUser(ctx.db, ctx.user._id).catch(() => []);
  const weights = bodyLogs.filter((b) => typeof b.weight === "number" && b.weight! > 0);
  const bw = weights.length ? (weights[weights.length - 1].weight as number) : (ctx.user.profile.weightKg ?? 0);
  if (bw <= 0) {
    // One-tap route into the body editor instead of a "go find Settings" dead end.
    const kb = new InlineKeyboard().text(t(lang, "edit_body"), "set:body").row().text(t(lang, "menu_open"), "menu:open");
    await reply(ctx, t(lang, "standards_no_weight"), kb);
    return;
  }
  const levelName = (lv: StrengthLevel) => t(lang, `std_lvl_${lv}` as TKey);
  const lines: string[] = [];
  for (const r of records) {
    if (r.bestWeight <= 0) continue;
    const oneRm = e1rm(r.bestWeight, r.bestReps);
    const std = strengthStandard(r.exercise, sex, bw, oneRm);
    if (!std) continue;
    let line = `${escapeHtml(r.exercise)}: <b>${levelName(std.level)}</b> · ${Math.round(oneRm)}${t(lang, "unit_kg")} (×${std.ratio.toFixed(2)})`;
    if (std.next && std.nextTargetKg) {
      line += `\n   ${t(lang, "standards_next", { level: levelName(std.next), kg: std.nextTargetKg })}`;
    }
    lines.push(line);
  }
  if (!lines.length) { await reply(ctx, t(lang, "standards_none"), menuBtn(lang)); return; }
  const header = t(lang, "standards_title", { bw: Math.round(bw), sex: t(lang, sex === "female" ? "sex_female" : "sex_male") });
  await reply(ctx, `${header}\n\n${lines.join("\n\n")}\n\n${t(lang, "standards_footer")}`, menuBtn(lang));
}

// Weight-goal projection line for the progress screen — trend toward the user's target, ETA when
// on track. Returns null when no goal is set or there's too little weight history.
export function weightGoalLine(ctx: MyContext, weights: { date: string; weight: number }[]): string | null {
  const lang = ctx.user.lang;
  const goal = ctx.user.profile.goalWeight;
  if (!goal || goal <= 0) return null;
  const p = projectWeight(weights, goal);
  if (!p) return null;
  if (p.reached) return t(lang, "goal_reached", { goal });
  const trend = t(lang, p.slopePerWeek === 0 ? "goal_trend_flat" : p.slopePerWeek < 0 ? "goal_trend_down" : "goal_trend_up", { kg: Math.abs(p.slopePerWeek) });
  if (p.onTrack && p.etaWeeks) {
    return t(lang, "goal_on_track", { current: Math.round(p.current), goal, trend, weeks: p.etaWeeks });
  }
  return t(lang, "goal_off_track", { current: Math.round(p.current), goal, trend });
}

export const VOL_GROUP_LABEL: Record<string, TKey> = {
  legs: "mg_legs", back: "mg_back", chest: "mg_chest", shoulders: "mg_shoulders", arms: "mg_arms", core: "mg_core",
};
export const VOL_ZONE_EMOJI: Record<string, string> = { below: "🔻", optimal: "✅", above: "🔺" };

// Weekly training volume (working sets) per muscle group vs. MEV/MAV landmarks.
export async function cmdVolume(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const since = localCutoff(ctx.user.profile.timezone, 7);
  const logs = await workoutLogsSince(ctx.db, ctx.user._id, since);
  const vols = weeklyVolume(logs, since).filter((v) => v.group !== "core" || v.sets > 0);
  const totalSets = vols.reduce((s, v) => s + v.sets, 0);
  if (!totalSets) { await reply(ctx, t(lang, "volume_none"), menuBtn(lang)); return; }
  const fmt = (v: MuscleVolume) =>
    `${VOL_ZONE_EMOJI[v.zone]} ${t(lang, VOL_GROUP_LABEL[v.group])}: <b>${v.sets}</b> ${t(lang, "volume_sets")} (MEV ${v.mev} · MAV ${v.mav})`;
  const body = `${t(lang, "volume_title")}\n\n${vols.map(fmt).join("\n")}\n\n${t(lang, "volume_legend")}`;
  await reply(ctx, body, menuBtn(lang));
}

// Plate & warm-up calculator: ask for a working weight, then show the per-side plate breakdown
// and a percentage warm-up ramp.
export async function cmdPlates(ctx: MyContext) {
  await clearEditOwner(ctx);
  await setMode(ctx, "calc_weight");
  await reply(ctx, t(ctx.user.lang, "calc_prompt"));
}

export async function handleCalcWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const target = parseFloat(text.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(target) || target <= 0 || target > 600) { await reply(ctx, t(lang, "calc_invalid")); return; }
  await setMode(ctx, "idle");
  const plan = platePlan(target);
  const kg = t(lang, "unit_kg");
  let body: string;
  if (!plan) {
    body = t(lang, "calc_below_bar", { bar: 20 });
  } else {
    const perSide = plan.perSide.length ? plan.perSide.join(" + ") : "—";
    body = t(lang, "calc_plates", { target: Math.round(plan.loaded), perside: perSide });
    if (plan.leftover > 0) body += "\n" + t(lang, "calc_leftover", { kg: plan.leftover });
  }
  // Warm-up ramp toward the target.
  const ramp = warmupRamp(target);
  const rampLines = ramp.map((w) => `• ${w.weight}${kg} × ${w.reps}${w.pct ? ` (${w.pct}%)` : ""}`).join("\n");
  body += `\n\n${t(lang, "calc_warmup")}\n${rampLines}`;
  await reply(ctx, body, menuBtn(lang));
}

// Wellbeing trend — energy/sleep/stress from daily check-ins (chart + averages).
export async function cmdWellbeing(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const checkins = await dailyCheckinsSince(ctx.db, ctx.user._id, localCutoff(ctx.user.profile.timezone, 90));
  if (checkins.length < 2) { await reply(ctx, t(lang, "wellbeing_none"), menuBtn(lang)); return; }
  const cfg = wellbeingChart(lang, checkins);
  if (cfg) await sendChartPng(ctx, cfg);
  const avg = (sel: (c: (typeof checkins)[number]) => number) => (checkins.reduce((s, c) => s + sel(c), 0) / checkins.length).toFixed(1);
  await reply(
    ctx,
    t(lang, "wellbeing_summary", { n: checkins.length, energy: avg((c) => c.energy), sleep: avg((c) => c.sleep), stress: avg((c) => c.stress) }),
    menuBtn(lang),
  );
}


// AI suggestion for the macros remaining today (button on the nutrition screen).
export async function onMacrosSuggest(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date, weekday } = localParts(ctx.user.profile.timezone);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const trainingDays = ctx.user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as Weekday);
  const targets = (!isTraining && plan?.restDayNutrition) || ctx.user.nutrition;
  if (!targets) { await reply(ctx, t(lang, "nutrition_no_targets")); return; }
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const tot = meals.reduce((a, m) => ({ k: a.k + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }), { k: 0, p: 0, f: 0, c: 0 });
  const left = {
    kcal: Math.max(0, targets.calories - tot.k),
    protein: Math.max(0, targets.protein - tot.p),
    fats: Math.max(0, targets.fats - tot.f),
    carbs: Math.max(0, targets.carbs - tot.c),
  };
  if (left.kcal <= 50 && left.protein <= 5) { await reply(ctx, t(lang, "macros_done"), menuBtn(lang)); return; }
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "coach", async () => {
    const txt = await aiText(ctx.env, {
      system: P.macrosLeftSystem(lang, ctx.user.profile),
      user: JSON.stringify(left),
      temperature: 0.6,
      kind: "nutrition",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const header = t(lang, "macros_left", { kcal: left.kcal, p: left.protein, f: left.fats, c: left.carbs });
    await reply(ctx, `${header}\n\n${escapeHtml(cleanAi(txt))}`, menuBtn(lang));
  });
}

// POST a QuickChart config and upload the PNG (used by overview + per-exercise charts).
export async function sendChartPng(ctx: MyContext, chart: string) {
  try {
    const res = await fetch("https://quickchart.io/chart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chart, width: 720, height: 360, backgroundColor: "white", format: "png", version: "2" }),
    });
    if (!res.ok) {
      await recordError(ctx.db, { userId: ctx.user._id, kind: "chart", errorType: `http_${res.status}`, message: (await res.text()).slice(0, 180) }).catch(() => {});
      return;
    }
    await ctx.replyWithPhoto(new InputFile(new Uint8Array(await res.arrayBuffer()), "chart.png"));
  } catch (e) {
    await recordError(ctx.db, { userId: ctx.user._id, kind: "chart", errorType: "exception", message: String(e).slice(0, 180) }).catch(() => {});
  }
}

// Tracked lifts with ≥2 weighted sessions — the ones that can form a per-exercise trend line.
export async function chartableLifts(ctx: MyContext) {
  return (await listStrength(ctx.db, ctx.user._id)).filter(
    (r) => r.metric !== "time" && r.metric !== "distance" && r.history.filter((h) => h.weight > 0).length >= 2,
  );
}

export async function showExerciseList(ctx: MyContext) {
  const lang = ctx.user.lang;
  const lifts = await chartableLifts(ctx);
  if (!lifts.length) { await reply(ctx, t(lang, "exchart_none"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  lifts.slice(0, 20).forEach((r, i) => kb.text(`📈 ${r.exercise}`.slice(0, 55), `exch:${i}`).row());
  await reply(ctx, t(lang, "exchart_pick"), kb);
}

export async function onExerciseChart(ctx: MyContext, index: number) {
  const lift = (await chartableLifts(ctx))[index];
  if (!lift) { await showExerciseList(ctx); return; }
  const cfg = exerciseChart(ctx.user.lang, lift.exercise, lift.history);
  if (cfg) await sendChartPng(ctx, cfg);
  await reply(ctx, lift.exercise, menuBtn(ctx.user.lang));
}

export async function cmdNutrition(ctx: MyContext) {
  await setMode(ctx, "nutrition");
  await showFoodLog(ctx);
}

// Today's logged food with per-item KБЖУ + delete buttons, day totals vs target, and the add hint.
// Editing = delete the wrong item (🗑) and re-send it. The mode stays "nutrition" so any text/photo adds.
export async function showFoodLog(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date, weekday } = localParts(ctx.user.profile.timezone);
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  if (!meals.length) {
    await reply(ctx, t(lang, "nutrition_prompt"), new InlineKeyboard().text(t(lang, "food_recent_btn"), "food:recent"));
    return;
  }
  const tot = meals.reduce(
    (a, m) => ({ kcal: a.kcal + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const trainingDays = ctx.user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as Weekday);
  const targets = (!isTraining && plan?.restDayNutrition) || ctx.user.nutrition;
  const lines = meals
    .map((m, i) => {
      const g = num(m.grams);
      const wt = g ? ` · ${g} ${t(lang, "unit_g")}` : "";
      const alc = alcoholKcalOf(m);
      const alcTag = alc > 0 ? ` · 🍷 ${alc} ${t(lang, "unit_kcal")}` : "";
      return `${i + 1}. ${escapeHtml(cleanFoodName(m.desc))}${wt} — ${num(m.kcal)} ${t(lang, "unit_kcal")} (Б${num(m.protein)}/Ж${num(m.fats)}/В${num(m.carbs)})${alcTag}`;
    })
    .join("\n");
  const totAlc = meals.reduce((s, m) => s + alcoholKcalOf(m), 0);
  const totals = targets
    ? t(lang, "foodlog_totals", { tkcal: tot.kcal, goalkcal: targets.calories, tp: tot.p, goalp: targets.protein, tf: tot.f, goalf: targets.fats, tc: tot.c, goalc: targets.carbs })
    : t(lang, "foodlog_totals_notarget", { tkcal: tot.kcal, tp: tot.p, tf: tot.f, tc: tot.c });
  // "Of which alcohol" is a widely-used field on wrappers; showing it separately keeps macro
  // percentages honest (ethanol has kcal but is neither P/F/C).
  const alcLine = totAlc > 0 ? `\n${t(lang, "foodlog_alcohol_line", { kcal: totAlc })}` : "";
  const kb = new InlineKeyboard();
  meals.forEach((m, i) => kb.text(`${i + 1}. ${cleanFoodName(m.desc)}`.slice(0, 50), `food:item:${i}`).row());
  kb.text(t(lang, "food_recent_btn"), "food:recent");
  if (targets) kb.text(t(lang, "macros_suggest_btn"), "food:suggest");
  await reply(ctx, `${t(lang, "foodlog_title", { date })}\n${lines}\n\n${totals}${alcLine}\n\n${t(lang, "foodlog_hint")}`, kb);
}

// One-tap re-log of recent foods (last 21 days, deduped). Stored in session for index → item.
export async function showRecentFoods(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const foods = await getRecentFoods(ctx.db, ctx.user._id, isoDateMinus(date, 21), 12);
  if (!foods.length) { await reply(ctx, t(lang, "food_recent_none")); return; }
  ctx.user.session = { ...ctx.user.session, recentFoods: foods };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  const kb = new InlineKeyboard();
  foods.forEach((m, i) => kb.text(`➕ ${cleanFoodName(m.desc)} · ${num(m.kcal)}`.slice(0, 48), `relog:${i}`).row());
  kb.text(t(lang, "back"), "menu:nutrition");
  await reply(ctx, t(lang, "food_recent_title"), kb);
}

export async function onReLog(ctx: MyContext, index: number) {
  const item = (ctx.user.session.recentFoods ?? [])[index];
  if (!item) { await showFoodLog(ctx); return; }
  const { date } = localParts(ctx.user.profile.timezone);
  await appendMeals(ctx.db, ctx.user._id, date, [item]);
  await showFoodLog(ctx);
}

// Per-item edit submenu: change weight, change the product itself, or delete.
export async function showFoodItem(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const m = (await getDayMeals(ctx.db, ctx.user._id, date))[index];
  if (!m) { await showFoodLog(ctx); return; }
  const g = num(m.grams);
  const info = `${escapeHtml(cleanFoodName(m.desc))}${g ? ` · ${g} ${t(lang, "unit_g")}` : ""} — ${num(m.kcal)} ${t(lang, "unit_kcal")} (Б${num(m.protein)}/Ж${num(m.fats)}/В${num(m.carbs)})`;
  const kb = new InlineKeyboard()
    .text(t(lang, "food_edit_weight"), `food:wt:${index}`)
    .text(t(lang, "food_edit_product"), `food:prod:${index}`)
    .row()
    .text(t(lang, "food_delete"), `food:del:${index}`)
    .text(t(lang, "back"), "menu:nutrition");
  await reply(ctx, info, kb);
}

// Strip a trailing weight token ("~250 г" / "(250 g)") from a food desc so the grams shown stay in sync.
export function cleanFoodName(desc: string): string {
  return desc.replace(/[~(]?\s*\d+[.,]?\d*\s*(г|g|грам\w*|gram\w*)\.?\)?\s*$/iu, "").trim() || desc;
}

// Ethanol energy in a meal item, inferred from the kcal surplus over 4P + 9F + 4C. Rounded to
// the nearest 5 kcal and clamped ≥ 0. The AI prompt is instructed to include ethanol kcal in
// `kcal` while keeping protein/fats/carbs to non-alcohol parts, so this simple derivation gives
// a stable "🍷 alcohol kcal" line without a new DB column. Small residuals (< 15 kcal) are
// treated as macro-rounding noise, not alcohol — otherwise every meal would show a spurious tag.
export function alcoholKcalOf(m: { kcal?: number | string; protein?: number | string; fats?: number | string; carbs?: number | string }): number {
  const kcal = num(m.kcal);
  const p = num(m.protein);
  const f = num(m.fats);
  const c = num(m.carbs);
  const macroKcal = p * 4 + f * 9 + c * 4;
  const surplus = kcal - macroKcal;
  if (surplus < 15) return 0;
  return Math.round(surplus / 5) * 5;
}

export async function onFoodDelete(ctx: MyContext, index: number) {
  const { date } = localParts(ctx.user.profile.timezone);
  await deleteMealItem(ctx.db, ctx.user._id, date, index);
  await showFoodLog(ctx);
}

export async function onFoodEditWeight(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const item = (await getDayMeals(ctx.db, ctx.user._id, date))[index];
  if (!item) { await showFoodLog(ctx); return; }
  if (!num(item.grams)) { await reply(ctx, t(lang, "food_wt_legacy")); return; } // legacy row: no grams to scale from
  ctx.user.session = { mode: "food_wt", awaitText: String(index) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "food_wt_prompt", { name: escapeHtml(cleanFoodName(item.desc)), g: num(item.grams) }));
}

// User typed a new weight (g) for the item being edited → scale КБЖУ proportionally and re-show.
export async function handleFoodWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const idx = Number(ctx.user.session.awaitText);
  const n = parseInt(text.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 5000) { await reply(ctx, t(lang, "food_wt_invalid")); return; }
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const item = meals[idx];
  if (!item || !num(item.grams)) { await setMode(ctx, "nutrition"); await showFoodLog(ctx); return; }
  const f = n / num(item.grams);
  meals[idx] = {
    ...item,
    grams: n,
    desc: cleanFoodName(item.desc),
    kcal: Math.round(num(item.kcal) * f),
    protein: Math.round(num(item.protein) * f),
    fats: Math.round(num(item.fats) * f),
    carbs: Math.round(num(item.carbs) * f),
  };
  await setDayMeals(ctx.db, ctx.user._id, date, meals);
  await setMode(ctx, "nutrition");
  await showFoodLog(ctx);
}

export async function onFoodEditProduct(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  if (!(await getDayMeals(ctx.db, ctx.user._id, date))[index]) { await showFoodLog(ctx); return; }
  ctx.user.session = { mode: "food_prod", awaitText: String(index) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "food_prod_prompt"));
}

// User typed a replacement product (and weight) → re-estimate and swap it in for that position.
export async function handleFoodProduct(ctx: MyContext, text: string) {
  const { date } = localParts(ctx.user.profile.timezone);
  const idx = Number(ctx.user.session.awaitText);
  // Leave food_prod BEFORE deferring — a second message during the ~26 s AI run must route
  // as a normal nutrition entry, not re-enter this handler with the same idx (racing splices).
  await setMode(ctx, "nutrition");
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "nutrition", async () => {
    const est = await aiJSON<P.NutritionEstimate>(ctx.env, {
      system: P.nutritionSystem(ctx.user.lang),
      user: text,
      schema: P.NUTRITION_SCHEMA,
      temperature: 0.3,
      kind: "nutrition",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const { final } = await verifyItems(ctx, est.items);
    const meals = await getDayMeals(ctx.db, ctx.user._id, date);
    if (final.length && meals[idx]) {
      meals.splice(idx, 1, ...final); // replace that position with the re-estimated item(s)
      await setDayMeals(ctx.db, ctx.user._id, date, meals);
    }
    await showFoodLog(ctx);
  });
}

export async function cmdCoach(ctx: MyContext) {
  await setMode(ctx, "coach");
  await reply(ctx, t(ctx.user.lang, "coach_prompt"));
}

export async function cmdMeasure(ctx: MyContext) {
  await setMode(ctx, "measure");
  await reply(ctx, t(ctx.user.lang, "measure_prompt"));
}

export async function cmdSteps(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  await setMode(ctx, "steps_log");
  const { date } = localParts(ctx.user.profile.timezone);
  const logged = await getStepLog(ctx.db, ctx.user._id, date);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const target = plan?.stepsTarget;
  const status = logged
    ? t(lang, "steps_today", { steps: logged }) + " "
    : "";
  const goal = target ? t(lang, "steps_goal", { steps: target }) + " " : "";
  await reply(ctx, status + goal + t(lang, "steps_prompt"));
}

export async function handleStepsLog(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const steps = parseSteps(text);
  if (steps === undefined) {
    await reply(ctx, t(lang, "steps_unreadable"));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  await upsertStepLog(ctx.db, ctx.user._id, date, steps);
  await setMode(ctx, "idle");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const target = plan?.stepsTarget;
  let line = t(lang, "steps_saved", { steps });
  if (target) {
    const left = target - steps;
    line +=
      left > 0
        ? " " + t(lang, "steps_left", { steps: left })
        : " " + t(lang, "steps_hit");
  }
  await reply(ctx, line, menuBtn(lang));
  if (ctx.user.session.survey) await showEveningSurvey(ctx);
}

// Daily water goal in ml: ~35 ml per kg of bodyweight, rounded to 100, floored at 1500; 2500 default.
// Water goal moved to domain/challenges (waterGoalMl) — shared with the Mini App; this thin
// wrapper keeps the many ctx-based call sites unchanged.
export function waterGoalFor(ctx: MyContext): number {
  return resolveWaterGoal(ctx.user.profile);
}

export async function cmdWater(ctx: MyContext) {
  await clearEditOwner(ctx);
  await showWater(ctx);
}

export async function showWater(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const ml = (await getWater(ctx.db, ctx.user._id, date)) ?? 0;
  const goal = waterGoalFor(ctx);
  const pct = Math.min(100, Math.round((ml / goal) * 100));
  const body =
    t(lang, "water_title", { ml, goal, pct }) +
    "\n" +
    progressBar(pct) +
    (ml >= goal ? `\n\n${t(lang, "water_hit")}` : "");
  const kb = new InlineKeyboard()
    .text(t(lang, "water_add_250"), "water:add:250")
    .text(t(lang, "water_add_500"), "water:add:500")
    .text(t(lang, "water_add_750"), "water:add:750")
    .row()
    .text(t(lang, "water_reset"), "water:reset")
    .text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, body, kb);
}

export async function onWaterAction(ctx: MyContext, action: string) {
  const { date } = localParts(ctx.user.profile.timezone);
  if (action === "reset") {
    await setWater(ctx.db, ctx.user._id, date, 0);
  } else if (action.startsWith("add:")) {
    const ml = Number(action.slice("add:".length));
    if (Number.isFinite(ml) && ml > 0) await addWater(ctx.db, ctx.user._id, date, ml);
  }
  await showWater(ctx);
  if (ctx.user.session.survey) await showEveningSurvey(ctx);
}

// ===================== Challenges =====================
// challengeData/challengeTitle/cmdChallenges/showChallengePicker/onChallengeJoin moved to
// bot/challenges.ts (god-file split); re-exported below so existing `from "./bot"` imports
// (router.ts) keep working.

export async function cmdFeedback(ctx: MyContext) {
  await setMode(ctx, "feedback");
  await reply(ctx, t(ctx.user.lang, "feedback_prompt"));
}


// Reminder types the user can switch on/off (the daily/weekly nudges).
export const REMINDER_TYPES = ["workout", "nutrition", "steps", "water", "checkin", "wellbeing", "tomorrow", "measure", "digest", "plateau", "session"] as const;
export const REMINDER_LABEL: Record<string, TKey> = {
  workout: "rem_workout", nutrition: "rem_nutrition", steps: "rem_steps", water: "rem_water", checkin: "rem_checkin",
  wellbeing: "rem_wellbeing", tomorrow: "rem_tomorrow", measure: "rem_measure", digest: "rem_digest", plateau: "rem_plateau",
  session: "rem_session",
};

export async function showReminderSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  const off = new Set(ctx.user.profile.remindersOff ?? []);
  const kb = new InlineKeyboard();
  REMINDER_TYPES.forEach((key, i) => {
    const on = !off.has(key);
    kb.text(`${on ? "🔔" : "🔕"} ${t(lang, REMINDER_LABEL[key])}`, `remtog:${key}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  kb.row().text(t(lang, "back"), "menu:settings");
  await reply(ctx, t(lang, "rem_settings_title"), kb);
}

export async function onReminderToggle(ctx: MyContext, key: string) {
  if (!REMINDER_TYPES.includes(key as (typeof REMINDER_TYPES)[number])) return;
  const off = new Set(ctx.user.profile.remindersOff ?? []);
  off.has(key) ? off.delete(key) : off.add(key);
  ctx.user.profile = { ...ctx.user.profile, remindersOff: [...off] };
  await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
  await showReminderSettings(ctx);
}

// ===================== Vacation / pause mode =====================
// Moved to bot/vacation.ts (god-file split), including the comeback interview; re-exported
// below so existing `from "./bot"` imports (router.ts) keep working.

// ===================== Owner-confirmed cleanup (NEVER auto) =====================
// Moved to bot/cleanup.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

export function daysMenu(lang: Lang, selected: Weekday[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let w = 1 as Weekday; w <= 7; w++) {
    const on = selected.includes(w as Weekday);
    kb.text(`${on ? "✅ " : ""}${weekdayName(lang, w as Weekday)}`, `day:${w}`);
    if (w === 4) kb.row();
  }
  kb.row().text(t(lang, "set_days_done"), "day:done");
  return kb;
}


export async function cmdSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  const p = ctx.user.profile;
  const days = (p.trainingWeekdays ?? [])
    .map((w) => weekdayName(lang, w as Weekday))
    .join(", ") || "—";
  await reply(
    ctx,
    `${t(lang, "settings_header", {
      lang: LANG_NAME[lang],
      days,
      hour: p.reminderHour ?? 18,
      tz: p.timezone ?? "UTC",
    })}\n\n${t(lang, "settings_edit_hint")}`,
    settingsMenu(lang, !!ctx.user.competeOptIn, ctx.user.profile.sex, ctx.user.role === "client"),
  );
}

// ---------- bot records (leaderboards + badges) ----------
// Board assembly + badge rendering live in ./bot/boards (also used by the scheduler cache and
// the Mini App); bot.ts keeps only the chat command/render layer.

export async function cmdRecords(ctx: MyContext, tab: "weekly" | "hall" | "badges" | "prs" = "weekly") {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const you = ctx.user._id;
  let body: string;
  if (tab === "prs") {
    // Personal PR ledger: each tracked lift with its best result and the date it was set —
    // the "when was my last PR?" answer without a trip to /export.
    const records = await listStrength(ctx.db, you);
    if (!records.length) {
      body = t(lang, "prs_empty");
    } else {
      const sorted = [...records].sort((a, b) => prDate(b).localeCompare(prDate(a)));
      const lines = sorted.slice(0, 20).map((r) => `• <b>${escapeHtml(r.exercise)}</b> — ${formatRecordBest(r)} · ${prDate(r)}`);
      body = `${t(lang, "prs_title")}\n${lines.join("\n")}`;
    }
  } else if (tab === "badges") {
    body = renderBadges(lang, await listAchievements(ctx.db, you));
  } else if (tab === "hall") {
    const b = await computeBoards(ctx.db, ctx.user.profile.timezone);
    body = [
      renderBoard(lang, t(lang, "board_relative"), b.relative, you, (v) => `${v.toFixed(2)}× ${t(lang, "unit_bw")}`, true),
      "",
      renderBoard(lang, t(lang, "board_total"), b.total, you, (v) => `${v} 🏋️`),
    ].join("\n");
  } else {
    const b = await computeBoards(ctx.db, ctx.user.profile.timezone);
    const today = localParts(ctx.user.profile.timezone).date;
    const myDates = (await workoutLogsSince(ctx.db, you, isoDateMinus(today, 120)))
      .filter((l) => l.completed)
      .map((l) => l.date);
    const streak = weekStreak(myDates, today, ctx.user.reminders?.lastVacation);
    body = [
      renderBoard(lang, t(lang, "board_consistency"), b.consistency, you, (v) => `${v} 🏋️`),
      "",
      renderBoard(lang, t(lang, "board_improved"), b.improved, you, (v) => `+${v.toFixed(1)}%`, true),
      "",
      t(lang, "your_streak", { weeks: streak }),
    ].join("\n");
  }
  const note = ctx.user.competeOptIn ? "" : `\n\n${t(lang, "records_optin_hint")}`;
  await reply(ctx, `${t(lang, "records_title")}\n\n${body}${note}`, recordsTabs(lang, !!ctx.user.competeOptIn));
}

// Toggle leaderboard participation.
export async function toggleCompete(ctx: MyContext) {
  const next = !ctx.user.competeOptIn;
  await updateUser(ctx.db, ctx.user._id, { competeOptIn: next });
  ctx.user.competeOptIn = next;
  await reply(ctx, t(ctx.user.lang, next ? "compete_on" : "compete_off"));
  await cmdRecords(ctx);
}


export async function setAlias(ctx: MyContext, value: string) {
  await updateUser(ctx.db, ctx.user._id, { alias: value });
  ctx.user.alias = value;
  await setMode(ctx, "idle");
  await reply(ctx, t(ctx.user.lang, "alias_saved"));
  await cmdRecords(ctx);
}

export async function handleAliasInput(ctx: MyContext, text: string) {
  await setAlias(ctx, text.trim().slice(0, 24));
}

export async function cmdLang(ctx: MyContext) {
  // Three languages now → show the picker instead of a two-way toggle.
  await reply(ctx, t(ctx.user.lang, "choose_language"), langMenu());
}

export async function updateProfile(ctx: MyContext, patch: Partial<UserDoc["profile"]>) {
  const profile = { ...ctx.user.profile, ...patch };
  await updateUser(ctx.db, ctx.user._id, { profile });
  ctx.user.profile = profile;
}

export async function openSetting(ctx: MyContext, which: string) {
  const lang = ctx.user.lang;
  if (which === "hour") await reply(ctx, t(lang, "set_hour_prompt"), hourMenu());
  else if (which === "days")
    await reply(ctx, t(lang, "set_days_prompt"), daysMenu(lang, ctx.user.profile.trainingWeekdays ?? []));
  else if (which === "tz") await reply(ctx, t(lang, "set_tz_prompt"), tzMenu());
  else if (which === "lang") await reply(ctx, t(lang, "choose_language"), langMenu());
  else if (which === "body") {
    await setMode(ctx, "body_edit");
    const p = ctx.user.profile;
    const cur = p.heightCm && p.weightKg ? `${p.heightCm} ${p.weightKg}` : "180 80";
    await reply(ctx, t(lang, "set_body_prompt", { cur }));
  }
  else if (which === "goalweight") {
    await setMode(ctx, "goal_weight");
    const cur = ctx.user.profile.goalWeight ?? ctx.user.profile.weightKg ?? 75;
    await reply(ctx, t(lang, "set_goalweight_prompt", { cur }));
  }
  else if (which === "injury") await showInjuryMenu(ctx);
  else if (which === "replan") await cmdReplan(ctx);
}

// Set the target bodyweight (drives the projection on the progress screen).
export async function handleGoalWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const w = parseFloat(text.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(w) || w < 30 || w > 300) { await reply(ctx, t(lang, "set_goalweight_invalid")); return; }
  await updateProfile(ctx, { goalWeight: Math.round(w * 10) / 10 });
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "set_goalweight_saved", { w: Math.round(w * 10) / 10 }), menuBtn(lang));
}

// ===================== Injury / pain tracking =====================
// Moved to bot/injury.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

// ============ Menstrual-cycle tracking (opt-in, female profiles) ============
// Moved to bot/cycle.ts (god-file split); re-exported below so existing `from "./bot"` imports
// (router.ts) keep working.

// ============ Sharing with trainer (client-owned consent toggles) ============
// Moved to bot/shareConsent.ts (god-file split); re-exported below.

// ===================== Calendar & session booking =====================
// Moved to bot/calendar.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, bot/trainer.ts) keep working.

// Edit body height+weight from settings. Reuses the onboarding realism check + auto-swap.
export async function handleBodyEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const hw = parseHeightWeight(text);
  if (!hw) {
    await reply(ctx, t(lang, "ob_hw_unrealistic"));
    return;
  }
  await updateProfile(ctx, { heightCm: hw.heightCm, weightKg: hw.weightKg });
  await setMode(ctx, "idle");
  // Recalculate nutrition targets whenever weight/height change — macros (protein, fats) are
  // expressed per-kg, so stale targets quickly diverge from reality. We pass undefined for
  // planNutrition to force a formula-based recalculation (Mifflin-St-Jeor + activity + goal)
  // rather than just returning the unchanged plan values.
  const freshNutrition = computeTargets(ctx.user.profile, undefined);
  // Preserve the text notes from the AI-authored plan (e.g. "calculated for recomposition…").
  const existingNotes = ctx.user.nutrition?.notes;
  await updateUser(ctx.db, ctx.user._id, {
    nutrition: { ...freshNutrition, ...(existingNotes ? { notes: existingNotes } : {}) },
  });
  await reply(ctx, t(lang, "body_saved", { h: String(hw.heightCm), w: String(hw.weightKg) }));
  await cmdSettings(ctx);
}

export async function onSetHour(ctx: MyContext, hour: number) {
  if (Number.isFinite(hour)) await updateProfile(ctx, { reminderHour: hour });
  await reply(ctx, t(ctx.user.lang, "settings_saved"));
  await cmdSettings(ctx);
}

// Reply to the scheduler's smart reminder-timing offer: "yes:<h>" applies the hour, "no" keeps it.
export async function onSmartHour(ctx: MyContext, action: string) {
  const lang = ctx.user.lang;
  const [verb, hStr] = action.split(":");
  const h = Number(hStr);
  if (verb === "yes" && Number.isInteger(h) && h >= 0 && h <= 23) {
    await updateProfile(ctx, { reminderHour: h });
    await reply(ctx, t(lang, "smart_hour_set", { h }), menuBtn(lang));
  } else {
    await reply(ctx, t(lang, "smart_hour_kept"), menuBtn(lang));
  }
}

export async function onSetTz(ctx: MyContext, tz: string) {
  if (tz) await updateProfile(ctx, { timezone: tz });
  await reply(ctx, t(ctx.user.lang, "settings_saved"));
  await cmdSettings(ctx);
}

export async function onToggleDay(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (arg === "done") {
    await reply(ctx, t(lang, "settings_saved"));
    await cmdSettings(ctx);
    return;
  }
  const w = Number(arg) as Weekday;
  const cur = new Set(ctx.user.profile.trainingWeekdays ?? []);
  if (cur.has(w)) cur.delete(w);
  else cur.add(w);
  const arr = [...cur].sort((a, b) => a - b) as Weekday[];
  await updateProfile(ctx, { trainingWeekdays: arr });
  await ctx.editMessageReplyMarkup({ reply_markup: daysMenu(lang, arr) }).catch(() => {});
}

// ---------------- onboarding & plan generation ----------------

// Onboarding wizard lives in ./bot/onboarding (extracted); TKey stays here — it's used
// across the whole file.
export type TKey = Parameters<typeof t>[1]; // keyof the locale dictionary





















// onLevelUp, onGoalMaintain, resumePendingPlan, saveBaselineBody moved to bot/planGen.ts
// (god-file split); re-exported below so existing `from "./bot"` imports keep working.

// ---------------- nutrition ----------------
// Moved to bot/nutritionLog.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

// ---------------- coach / logging / measurements / feedback ----------------
// coach* moved to bot/coach.ts, workout-log/save moved to bot/workoutSave.ts, feedback moved
// to bot/feedbackIntake.ts (god-file split); re-exported below. handleMeasure (the only
// "measurements" function — too small on its own for a new file) stayed here.

export async function handleMeasure(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { weight, measurements } = parseMeasurements(text);
  if (weight === undefined && Object.keys(measurements).length === 0) {
    await reply(ctx, t(lang, "measure_none"));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  await upsertBodyLog(ctx.db, ctx.user._id, date, {
    ...(weight !== undefined ? { weight } : {}),
    ...(Object.keys(measurements).length ? { measurements } : {}),
  });
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "measure_saved"), menuBtn(lang));
}

// ---------------- user report ----------------
// Moved to bot/report.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, bot/trainer.ts) keep working.

// ---------------- replan / delete / export ----------------
// Moved to bot/exportData.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, webapp/settingsApi.ts) keep working.


// ---------------- bot factory ----------------
