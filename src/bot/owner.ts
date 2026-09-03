// Owner / admin section — extracted verbatim from src/bot.ts (mechanical split).

import { GrammyError, InlineKeyboard } from "grammy";
import type { Env, Lang, UserDoc, UserProfile, Weekday } from "../types";
import {
  aiCallStatsSince, aiUsageSince, assignDraftPlan, countActiveSince, countAdjustmentsSince,
  countByRole, countClientsOf, countCompletedWorkoutsBetween, countInactive, countModeration,
  countOnboarded, countPendingClientRequests, countPlanSourcesSince, countUsers,
  countUsersCreatedSince, dailyActiveUsers, deleteUserData, deleteUserVideo, engagementSince, errorStatsSince,
  eventCountsByUser, eventStatsSince, getActivePlan, getDraftPlan, getExerciseVideo,
  getOwnerChatId, getUser, listAllCatalogNames, listChurnedUsers, listOnboardedUsers,
  listOnboardingUsers, listPlanPendingUsers, listStrength, listTrainerUsers, listUsersBrief,
  nonOnboardedByMode, pendingRequestsAll, pendingTrainerApplications, planStatusByUser,
  getTrainer, updateTrainer,
  recentAudit, recentErrors, recentEventsForUser, recentFeedback, recordAudit, setActivePlan,
  setManualVideo, setOwnerChatId, setUserVideo, updateUser, upsertExerciseVideo,
} from "../db/repos";
import { formatRecordBest, getPlanDay } from "../domain/progression";
import { weekStartStr } from "../domain/records";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { latestRelease, releaseBody } from "../releaseNotes";
import { chunkReport, renderPlan, weekdayName } from "../render";
import { splitKeys } from "../ai/errors";
import { aiJSON } from "../ai/index";
import * as P from "../ai/prompts";
import { YouTubeQuotaError, normalizeVideoKey, parseYouTubeId, searchExerciseVideo } from "../youtube";
import {
  type MyContext, HTML, buildPlanDoc, clearEditOwner, deferAi, mainMenu, menuBtn,
  obSteps, planOwnerId, reply, setMode,
} from "../bot";
import { showPlanEditPicker, showPlanEditDay } from "./trainer";


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
  else text = await buildOwnerReport(ctx.db, ctx.env); // "full"
  const back = new InlineKeyboard().text(t(lang, "or_back"), "menu:ownerreport");
  const chunks = chunkReport(text);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await ctx.reply(chunks[i], last ? { ...HTML, reply_markup: back } : HTML).catch((e) => console.error("ownerreport send", e));
  }
}

// Owner: force re-fetch the technique video for every catalog exercise. Locked manual overrides
// are skipped (no quota spent on them). Stops gracefully when the daily YouTube quota is hit and
// reports partial progress — already-stored results are kept.
export async function cmdRefreshVideos(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  if (!ctx.env.YOUTUBE_API_KEY) {
    await reply(ctx, t(lang, "refreshvideos_no_key"));
    return;
  }
  await reply(ctx, t(lang, "refreshvideos_start"));
  const names = await listAllCatalogNames(ctx.db);
  let done = 0;
  let updated = 0;
  let skippedLocked = 0;
  let quotaHit = false;
  for (const name of names) {
    const key = normalizeVideoKey(name);
    const existing = await getExerciseVideo(ctx.db, key).catch(() => undefined);
    if (existing?.locked) {
      skippedLocked++;
      continue;
    }
    try {
      const best = await searchExerciseVideo(ctx.env, name);
      await upsertExerciseVideo(
        ctx.db,
        best
          ? { normalizedName: key, exerciseName: name, videoId: best.videoId, url: best.url, title: best.title, channelName: best.channelName, thumbnailUrl: best.thumbnailUrl, locked: false }
          : { normalizedName: key, exerciseName: name, videoId: null, url: null, title: null, channelName: null, thumbnailUrl: null, locked: false },
      );
      done++;
      if (best) updated++;
    } catch (err) {
      if (err instanceof YouTubeQuotaError) {
        quotaHit = true;
        break;
      }
      // Other transient error — skip this exercise and continue.
    }
  }
  await reply(
    ctx,
    t(lang, quotaHit ? "refreshvideos_quota" : "refreshvideos_done", {
      done,
      updated,
      skipped: skippedLocked,
      total: names.length,
    }),
  );
}

// Trainer or owner: manually replace the technique video for an exercise. The override is locked
// so /refreshvideos and the background backfill never overwrite it.
// Usage: /setvideo <exercise name> | <youtube url>
export async function cmdSetVideo(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (ctx.user.role !== "trainer" && !(await isOwner(ctx))) {
    await reply(ctx, t(lang, "admin_only"));
    return;
  }
  const sep = arg.lastIndexOf("|");
  if (sep < 0) {
    await reply(ctx, t(lang, "setvideo_usage"));
    return;
  }
  const name = arg.slice(0, sep).trim();
  const url = arg.slice(sep + 1).trim();
  if (!name || !url) {
    await reply(ctx, t(lang, "setvideo_usage"));
    return;
  }
  const id = parseYouTubeId(url);
  if (!id) {
    await reply(ctx, t(lang, "setvideo_bad_url"));
    return;
  }
  const key = normalizeVideoKey(name);
  await setManualVideo(ctx.db, key, name, { videoId: id, url: `https://www.youtube.com/shorts/${id}` }, ctx.user.chatId);
  await reply(ctx, t(lang, "setvideo_done", { name }));
}

// 🎥 Відео: button flow to set an exercise's technique-video link. A regular user sets a personal
// override (only they see it); a trainer/owner sets the shared/global video. `weekday` 0 = pick
// across the whole plan (user view); a specific weekday = that day only (trainer day-edit).
export async function startVideoPick(ctx: MyContext, weekday: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) { await reply(ctx, t(lang, "no_plan"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  let count = 0;
  for (const day of plan.split) {
    if (weekday && day.weekday !== weekday) continue;
    day.exercises.forEach((ex, idx) => {
      const prefix = weekday ? "" : `${weekdayName(lang, day.weekday).slice(0, 2)}: `;
      kb.text(`${prefix}${cleanAi(ex.name)}`.slice(0, 60), `vid:set:${day.weekday}:${idx}`).row();
      count++;
    });
  }
  if (!count) { await reply(ctx, t(lang, "no_plan"), menuBtn(lang)); return; }
  await reply(ctx, t(lang, "video_pick"), kb);
}

export async function startVideoSet(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const ex = plan ? getPlanDay(plan, weekday)?.exercises[index] : undefined;
  if (!ex) { await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  // Only the OWNER sets a GLOBAL locked video (seen by everyone). A trainer changing a video
  // writes a per-CLIENT override (planOwnerId = the client whose plan is being edited, or self)
  // — so only that client sees the trainer's pick; everyone else falls back to YouTube search.
  const scope: "user" | "global" = (await isOwner(ctx)) ? "global" : "user";
  const target = scope === "global" ? ctx.user._id : planOwnerId(ctx);
  const key = normalizeVideoKey(ex.canonicalName || ex.name);
  const session: UserDoc["session"] = {
    ...ctx.user.session,
    mode: "video_url",
    pendingVideo: { key, name: cleanAi(ex.name), scope, ownerId: target },
  };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "video_ask", { name: cleanAi(ex.name) }));
}

export async function handleVideoUrl(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const pv = ctx.user.session.pendingVideo;
  if (!pv) { await setMode(ctx, "idle"); await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  const trimmed = text.trim();
  // Reset → drop a personal override (reverts to the shared video). Global reset isn't offered here.
  if (/^(?:-|—|reset|скинути|видалити|прибрати|default)$/i.test(trimmed)) {
    // pv.ownerId is the override's target (the client, or self) — revert THAT user's override.
    if (pv.scope === "user") await deleteUserVideo(ctx.db, pv.ownerId, pv.key);
    await setMode(ctx, "idle");
    await reply(ctx, t(lang, "video_reset", { name: pv.name }), menuBtn(lang));
    return;
  }
  const id = parseYouTubeId(trimmed);
  if (!id) { await reply(ctx, t(lang, "setvideo_bad_url")); return; } // stay in mode, let them retry
  const url = `https://youtu.be/${id}`;
  if (pv.scope === "global") {
    await setManualVideo(ctx.db, pv.key, pv.name, { videoId: id, url }, ctx.user.chatId);
  } else {
    // Per-user override on the target (a trainer's pick lands only on their client's account).
    await setUserVideo(ctx.db, pv.ownerId, pv.key, pv.name, { videoId: id, url });
  }
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "video_saved", { name: pv.name }), menuBtn(lang));
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
    const n = (await listOnboardedUsers(ctx.db)).filter((u) => !u.blocked && !u.botBlocked).length;
    kb = new InlineKeyboard().text(t(lang, "whatsnew_send_btn", { n }), "wn:ask").row().text(t(lang, "menu_open"), "menu:open");
  }
  await reply(ctx, header + releaseBody(lang, note), kb);
}

// Owner approval gate — confirm before broadcasting the release notes to all users.
export async function showWhatsNewConfirm(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const note = latestRelease();
  const n = (await listOnboardedUsers(ctx.db)).filter((u) => !u.blocked && !u.botBlocked).length;
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
  const note = latestRelease();
  const recipients = (await listOnboardedUsers(ctx.db)).filter((u) => !u.blocked && !u.botBlocked);
  await reply(ctx, t(lang, "whatsnew_sending", { n: recipients.length }));
  let ok = 0;
  let fail = 0;
  for (const u of recipients) {
    try {
      await ctx.api.sendMessage(u.chatId, releaseBody(u.lang, note), HTML);
      ok++;
    } catch (err) {
      fail++;
      if (err instanceof GrammyError && err.error_code === 403) {
        await updateUser(ctx.db, u._id, { botBlocked: true }).catch(() => {});
      }
    }
  }
  await recordAudit(ctx.db, ctx.user._id, "release_notes", undefined, `${note.version} ${ok}/${recipients.length}`);
  await reply(ctx, t(lang, "announce_done", { ok, total: recipients.length, fail }), menuBtn(lang));
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
    await deleteUserData(ctx.db, userId);
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

// Telegram renders no real tables — a monospace <pre> block with space-aligned columns is the
// only table-like option. First column left-aligned (labels), the rest right-aligned (numbers).
export function monoTable(headers: string[], rows: (string | number)[][]): string {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (cells: (string | number)[]) =>
    cells.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join("  ");
  const sep = w.map((n) => "-".repeat(n)).join("  ");
  return `<pre>${escapeHtml([fmt(headers), sep, ...rows.map(fmt)].join("\n"))}</pre>`;
}

// Visual helpers for report sections. Telegram renders no CSS/tables — unicode does the work:
// ▰▱ progress bars for shares, ▁▂▃▄▅▆▇█ sparklines for day-by-day trends.
export function pctBar(part: number, total: number, width = 10): string {
  const ratio = total > 0 ? Math.max(0, Math.min(1, part / total)) : 0;
  const filled = Math.round(ratio * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function sparkline(values: number[]): string {
  if (!values.length) return "";
  const chars = "▁▂▃▄▅▆▇█";
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(chars.length - 1, Math.round((v / max) * (chars.length - 1)))]).join("");
}

const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

// Ranked list with proportional bars: `  42 ▇▇▇▇▇▇▇▇ menu:today` — reads faster than a
// two-column count table when the point is "what dominates".
function barList(rows: { label: string; n: number }[], maxBar = 8): string {
  const top = Math.max(...rows.map((r) => r.n), 1);
  const w = Math.max(...rows.map((r) => String(r.n).length));
  const lines = rows.map((r) => {
    const bar = "▇".repeat(Math.max(1, Math.round((r.n / top) * maxBar)));
    return `${String(r.n).padStart(w)} ${bar.padEnd(maxBar)} ${r.label}`;
  });
  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
}

// 7/14/30-day windows shared by the owner-report sections.
export function ownerReportWindows() {
  const now = Date.now();
  return {
    since7Iso: new Date(now - 7 * 86_400_000).toISOString(),
    since14Iso: new Date(now - 14 * 86_400_000).toISOString(),
    since30Iso: new Date(now - 30 * 86_400_000).toISOString(),
  };
}

// 📊 Overview: trainers/clients summary + 7-day engagement KPIs (carries the report header).
export async function orOverview(db: D1Database): Promise<string> {
  const { since7Iso, since14Iso, since30Iso } = ownerReportWindows();
  const since7Date = since7Iso.slice(0, 10);
  const nowIsoStr = new Date().toISOString();
  const [trainersCount, clientsCount, pendingApps, pendingReqs, active7, active30, engagement,
    totalUsers, onboarded, new7, moderation, planStatus, churned, inactive7] = await Promise.all([
    countByRole(db, "trainer"),
    countByRole(db, "client"),
    pendingTrainerApplications(db),
    countPendingClientRequests(db),
    countActiveSince(db, since7Iso),
    countActiveSince(db, since30Iso),
    engagementSince(db, since7Date),
    countUsers(db),
    countOnboarded(db),
    countUsersCreatedSince(db, since7Iso),
    countModeration(db),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
    listChurnedUsers(db, since14Iso, since7Iso).catch(() => [] as { id: number; name: string }[]),
    countInactive(db, since7Iso, nowIsoStr).catch(() => 0),
  ]);
  const usersWithPlan = [...planStatus.values()].filter((p) => p.active).length;
  const retentionPct = share(active7, onboarded);
  const todayStr = new Date().toISOString().slice(0, 10);
  const thisWkStart = weekStartStr(todayStr);
  const lastWkStart = weekStartStr(new Date(Date.parse(todayStr) - 7 * 86_400_000).toISOString().slice(0, 10));
  const [wkThis, wkLast, dauRows] = await Promise.all([
    countCompletedWorkoutsBetween(db, thisWkStart, "9999-12-31"),
    countCompletedWorkoutsBetween(db, lastWkStart, thisWkStart),
    dailyActiveUsers(db, since7Date).catch(() => [] as { date: string; n: number }[]),
  ]);
  const wkArrow = wkThis > wkLast ? "↑" : wkThis < wkLast ? "↓" : "→";
  // DAU day-by-day for the last 7 calendar days (missing days = 0, so the sparkline is honest).
  const dauBy = new Map(dauRows.map((d) => [d.date, d.n]));
  const days: number[] = [];
  for (let i = 6; i >= 0; i--) days.push(dauBy.get(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)) ?? 0);
  const dauPeak = Math.max(...days, 0);

  // Attention block: only real action items; each line says what to DO about it.
  const attention: string[] = [];
  if (pendingApps.length) attention.push(`• 🧑‍🏫 Trainer application(s): <b>${pendingApps.length}</b> — see 🧑‍🏫 Trainers section`);
  if (pendingReqs) attention.push(`• 📥 Pending client request(s): <b>${pendingReqs}</b>`);
  if (churned.length) attention.push(`• 📉 Churn risk (quiet 7–14d): <b>${churned.length}</b> — ${churned.slice(0, 5).map((c) => escapeHtml(c.name || `id ${c.id}`)).join(", ")}${churned.length > 5 ? "…" : ""}`);
  if (inactive7 > 0) attention.push(`• 💤 Inactive 7d+ (solo): <b>${inactive7}</b> → /cleanup`);
  if (moderation.blocked || moderation.botBlocked) attention.push(`• 🚫 Blocked: by owner <b>${moderation.blocked}</b> · bot blocked by user <b>${moderation.botBlocked}</b>`);

  return [
    `🛠 <b>TRIX — owner report</b>`,
    `📅 ${todayStr} · ${new Date().toISOString().slice(11, 16)} UTC · window 7d`,
    // At-a-glance TL;DR so the whole report's gist lands in one line before the detail.
    `🧭 <b>${onboarded}</b> onboarded · <b>${active7}</b> active 7d · <b>${wkThis}</b> workouts this wk ${wkArrow} · ${attention.length ? `⚠️ <b>${attention.length}</b> to review` : "✅ all clear"}`,
    "",
    "👥 <b>People</b>",
    `${pctBar(onboarded, totalUsers)} onboarded <b>${onboarded}</b>/${totalUsers} (${share(onboarded, totalUsers)}%)`,
    `• New 7d: <b>+${new7}</b> · Trainers <b>${trainersCount}</b> · Clients <b>${clientsCount}</b>`,
    `• Active: 7d <b>${active7}</b> · 30d <b>${active30}</b> · retention 7d/onb <b>${retentionPct}%</b>`,
    `• DAU 7d: <code>${sparkline(days)}</code> peak ${dauPeak}`,
    `🔻 ${totalUsers} → ${onboarded} onboarded → ${active7} active 7d`,
    "",
    "🏋️ <b>Training (7d)</b>",
    `• Workouts <b>${engagement.workouts}</b> · done ${engagement.workouts ? share(engagement.completed, engagement.workouts) : 0}% · this wk <b>${wkThis}</b> ${wkArrow} (prev ${wkLast})`,
    `• Check-ins <b>${engagement.checkins}</b> · Nutrition logs <b>${engagement.nutrition}</b>`,
    `${pctBar(usersWithPlan, onboarded)} active plan <b>${usersWithPlan}</b>/${onboarded}`,
    "",
    attention.length ? `⚠️ <b>Attention (${attention.length})</b>\n${attention.join("\n")}` : "✅ <b>All clear</b> — nothing pending, nobody stuck.",
  ].join("\n");
}

// 📊 Usage events (7d), split into real-user activity vs owner/admin actions (from event_counts).
export async function orEngagement(db: D1Database): Promise<string> {
  const { since7Iso } = ownerReportWindows();
  const rows = await eventStatsSince(db, since7Iso.slice(0, 10), 60).catch(() => [] as { event: string; n: number }[]);
  if (!rows.length) return "📊 <b>Usage events (7d)</b>\nNo events recorded yet.";
  const isAdmin = (e: string) => /^(orep|ou|clean)/.test(e) || e === "menu:ownerreport" || e === "menu:users";
  const userRows = rows.filter((r) => !isAdmin(r.event)).slice(0, 20).map((r) => ({ label: r.event, n: r.n }));
  const adminRows = rows.filter((r) => isAdmin(r.event)).map((r) => ({ label: r.event, n: r.n }));
  const totalTaps = userRows.reduce((s, r) => s + r.n, 0);
  const parts = [
    `📊 <b>Usage events (7d) — users</b> · ${totalTaps} tap(s), top ${userRows.length}`,
    userRows.length ? barList(userRows) : "—",
  ];
  if (adminRows.length) parts.push("🛠 <b>Admin actions (7d)</b>", barList(adminRows));
  return parts.join("\n");
}

// 🤖 AI: provider usage, calls by task, latency/fallback, and plan-source offload.
export async function orAI(db: D1Database, env?: Env): Promise<string> {
  const { since7Iso } = ownerReportWindows();
  const [usage7, callStats, planSources] = await Promise.all([
    aiUsageSince(db, since7Iso),
    aiCallStatsSince(db, since7Iso),
    countPlanSourcesSince(db, since7Iso),
  ]);
  const okBy = new Map<string, number>();
  const failBy = new Map<string, number>();
  const byKind: Record<string, number> = {};
  for (const u of usage7) {
    const m = u.ok ? okBy : failBy;
    m.set(u.provider, (m.get(u.provider) ?? 0) + 1);
    byKind[u.kind] = (byKind[u.kind] ?? 0) + 1;
  }
  // Provider lines in fallback order; new providers appear automatically.
  const PROVIDERS: [string, string, string][] = [
    ["gemini", "Gemini", "GEMINI_API_KEY"],
    ["groq", "Groq (fallback)", "GROQ_API_KEY"],
    ["ollama", "Ollama (fallback)", "OLLAMA_API_KEY"],
    ["openrouter", "OpenRouter (fallback)", "OPENROUTER_API_KEY"],
    ["workersai", "Workers AI (fallback)", ""],
  ];
  const keyCount = (k: string) => (env && k ? splitKeys((env as unknown as Record<string, string>)[k]).length : 0);
  const usageRows: (string | number)[][] = PROVIDERS.filter(([p, , k]) => okBy.has(p) || failBy.has(p) || keyCount(k) > 0).map(
    ([p, label, k]) => [label.replace(" (fallback)", "*"), okBy.get(p) ?? 0, failBy.get(p) ?? 0, k ? keyCount(k) : env ? "bind" : "-"],
  );
  const taskRows: (string | number)[][] = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]);
  // One-glance health verdict, derived from the 7d call stats (details in the tables below).
  const totalCalls0 = callStats.reduce((s, c) => s + c.calls, 0);
  const fbPct0 = totalCalls0 ? Math.round((callStats.reduce((s, c) => s + c.fallbacks, 0) / totalCalls0) * 100) : 0;
  const gemAvg = callStats.find((c) => c.provider === "gemini")?.avgLatencyMs ?? 0;
  const health =
    gemAvg > 15_000 || fbPct0 > 60
      ? `🔴 <b>Degraded</b> — fallback ${fbPct0}%${gemAvg ? `, Gemini ${(gemAvg / 1000).toFixed(1)}s avg` : ""}`
      : fbPct0 > 25
        ? `🟡 <b>Strained</b> — fallback ${fbPct0}%${gemAvg ? `, Gemini ${(gemAvg / 1000).toFixed(1)}s avg` : ""}`
        : `🟢 <b>Healthy</b> — fallback ${fbPct0}%${gemAvg ? `, Gemini ${(gemAvg / 1000).toFixed(1)}s avg` : ""}`;
  const lines: string[] = [
    "🤖 <b>AI usage (7d)</b>",
    ...(totalCalls0 ? [health] : []),
    monoTable(["Provider", "ok", "fail", "keys"], usageRows.length ? usageRows : [["—", 0, 0, "-"]]),
    "<i>* = fallback provider · Gemini “fail” = rate-limited</i>",
    "",
    "📋 <b>AI calls by task (7d)</b>",
    monoTable(["Task", "calls"], taskRows.length ? taskRows : [["—", 0]]),
  ];
  if (callStats.length) {
    const totalCalls = callStats.reduce((s, c) => s + c.calls, 0);
    const totalFallbacks = callStats.reduce((s, c) => s + c.fallbacks, 0);
    const totalTokens = callStats.reduce((s, c) => s + c.tokens, 0);
    const fallbackPct = totalCalls ? Math.round((totalFallbacks / totalCalls) * 100) : 0;
    const kTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
    lines.push(
      "",
      "⚙️ <b>AI calls (7d): latency & fallback</b>",
      `• Total: ${totalCalls} call(s) · fallback rate ${fallbackPct}%${totalTokens ? ` · ${kTok(totalTokens)} tokens` : ""}`,
      monoTable(["Provider", "calls", "avg ms", "tok"], callStats.map((c) => [c.provider, c.calls, c.avgLatencyMs, kTok(c.tokens)])),
    );
    // Latency alert: the primary provider should answer in a few seconds; > 15s avg means it's
    // hitting timeouts/retries (degraded) and dragging every plan/translate call.
    const gem = callStats.find((c) => c.provider === "gemini");
    if (gem && gem.avgLatencyMs > 15_000) {
      lines.push(`⚠️ <b>Gemini degraded</b>: ${(gem.avgLatencyMs / 1000).toFixed(0)}s avg latency — likely timeouts/retries. Fallbacks are carrying load.`);
    }
  }
  // Plan source (7d): confirms the bank/template actually offloaded Gemini. zero-AI = bank+template.
  if (planSources.length) {
    const rows = planSources.map((s) => [s.kind, s.source, s.c]);
    const total = planSources.reduce((a, s) => a + s.c, 0);
    const zeroAi = planSources.filter((s) => s.source !== "ai").reduce((a, s) => a + s.c, 0);
    const pct = total ? Math.round((zeroAi / total) * 100) : 0;
    lines.push("", "🏦 <b>Plan source (7d)</b>", `• Zero-AI served: <b>${pct}%</b> (${zeroAi}/${total})`, monoTable(["Kind", "Source", "n"], rows));
  }
  return lines.join("\n");
}

// 🧑‍🏫 Trainers & requests: pending applications, pending client requests, trainer roster.
export async function orTrainers(db: D1Database): Promise<string> {
  const [pendingApps, reqs, trainers] = await Promise.all([
    pendingTrainerApplications(db),
    pendingRequestsAll(db, 20),
    listTrainerUsers(db),
  ]);
  const lines: string[] = [];
  if (pendingApps.length) {
    lines.push("🆕 <b>Trainer applications (approve via their message)</b>");
    for (const a of pendingApps) lines.push(`• ${escapeHtml(a.name)} (id ${a.trainerId})`);
  }
  if (reqs.length) {
    lines.push("", "📥 <b>Pending client requests (client → trainer)</b>");
    for (const r of reqs) {
      const [cl, tr] = await Promise.all([getUser(db, r.clientId), getUser(db, r.trainerId)]);
      const clName = escapeHtml(cl?.profile.name ?? `id ${r.clientId}`);
      const trName = escapeHtml(tr?.profile.name ?? `id ${r.trainerId}`);
      lines.push(`• ${clName} → ${trName}${r.note ? `: ${escapeHtml(r.note)}` : ""}`);
    }
  }
  if (trainers.length) {
    lines.push("", "🧑‍🏫 <b>Trainers</b>");
    for (const tr of trainers) {
      const n = await countClientsOf(db, tr._id);
      lines.push(`• ${escapeHtml(tr.profile.name ?? `id ${tr._id}`)} — ${n} client(s)`);
    }
  }
  return lines.length ? lines.join("\n") : "🧑‍🏫 <b>Trainers & requests</b>\nNothing pending.";
}

// 🚧 Onboarding & churn: who is mid-interview / stuck / generating, and who went quiet.
export async function orOnboarding(db: D1Database): Promise<string> {
  const { since7Iso, since14Iso } = ownerReportWindows();
  const [onboarding, planPending, churned, byMode] = await Promise.all([
    listOnboardingUsers(db).catch(() => []),
    // Far-future cutoff → every plan-generation-stage user, not just stale ones.
    listPlanPendingUsers(db, new Date(Date.now() + 86_400_000).toISOString()).catch(() => []),
    listChurnedUsers(db, since14Iso, since7Iso).catch(() => [] as { id: number; name: string }[]),
    nonOnboardedByMode(db).catch(() => [] as { mode: string; n: number }[]),
  ]);
  const lines: string[] = [];
  // Funnel: which question the in-interview cohort is currently sitting on (drop-off point),
  // plus every non-onboarded user bucketed by session mode (never started, role pick, …).
  if (byMode.length) {
    lines.push("🪜 <b>Funnel — non-onboarded by stage</b>", monoTable(["Stage", "n"], byMode.map((m) => [m.mode, m.n])));
  }
  const stepCounts = new Map<string, number>();
  const steps = obSteps("en");
  for (const u of onboarding) {
    const field = String(steps[u.session.step ?? 0]?.field ?? `step ${u.session.step ?? 0}`);
    stepCounts.set(field, (stepCounts.get(field) ?? 0) + 1);
  }
  if (stepCounts.size) {
    lines.push("❓ <b>Interview — stuck on question</b>", monoTable(["Question", "n"], [...stepCounts.entries()].sort((a, b) => b[1] - a[1])));
  }
  if (lines.length) lines.push("");
  if (onboarding.length || planPending.length) {
    const stuck: string[] = [];
    const retrying: string[] = [];
    const waiting: string[] = [];
    for (const u of onboarding) {
      const who = u.profile.name ? escapeHtml(u.profile.name) : `id ${u._id}`;
      const { filled, total } = interviewProgress(u.profile);
      const prog = `${filled}/${total} details`;
      const tr = u.session.transcript ?? [];
      const last = tr[tr.length - 1];
      if (u.session.retryAfter) retrying.push(`${who} (${prog}, retry queued)`);
      else if (last?.role === "user") stuck.push(`${who} · ${prog} · ${tr.length} turns · since ${u.updatedAt.toISOString().slice(5, 16).replace("T", " ")}`);
      else waiting.push(`${who} (${prog})`);
    }
    const inProgress = onboarding.length + planPending.length;
    lines.push(`🚧 <b>Onboarding (${inProgress} in progress)</b>`);
    if (stuck.length) {
      lines.push(`❌ <b>STUCK — answered, no bot reply (${stuck.length})</b>`);
      for (const s of stuck) lines.push(`• ${s}`);
      lines.push("↳ fix: /users → tap user → ▶️ Continue interview");
    }
    if (retrying.length) lines.push(`🔁 Auto-retry queued: ${retrying.join(", ")}`);
    if (waiting.length) lines.push(`⏳ Waiting on user: ${waiting.join(", ")}`);
    if (planPending.length) {
      const names = planPending.map((u) => (u.profile.name ? escapeHtml(u.profile.name) : `id ${u._id}`));
      lines.push(`⚙️ Generating plan (${planPending.length}): ${names.join(", ")}`);
    }
  }
  if (churned.length) {
    lines.push("", `📉 <b>Churn risk (${churned.length})</b> — silent 7-14d`);
    lines.push(churned.map((c) => escapeHtml(c.name || `id ${c.id}`)).join(", "));
  }
  return lines.length ? lines.join("\n") : "🚧 <b>Onboarding & churn</b>\nAll clear.";
}

// 🐞 Errors, progression activity, and the recent admin audit trail.
export async function orErrors(db: D1Database): Promise<string> {
  const { since7Iso } = ownerReportWindows();
  const [errors7, planSources, adjustments7, audit] = await Promise.all([
    errorStatsSince(db, since7Iso).catch(() => [] as { errorType: string; kind: string; n: number }[]),
    countPlanSourcesSince(db, since7Iso),
    countAdjustmentsSince(db, since7Iso),
    recentAudit(db, 8).catch(() => [] as { ts: string; actorId: number; action: string; targetId: number | null; detail: string | null }[]),
  ]);
  const lines: string[] = [];
  // Progression activity (7d): how dynamically plans are adapting.
  const psBy = (k: string) => planSources.filter((s) => s.kind === k).reduce((a, s) => a + s.c, 0);
  const progRows: (string | number)[][] = [
    ["Weekly progress", adjustments7],
    ["Plateau swaps", psBy("plateau_swap")],
    ["Level-ups", psBy("level_up")],
    ["Goal switches", psBy("goal_switch")],
  ];
  if (progRows.some((r) => Number(r[1]) > 0)) {
    lines.push("📈 <b>Progression (7d)</b>", monoTable(["Event", "n"], progRows));
  }
  if (errors7.length) {
    const byType = new Map<string, number>();
    for (const e of errors7) byType.set(e.errorType, (byType.get(e.errorType) ?? 0) + e.n);
    lines.push("", "🐞 <b>Errors by type (7d)</b>", monoTable(["Type", "n"], [...byType.entries()].sort((a, b) => b[1] - a[1])));
  }
  // AI errors (last 24h). Null when there were no errors.
  const errReport = await buildErrorReport(db).catch(() => null);
  if (errReport) lines.push("", errReport);
  // Audit trail of recent owner/trainer admin actions (assign, block, flag, broadcast…).
  if (audit.length) {
    lines.push("", "🛡 <b>Recent admin actions</b>");
    for (const a of audit) {
      const when = a.ts.slice(5, 16).replace("T", " ");
      lines.push(`• ${when} · ${escapeHtml(a.action)}${a.targetId ? ` → ${a.targetId}` : ""}${a.detail ? ` (${escapeHtml(a.detail)})` : ""}`);
    }
  }
  return lines.length ? lines.join("\n") : "🐞 <b>Errors & progression</b>\nNo errors in the last 7d. 🎉";
}

// 👤 Users: full roster table (most-active first) + recent feedback.
// Structured user rows for the Mini App owner console — the same data as the text report, but
// as JSON so the app can render an interactive (sortable / groupable) table.
export interface OwnerUserRow {
  id: number; name: string; nick: string; trainer: string;
  status: "banned" | "blocked" | "onboarding" | "active" | "draft" | "none";
  onb: string; w: number; c: number; n: number; s: number; last: string; total: number;
}
export async function ownerUsersData(
  db: D1Database,
): Promise<{ rows: OwnerUserRow[]; feedback: { who: string; date: string; text: string }[] }> {
  const [users, trainers, eventCounts, planStatus, feedback] = await Promise.all([
    listUsersBrief(db),
    listTrainerUsers(db),
    eventCountsByUser(db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
    recentFeedback(db, 10),
  ]);
  const trainerName = new Map<number, string>();
  for (const tr of trainers) trainerName.set(tr._id, tr.profile.name ?? `id ${tr._id}`);
  const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
  const rows: OwnerUserRow[] = users.map((u) => {
    const ev = eventCounts.get(u.id) ?? zero;
    const ps = planStatus.get(u.id);
    const prog = interviewProgress(u.profile);
    const status: OwnerUserRow["status"] = u.blocked
      ? "banned"
      : u.botBlocked
        ? "blocked"
        : !u.onboarded
          ? "onboarding"
          : ps?.active
            ? "active"
            : ps?.draft
              ? "draft"
              : "none";
    return {
      id: u.id,
      name: u.name || `id ${u.id}`,
      nick: u.username ? `@${u.username}` : "",
      trainer: u.trainerId ? trainerName.get(u.trainerId) ?? `id ${u.trainerId}` : "",
      status,
      onb: u.onboarded ? "" : `${prog.filled}/${prog.total}`,
      w: ev.workouts, c: ev.checkins, n: ev.nutrition, s: ev.steps,
      last: u.lastSeenAt ? u.lastSeenAt.slice(5, 10) : "",
      total: ev.workouts + ev.checkins + ev.nutrition + ev.steps,
    };
  });
  const fb = feedback.map((f) => ({ who: f.username ? `@${f.username}` : `id ${f.userId}`, date: f.date, text: f.text }));
  return { rows, feedback: fb };
}

export async function orUsers(db: D1Database): Promise<string> {
  const [users, trainers, eventCounts, planStatus, feedback] = await Promise.all([
    listUsersBrief(db), // all users — the owner report lists everyone
    listTrainerUsers(db),
    eventCountsByUser(db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
    recentFeedback(db, 10),
  ]);
  const lines: string[] = [];
  if (users.length) {
    // A wide monospace <pre> table (13 columns) wrapped and became unreadable on phones. Instead:
    // one compact 2-line "card" per user that flows naturally at any width. A leading glyph encodes
    // status at a glance; counts are self-labelled with emoji so no column alignment is needed.
    lines.push("👤 <b>Users</b> · 🟢 active plan · 🟠 draft · ⚪ no plan · 🟡 onboarding · 🚫 bot-blocked · ⛔ banned · 🧑‍🏫 trainer · 🏋️ workouts · ✅ check-ins · 🍽 nutrition · 👟 steps · date = last active");
    const trainerName = new Map<number, string>();
    for (const tr of trainers) trainerName.set(tr._id, tr.profile.name ?? `id ${tr._id}`);
    const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
    // Most-active first: rank by total logged events (workouts + check-ins + nutri + steps).
    const ranked = [...users]
      .map((u) => ({ u, ev: eventCounts.get(u.id) ?? zero }))
      .sort((a, b) => {
        const sum = (e: typeof zero) => e.workouts + e.checkins + e.nutrition + e.steps;
        return sum(b.ev) - sum(a.ev);
      });
    const cards = ranked.map(({ u, ev }) => {
      const prog = interviewProgress(u.profile);
      const ps = planStatus.get(u.id);
      const glyph = u.blocked ? "⛔" : u.botBlocked ? "🚫" : !u.onboarded ? "🟡" : ps?.active ? "🟢" : ps?.draft ? "🟠" : "⚪";
      const head = [`${glyph} <b>${escapeHtml(u.name || `id ${u.id}`)}</b>`];
      if (u.username) head.push(`@${escapeHtml(u.username)}`);
      if (u.trainerId) head.push(`🧑‍🏫${escapeHtml(trainerName.get(u.trainerId) ?? `id ${u.trainerId}`)}`);
      if (!u.onboarded) head.push(`${prog.filled}/${prog.total}`);
      const plan = ps?.active ? (ps?.draft ? "📋+📝" : "📋") : ps?.draft ? "📝" : "";
      const act: string[] = [];
      if (ev.workouts) act.push(`🏋️${ev.workouts}`);
      if (ev.checkins) act.push(`✅${ev.checkins}`);
      if (ev.nutrition) act.push(`🍽${ev.nutrition}`);
      if (ev.steps) act.push(`👟${ev.steps}`);
      const meta: string[] = [];
      if (plan) meta.push(plan);
      meta.push(act.length ? act.join(" ") : "—");
      if (u.lastSeenAt) meta.push(u.lastSeenAt.slice(5, 10)); // MM-DD of last GENUINE activity
      return `${head.join(" · ")}\n   ${meta.join(" · ")}`;
    });
    // Blank line every 8 cards → chunkReport split points (Telegram's 4096 cap) + batch grouping.
    for (let i = 0; i < cards.length; i += 8) { lines.push(""); lines.push(cards.slice(i, i + 8).join("\n")); }
  }
  if (feedback.length) {
    lines.push("", "✍️ <b>Recent feedback</b>");
    for (const f of feedback) {
      const who = f.username ? `@${f.username}` : `id ${f.userId}`;
      lines.push(`• <b>${escapeHtml(who)}</b> (${f.date}): ${escapeHtml(f.text)}`);
    }
  } else {
    lines.push("", "✍️ No feedback yet.");
  }
  return lines.join("\n");
}

// Full report (used by the scheduled weekly owner push) = all sections concatenated.
export async function buildOwnerReport(db: D1Database, env?: Env): Promise<string> {
  const sections = await Promise.all([
    orOverview(db),
    orAI(db, env),
    orTrainers(db),
    orOnboarding(db),
    orErrors(db),
    orEngagement(db),
    orUsers(db),
  ]);
  // A light rule between sections so the seven blocks read as distinct cards, not one wall of
  // text. Kept on its own blank-line-delimited line so chunkReport still splits cleanly.
  return sections.filter(Boolean).join("\n\n────────────\n\n");
}

// Daily AI-error report for the owner — last 24h only. Returns null when there were no errors
// (so the owner isn't pinged on clean days). Mirrors the error block that used to live in the
// weekly owner report, but on a 1-day window sent every day.
export async function buildErrorReport(db: D1Database): Promise<string | null> {
  const since1Iso = new Date(Date.now() - 86_400_000).toISOString();
  const [errStats, errSamples, callStats] = await Promise.all([
    errorStatsSince(db, since1Iso).catch(() => []),
    recentErrors(db, since1Iso, 8).catch(() => []),
    aiCallStatsSince(db, since1Iso).catch(() => []),
  ]);
  if (!errStats.length) return null;

  const total = errStats.reduce((s, e) => s + e.n, 0);
  const byType: Record<string, number> = {};
  for (const e of errStats) byType[e.errorType] = (byType[e.errorType] ?? 0) + e.n;
  const lines = [
    `🐞 <b>AI errors (24h): ${total}</b>`,
    "• by type: " + Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(" · "),
    "• by task: " + errStats.slice(0, 6).map((e) => `${e.kind}/${e.errorType} ${e.n}`).join(", "),
  ];
  if (callStats.length) {
    const totalCalls = callStats.reduce((s, c) => s + c.calls, 0);
    const totalFallbacks = callStats.reduce((s, c) => s + c.fallbacks, 0);
    const fallbackPct = totalCalls ? Math.round((totalFallbacks / totalCalls) * 100) : 0;
    lines.push(`• AI calls (24h): ${totalCalls} · fallback rate ${fallbackPct}%`);
  }
  for (const e of errSamples) {
    lines.push(`  ${e.ts.slice(11, 16)} ${escapeHtml(e.kind)}/${escapeHtml(e.errorType)}: ${escapeHtml((e.message ?? "").slice(0, 80))}`);
  }
  return lines.join("\n");
}
