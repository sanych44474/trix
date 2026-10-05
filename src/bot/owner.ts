// Owner / admin section — extracted verbatim from src/bot.ts (mechanical split).

import { broadcastRelease, pendingReleaseRecipients } from "./releaseBroadcast";
import { InlineKeyboard } from "grammy";
import { logInfo } from "../log";
import type { Lang, UserDoc, UserProfile, Weekday } from "../types";
import { deleteUserData } from "../adapters/d1/v2Account";
import { engagementSince, errorStatsSince, getOwnerChatId, listUsersBrief, recentEventsForUser, recordAudit, setOwnerChatId } from "../adapters/d1/v2Admin";
import { listStrength } from "../adapters/d1/v2Workouts";
import { assignDraftPlan, getActivePlan, getDraftPlan, setActivePlan } from "../adapters/d1/v2Plans";
import { getTrainer, updateTrainer } from "../adapters/d1/v2Trainer";
import { countActiveSince, getUser, listOnboardedUsers, stampOnboardedAt, updateUser } from "../adapters/d1/v2Users";
import { formatRecordBest } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { latestRelease, releaseBody } from "../releaseNotes";
import { chunkReport, renderPlan } from "../render";
import { aiJSON } from "../ai/index";
import * as P from "../ai/prompts";
import { ownerHubMenu } from "./keyboards";
import { type MyContext, HTML, clearEditOwner, reply, setMode } from "../adapters/telegram/context";
import { buildPlanDoc, deferAi, mainMenu, menuBtn } from "../bot";
import { showPlanEditPicker, showPlanEditDay } from "../features/trainer/trainer";
import { monoTable, ownerReportWindows, orOverview, orEngagement, orRetention, orAI, orTrainers, orOnboarding, orErrors, orUsers, buildOwnerReport } from "./ownerReport";
export * from "./ownerVideos";
export * from "./ownerReport";


// ---------------- owner / admin ----------------

export async function cmdAdmin(ctx: MyContext, secret: string) {
  const lang = ctx.user.lang;
  if (!ctx.env.ADMIN_SECRET || !secret || secret !== ctx.env.ADMIN_SECRET) {
    await reply(ctx, t(lang, "admin_bad"));
    return;
  }
  // Lock owner after first claim (only the same chat may re-affirm).
  const existing = await getOwnerChatId(ctx.db);
  if (existing && existing !== ctx.user.chatId) {
    await reply(ctx, t(lang, "admin_taken"));
    return;
  }
  await setOwnerChatId(ctx.db, ctx.user.chatId);
  await reply(ctx, t(lang, "admin_claimed"));
}

export async function isOwner(ctx: MyContext): Promise<boolean> {
  const ownerChatId = await getOwnerChatId(ctx.db);
  return !!ownerChatId && ownerChatId === ctx.user.chatId;
}

// Owner report is split into section buttons for compactness — the command shows the hub.
export function ownerReportHub(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "or_sec_overview"), "orep:overview")
    .text(t(lang, "or_sec_ai"), "orep:ai")
    .row()
    .text(t(lang, "or_sec_trainers"), "orep:trainers")
    .text(t(lang, "or_sec_onboarding"), "orep:onboarding")
    .row()
    .text(t(lang, "or_sec_errors"), "orep:errors")
    .text(t(lang, "or_sec_events"), "orep:events")
    .row()
    .text(t(lang, "or_sec_users"), "orep:users")
    .text(t(lang, "or_sec_retention"), "orep:retention")
    .row()
    .text(t(lang, "or_sec_full"), "orep:full");
}

export async function cmdOwnerReport(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  // One-line 7d pulse above the section buttons — often that's all the owner needs.
  const { since7Iso } = ownerReportWindows();
  const pulse = await Promise.all([
    countActiveSince(ctx.db, since7Iso).catch(() => 0),
    engagementSince(ctx.db, since7Iso.slice(0, 10)).catch(() => ({ workouts: 0, completed: 0, checkins: 0, nutrition: 0 })),
    errorStatsSince(ctx.db, since7Iso).catch(() => [] as { n: number }[]),
  ]).then(([active7, eng, errs]) => {
    const errN = errs.reduce((s, e) => s + e.n, 0);
    return `⚡ 7d: <b>${active7}</b> active · <b>${eng.workouts}</b> workouts · ${errN ? `🐞 <b>${errN}</b> errors` : "✅ no errors"}`;
  }).catch(() => "");
  await ctx.reply(`${t(lang, "or_menu_title")}${pulse ? `\n${pulse}` : ""}`, { ...HTML, reply_markup: ownerReportHub(lang) });
}

export async function sendOwnerSection(ctx: MyContext, section: string) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  let text: string;
  if (section === "overview") text = await orOverview(ctx.db);
  else if (section === "ai") text = await orAI(ctx.db, ctx.env);
  else if (section === "trainers") text = await orTrainers(ctx.db);
  else if (section === "onboarding") text = await orOnboarding(ctx.db);
  else if (section === "errors") text = await orErrors(ctx.db);
  else if (section === "events") text = await orEngagement(ctx.db);
  else if (section === "users") text = await orUsers(ctx.db);
  else if (section === "retention") text = await orRetention(ctx.db);
  else text = await buildOwnerReport(ctx.db, ctx.env); // "full"
  const back = new InlineKeyboard().text(t(lang, "or_back"), "menu:ownerreport");
  const chunks = chunkReport(text);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await ctx.reply(chunks[i], last ? { ...HTML, reply_markup: back } : HTML).catch((e) => console.error("ownerreport send", e));
  }
}

// Owner: start a broadcast — the next message is sent to every onboarded, reachable user.
export async function cmdAnnounce(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  await setMode(ctx, "announce");
  await reply(ctx, t(lang, "announce_prompt"));
}

// Owner broadcast: send the text to all onboarded users (skipping banned / bot-blocked), sequentially
// to respect Telegram limits. Reports how many delivered/failed and writes an audit entry.
export async function handleAnnounce(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await setMode(ctx, "idle"); return; }
  await setMode(ctx, "idle");
  const body = text.trim();
  if (!body) { await reply(ctx, t(lang, "announce_empty"), menuBtn(lang)); return; }
  const recipients = (await listOnboardedUsers(ctx.db)).filter((u) => !u.blocked && !u.botBlocked);
  let ok = 0;
  let fail = 0;
  for (const u of recipients) {
    try {
      await ctx.api.sendMessage(u.chatId, `📢 ${escapeHtml(body)}`, HTML);
      ok++;
    } catch {
      fail++;
    }
  }
  await recordAudit(ctx.db, ctx.user._id, "broadcast", undefined, `${ok}/${recipients.length}: ${body.slice(0, 80)}`);
  await reply(ctx, t(lang, "announce_done", { ok, total: recipients.length, fail }), menuBtn(lang));
}

// "What's new" / release notes. Any user can read the latest in their own language; the owner
// additionally gets a button to broadcast it to everyone (each in their language) behind a confirm.
export async function cmdWhatsNew(ctx: MyContext) {
  const lang = ctx.user.lang;
  const note = latestRelease();
  const header = `<b>${t(lang, "whatsnew_tag", { version: note.version })}</b>\n\n`;
  let kb = menuBtn(lang);
  if (await isOwner(ctx)) {
    const n = await pendingReleaseRecipients(ctx.env);
    kb = new InlineKeyboard().text(t(lang, "whatsnew_send_btn", { n }), "wn:ask").row().text(t(lang, "menu_open"), "menu:open");
  }
  await reply(ctx, header + releaseBody(lang, note), kb);
}

// Owner approval gate — confirm before broadcasting the release notes to all users.
export async function showWhatsNewConfirm(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const note = latestRelease();
  const n = await pendingReleaseRecipients(ctx.env);
  const kb = new InlineKeyboard()
    .text(t(lang, "whatsnew_confirm_btn"), "wn:send")
    .text(t(lang, "whatsnew_cancel"), "menu:open");
  await reply(ctx, t(lang, "whatsnew_confirm", { n, version: note.version }), kb);
}

// Owner-approved broadcast: send the latest release notes to every onboarded, reachable user in
// THEIR language. Sequential to respect Telegram limits; reports delivered/failed; audited.
export async function onWhatsNewSend(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const pending = await pendingReleaseRecipients(ctx.env);
  await reply(ctx, t(lang, "whatsnew_sending", { n: pending }));
  // Resumable: whoever already got this version (from here or the Mini App console) is skipped.
  const result = await broadcastRelease(ctx.env, ctx.user._id, pending);
  await reply(ctx, t(lang, "announce_done", { ok: result.sent, total: pending, fail: result.failed }), menuBtn(lang));
}

// Owner: list users (most recently active first) → per-user admin card.
export async function cmdUsers(ctx: MyContext) {
  const lang = ctx.user.lang;
  await clearEditOwner(ctx);
  if (!(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  const users = await listUsersBrief(ctx.db, 30);
  const kb = new InlineKeyboard();
  for (const u of users) {
    const nick = u.username ? ` @${u.username}` : "";
    const blocked = u.blocked || u.botBlocked ? " 🚫" : "";
    const pending = u.onboarded ? "" : " ⏳";
    kb.text(`${u.name || `id ${u.id}`}${nick}${blocked}${pending}`.slice(0, 60), `ou:${u.id}:card`).row();
  }
  await reply(ctx, t(lang, "owner_users_header", { n: users.length }), kb);
}

export function ownerUserKb(lang: Lang, id: number, confirmDelete = false, blocked = false, instructor?: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_plan"), `ou:${id}:plan`)
    .text(t(lang, "owner_regen"), `ou:${id}:regen`)
    .row()
    .text(t(lang, "cc_assign"), `ou:${id}:assign`)
    .text(t(lang, "cc_edit"), `ou:${id}:edit`)
    .row()
    .text(t(lang, "owner_interview_resume"), `ou:${id}:resume`)
    .text(t(lang, "owner_interview_restart"), `ou:${id}:reint`)
    .row()
    .text(t(lang, "owner_events"), `ou:${id}:events`)
    .row();
  // Trainer-only: grant/revoke the instructor capability (share-program powers).
  if (instructor !== undefined) {
    kb.text(t(lang, instructor ? "owner_instr_off" : "owner_instr_on"), `ou:${id}:instr`).row();
  }
  kb
    .text(t(lang, blocked ? "owner_unblock" : "owner_block"), `ou:${id}:${blocked ? "unblock" : "block"}`)
    .row();
  if (confirmDelete) kb.text(t(lang, "owner_delete_confirm"), `ou:${id}:delok`).text(t(lang, "owner_delete_cancel"), `ou:${id}:card`);
  else kb.text(t(lang, "owner_delete"), `ou:${id}:del`);
  return kb;
}

// Run one interview step for an ARBITRARY target user and deliver the question to THEIR chat.
// `restart` clears the transcript (ask from the first question); otherwise it resumes and
// re-sends the next/current question. Used to unstick users whose interview froze.
export async function sendInterviewTo(ctx: MyContext, target: UserDoc, restart: boolean): Promise<boolean> {
  const lang = target.lang;
  const transcript = restart ? [] : (target.session.transcript ?? []);
  try {
    const result = await aiJSON<P.InterviewResult>(ctx.env, {
      system: P.interviewSystem(lang),
      user: P.interviewUser(transcript, target.profile.name),
      schema: P.INTERVIEW_SCHEMA,
      temperature: 0.6,
      kind: "interview",
      db: ctx.db,
      userId: target._id,
    });
    transcript.push({ role: "assistant", text: result.message });
    await updateUser(ctx.db, target._id, {
      profile: { ...target.profile, ...result.profile },
      session: { mode: "onboarding", transcript },
    });
    await ctx.api.sendMessage(target.chatId, escapeHtml(result.message), HTML);
    return true;
  } catch (err) {
    console.error("sendInterviewTo failed", target._id, err);
    return false;
  }
}

// Owner: act on ANY user's plan/account. `ou:<userId>:<action>[:<arg>]`.
export async function ownerUserAction(ctx: MyContext, userId: number, action: string, arg?: string) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  const target = await getUser(ctx.db, userId);
  if (!target) { await reply(ctx, t(lang, "client_not_found")); return; }
  const uname = escapeHtml(target.profile.name ?? `id ${userId}`);
  if (action === "card") {
    await clearEditOwner(ctx);
    const info = t(lang, "owner_user_card", {
      name: uname,
      role: target.role,
      status: target.onboarded ? "✅" : "⏳",
      mode: target.session.mode,
    });
    let blockedLine = "";
    if (target.blocked) blockedLine = "\n" + t(lang, "owner_user_blocked");
    else if (target.botBlocked) blockedLine = "\n" + t(lang, "owner_bot_blocked");
    // Show the instructor toggle only for trainers.
    const instr = target.role === "trainer" ? !!(await getTrainer(ctx.db, userId))?.isInstructor : undefined;
    if (instr) blockedLine += "\n" + t(lang, "owner_is_instructor");
    await reply(ctx, info + blockedLine, ownerUserKb(lang, userId, false, !!target.blocked, instr));
  } else if (action === "instr") {
    const tr = await getTrainer(ctx.db, userId);
    if (!tr) { await reply(ctx, t(lang, "client_not_found")); return; }
    await updateTrainer(ctx.db, userId, { isInstructor: !tr.isInstructor });
    await recordAudit(ctx.db, ctx.user._id, tr.isInstructor ? "instructor_off" : "instructor_on", userId).catch(() => {});
    await reply(ctx, t(lang, tr.isInstructor ? "owner_instr_revoked" : "owner_instr_granted", { name: uname }));
    // Notify the trainer they gained/lost the capability.
    await ctx.api.sendMessage(target.chatId, t(target.lang, tr.isInstructor ? "instr_revoked_you" : "instr_granted_you"), HTML).catch(() => {});
    await ownerUserAction(ctx, userId, "card");
  } else if (action === "block" || action === "unblock") {
    const blocked = action === "block";
    // Unblock also clears the auto bot-blocked flag so the scheduler resumes serving them.
    await updateUser(ctx.db, userId, blocked ? { blocked: true } : { blocked: false, botBlocked: false });
    await reply(ctx, t(lang, blocked ? "owner_blocked_done" : "owner_unblocked_done", { name: uname }), ownerUserKb(lang, userId, false, blocked));
  } else if (action === "plan") {
    const plan = (await getActivePlan(ctx.db, userId)) ?? (await getDraftPlan(ctx.db, userId));
    // The no-plan case must point at the OWNER's button (♻️ Regenerate plan) and re-attach the
    // card keyboard — client_no_plan_trainer names "Generate draft", which only exists on the
    // trainer card, and a bare reply drops the buttons entirely.
    await reply(
      ctx,
      plan ? renderPlan(lang, plan) : t(lang, "owner_no_plan", { name: uname }),
      plan ? undefined : ownerUserKb(lang, userId, false, !!target.blocked),
    );
  } else if (action === "regen") {
    // Generate (or regenerate) the user's plan with AI + unstick a pending session.
    await reply(ctx, t(lang, "owner_regen_run", { name: uname }));
    await ctx.replyWithChatAction("typing").catch(() => {});
    // Deferred — same reason as the trainer draft: the full build outlives the webhook window.
    deferAi(ctx, "owner_regen", async () => {
      const records = await listStrength(ctx.db, userId, 8);
      const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
      const plan = await buildPlanDoc(ctx, target.lang, target.profile, userId, { prs });
      await setActivePlan(ctx.db, plan);
      if (!target.onboarded) {
        logInfo("onboarding_completed", { role: target.role });
        logInfo("first_plan_ready", { source: "ai" });
        await stampOnboardedAt(ctx.db, userId).catch(() => {});
      }
      await updateUser(ctx.db, userId, { onboarded: true, nutrition: plan.nutrition, session: { mode: "idle" } });
      await reply(ctx, t(lang, "owner_regen_done", { name: uname }), ownerUserKb(lang, userId, false, !!target.blocked));
      await ctx.api.sendMessage(target.chatId, t(target.lang, "plan_ready"), { ...HTML, reply_markup: mainMenu(target.lang) }).catch(() => {});
    });
  } else if (action === "assign") {
    const ok = await assignDraftPlan(ctx.db, userId);
    if (ok) await recordAudit(ctx.db, ctx.user._id, "assign_plan", userId);
    await reply(ctx, t(lang, ok ? "owner_assign_done" : "no_draft", { name: uname }), ownerUserKb(lang, userId, false, !!target.blocked));
    if (ok) await ctx.api.sendMessage(target.chatId, t(target.lang, "plan_ready"), { ...HTML, reply_markup: mainMenu(target.lang) }).catch(() => {});
  } else if (action === "edit") {
    await showPlanEditPicker(ctx, userId, "ou", uname);
  } else if (action === "eday") {
    await showPlanEditDay(ctx, userId, "ou", Number(arg) as Weekday);
  } else if (action === "editdone") {
    await clearEditOwner(ctx);
    await reply(ctx, t(lang, "owner_user_card", { name: uname, role: target.role, status: target.onboarded ? "✅" : "⏳", mode: target.session.mode }), ownerUserKb(lang, userId, false, !!target.blocked));
  } else if (action === "resume" || action === "reint") {
    const restart = action === "reint";
    const ok = await sendInterviewTo(ctx, target, restart);
    await reply(
      ctx,
      t(lang, ok ? "owner_interview_sent" : "error_generic", { name: uname }),
      ownerUserKb(lang, userId, false, !!target.blocked),
    );
  } else if (action === "events") {
    // Per-user usage timeline: recent event counters + last-seen + current session mode.
    const events = await recentEventsForUser(ctx.db, userId, 30);
    const seen = target.lastSeenAt ? target.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : "—";
    const head = t(lang, "owner_events_head", { name: uname, seen, mode: target.session.mode });
    const body = events.length
      ? monoTable(["Day", "Event", "n"], events.map((e) => [e.day.slice(5), e.event, e.n]))
      : t(lang, "owner_events_none");
    await reply(ctx, `${head}\n${body}`, ownerUserKb(lang, userId, false, !!target.blocked));
  } else if (action === "del") {
    await reply(ctx, t(lang, "owner_delete_ask", { name: uname }), ownerUserKb(lang, userId, true, !!target.blocked));
  } else if (action === "delok") {
    await deleteUserData(ctx.env, userId);
    await reply(ctx, t(lang, "owner_deleted", { name: uname }), menuBtn(lang));
  }
}

// Intake essentials the interview must collect — used to show onboarding progress (X/N) in the
// owner report. Keep in sync with the "essentials" list in P.interviewSystem.
export const INTAKE_ESSENTIALS: (keyof UserProfile)[] = [
  "name", "weightKg", "heightCm", "age", "sex", "goal", "trainingHistory",
  "daysPerWeek", "trainingWeekdays", "equipment", "sleepSchedule", "lifestyle",
  "limitations", "dietPrefs", "favoriteExercises", "dislikedExercises", "timezone", "reminderHour",
];

// How many intake essentials are filled out of the total (waist counts as the measurements gate).
export function interviewProgress(profile: UserProfile): { filled: number; total: number } {
  let filled = 0;
  for (const k of INTAKE_ESSENTIALS) {
    const v = profile[k];
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "") filled++;
  }
  if (profile.measurements?.waist !== undefined) filled++;
  return { filled, total: INTAKE_ESSENTIALS.length + 1 };
}

// 👤 Users: full roster table (most-active first) + recent feedback.
// Structured user rows for the Mini App owner console — the same data as the text report, but
// as JSON so the app can render an interactive (sortable / groupable) table.
export interface OwnerUserRow {
  id: number; name: string; nick: string; trainer: string;
  status: "banned" | "blocked" | "onboarding" | "active" | "draft" | "none";
  onb: string; w: number; c: number; n: number; s: number; last: string; total: number;
  lastSeen?: string; // full ISO timestamp of the last interaction (absent = never seen)
}
export async function showOwnerHub(ctx: MyContext) {
  if (!(await isOwner(ctx))) return;
  await reply(ctx, t(ctx.user.lang, "owner_hub_title"), ownerHubMenu(ctx.user.lang));
}
