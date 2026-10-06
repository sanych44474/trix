// The trainer's client card in the bot: card view and its actions, plan day editing, notes,
// health and personal fields, intake view, templates, and client questions.
import { InlineKeyboard } from "grammy";
import type { BankPlan, Lang, UserDoc, Weekday } from "../../types";
import { recordAudit, setUserFlag } from "../../adapters/d1/v2Admin";
import { listStrength, workoutLogsSince } from "../../adapters/d1/v2Workouts";
import { assignDraftPlan, deleteDraftPlan, getActivePlan, getDraftPlan, saveDraftPlan } from "../../adapters/d1/v2Plans";
import { deleteTrainerTemplate, getClientCard, getClientForTrainer, getClientNote, getTrainerTemplate, listClientNoteHistory, listClients, listMessages, listQuestionsForTrainer, listTrainerTemplates, saveTrainerTemplate, setClientCard, setClientNote } from "../../adapters/d1/v2Trainer";
import { bodyLogsByUser, listActiveInjuries } from "../../adapters/d1/v2Tracking";
import { nutritionLogsSince } from "../../adapters/d1/v2Nutrition";
import { getUser, updateUser } from "../../adapters/d1/v2Users";
import { adaptPlan } from "../../domain/planAdapt";
import { birthdayInfo, parseBirthdayInput, trainerCanSee } from "../../domain/clientCard";
import { computeCyclePhase } from "../../domain/cycle";
import { complianceScore, getPlanDay } from "../../domain/progression";
import { formatRecordBest } from "../../domain/setFormat";
import { localParts } from "../../domain/localTime";
import { escapeHtml, t } from "../../locales/i18n";
import { renderPlan, renderSchedule, renderStrength, renderToday, upcomingSessions, weekdayName } from "../../render";
import { type MyContext, type TKey, HTML, clearEditOwner, reply, setEditOwner, setMode } from "../../adapters/telegram/context";
import { buildWeekCard } from "../gamification/weekCard";
import { localCutoff, renderBodyDynamics } from "../../bot/report";
import { localizePlanNames, healPlanNamesForDisplay } from "../../bot/exerciseCatalog";
import { mainMenu, menuBtn } from "../../bot/keyboards";
import { obProgress, sendObStepTo } from "../../bot/onboarding";
import { videosForDays } from "../../bot";
import { showClientLogDays } from "./trainerComms";
import { intvLabel, anthroBlock, runTrainerDraft } from "./trainerInterview";
import { clientCardKb, editDayKb, requireTrainer } from "./trainerCommon";

// Enter "edit this user's plan" mode → show a day picker. Shared by trainer & owner.
export async function showPlanEditPicker(ctx: MyContext, targetId: number, prefix: string, headerName: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, targetId);
  if (!plan || !plan.split.length) {
    // The editor works on the ACTIVE plan only -- but cc_plan (viewing) already falls back to a
    // draft, so a client sitting on an unassigned draft (or an active plan orphaned by a leave/
    // rejoin, see unlinkClient in v2Trainer.ts) could be viewed but never edited. Offer to assign
    // the draft right here instead of a dead-end "no plan" message.
    const draft = await getDraftPlan(ctx.db, targetId);
    if (draft && draft.split.length) {
      const kb = new InlineKeyboard().text(t(lang, "cc_assign"), `${prefix}:${targetId}:assign`);
      await reply(ctx, t(lang, "client_draft_only_trainer", { name: headerName }), kb);
      return;
    }
    await reply(ctx, t(lang, "client_no_plan_trainer"));
    return;
  }
  // Store the prefix too — the day manager (pday:*) builds its links from the session context.
  await setEditOwner(ctx, targetId, prefix === "ou" ? "ou" : "cl");
  const kb = new InlineKeyboard();
  for (const d of [...plan.split].sort((a, b) => a.weekday - b.weekday)) {
    kb.text(`${weekdayName(lang, d.weekday)} — ${d.muscleGroup}`.slice(0, 60), `${prefix}:${targetId}:eday:${d.weekday}`).row();
  }
  kb.text(t(lang, "pday_manage_btn"), "pday:open").text(t(lang, "edit_done"), `${prefix}:${targetId}:editdone`);
  await reply(ctx, t(lang, "edit_pick_day_header", { name: headerName }), kb);
}

// Show one day of a managed user's plan with edit buttons. Shared by trainer & owner.
export async function showPlanEditDay(ctx: MyContext, targetId: number, prefix: string, wd: Weekday) {
  const lang = ctx.user.lang;
  await setEditOwner(ctx, targetId, prefix === "ou" ? "ou" : "cl");
  const target = await getUser(ctx.db, targetId).catch(() => null);
  let plan = await getActivePlan(ctx.db, targetId);
  if (!plan) {
    // Same fallback as showPlanEditPicker: reachable directly via a stale eday button (e.g. from
    // an old chat message) even when the picker itself was never re-opened.
    const draft = await getDraftPlan(ctx.db, targetId);
    if (draft && draft.split.length) {
      const kb = new InlineKeyboard().text(t(lang, "cc_assign"), `${prefix}:${targetId}:assign`);
      await reply(ctx, t(lang, "client_draft_only_trainer", { name: target?.profile.name ?? `id ${targetId}` }), kb);
      return;
    }
    await reply(ctx, t(lang, "client_no_plan_trainer"));
    return;
  }
  // Self-heal English names on view (a pre-localization template/shared assign), in the CLIENT's
  // language, and persist — so the client also sees the corrected plan, not just this editor.
  plan = await healPlanNamesForDisplay(ctx, plan, target?.lang ?? lang);
  const day = getPlanDay(plan, wd);
  if (!day) { await reply(ctx, t(lang, "error_generic")); return; }
  // Editing a plan is NOT logging — suppress the "record workout" CTA and prefix the day with
  // whose plan this is, so a trainer with their own program never confuses it with a client's.
  const header = t(lang, "edit_day_banner", { name: escapeHtml(target?.profile.name ?? `id ${targetId}`) });
  await reply(
    ctx,
    `${header}\n\n${renderToday(lang, day, weekdayName(lang, wd), undefined, await videosForDays(ctx, [day]), { noCta: true })}`,
    editDayKb(lang, prefix, targetId, wd),
  );
}

// ❓ Q&A archive — the trainer's recent client questions with status at a glance.
export async function cmdTrainerQuestions(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  const qs = await listQuestionsForTrainer(ctx.db, ctx.user._id, 15);
  if (!qs.length) {
    await reply(ctx, t(lang, "qa_none"), menuBtn(lang));
    return;
  }
  const clients = await listClients(ctx.db, ctx.user._id);
  const names = new Map(clients.map((c) => [c._id, c.profile.name ?? `id ${c._id}`]));
  const icon = (s: string) => (s === "answered" ? "✅" : s === "dismissed" ? "✖️" : "⏳");
  const lines = [t(lang, "qa_header")];
  for (const q of qs) {
    const when = q.createdAt.toISOString().slice(5, 10);
    lines.push(
      `${icon(q.status)} ${when} <b>${escapeHtml(names.get(q.clientId) ?? `id ${q.clientId}`)}</b>: ${escapeHtml(q.text.slice(0, 150))}`,
    );
  }
  const kb = new InlineKeyboard().text(t(lang, "tr_back_hub"), "menu:open");
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "card". */
export async function showClientCard(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  await clearEditOwner(ctx);
  // 7-day compliance: % of scheduled workouts done + % of days food was logged.
  const cutoff = localCutoff(client.profile.timezone, 7);
  const [wl, nl] = await Promise.all([
    workoutLogsSince(ctx.db, clientId, cutoff),
    nutritionLogsSince(ctx.db, clientId, cutoff),
  ]);
  const comp = complianceScore({
    completedWorkouts: wl.filter((l) => l.completed).length,
    scheduledWorkouts: (client.profile.trainingWeekdays ?? []).length,
    nutritionDays: nl.length,
    windowDays: 7,
  });
  const note = await getClientNote(ctx.db, ctx.user._id, clientId);
  // Cycle phase — shown to the trainer when the client is female (helps them adjust the
  // session on the fly without having to ask). Menstrual data is medical, so it also
  // requires the client's explicit health-sharing consent.
  let cycleLine = "";
  if (client.profile.sex === "female" && trainerCanSee(client.profile, "health")) {
    const clientDate = localParts(client.profile.timezone ?? "UTC").date;
    const cycleInfo = computeCyclePhase(client.profile, clientDate);
    if (cycleInfo) {
      const phaseLabel = t(lang, `cycle_phase_${cycleInfo.phase}` as Parameters<typeof t>[1]);
      cycleLine = "\n" + t(lang, "cc_cycle_phase", { phase: phaseLabel, day: cycleInfo.day, len: cycleInfo.cycleLength });
    } else {
      cycleLine = "\n" + t(lang, "cc_cycle_no_data");
    }
  }
  const card =
    t(lang, "client_card", { name: cname, status: client.onboarded ? "✅" : "⏳" }) +
    "\n" +
    t(lang, "cc_compliance_line", { workoutPct: comp.workoutPct, nutritionPct: comp.nutritionPct }) +
    cycleLine +
    (note ? `\n\n📝 <i>${escapeHtml(note)}</i>` : "");
  await reply(ctx, card, clientCardKb(lang, clientId));
}

/** clientCardAction "thread". */
export async function showClientThread(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  // Messages were previously write-only (sent once as a Telegram push, never readable again).
  const msgs = await listMessages(ctx.db, ctx.user._id, clientId, 20);
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_message"), `cl:${clientId}:msg`)
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  if (!msgs.length) {
    await reply(ctx, t(lang, "cc_thread_empty", { name: cname }), kb);
  } else {
    const lines = msgs.map((m) => `${m.createdAt.slice(0, 16).replace("T", " ")} ${m.fromId === ctx.user._id ? "→" : "←"} ${escapeHtml(m.text)}`);
    await reply(ctx, `${t(lang, "cc_thread_title", { name: cname })}\n\n${lines.join("\n")}`, kb);
  }
}

/** clientCardAction "note". */
export async function showClientNote(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  const note = await getClientNote(ctx.db, ctx.user._id, clientId);
  const history = await listClientNoteHistory(ctx.db, ctx.user._id, clientId, "note");
  let body = note ? `📝 ${cname}\n\n${escapeHtml(note)}` : t(lang, "cc_note_empty", { name: cname });
  if (history.length) {
    body += `\n\n<i>${t(lang, "cc_note_history_hdr")}</i>\n` +
      history.slice(0, 5).map((h) => `• ${h.savedAt.slice(0, 10)}: ${escapeHtml(h.value)}`).join("\n");
  }
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_note_edit"), `cl:${clientId}:noteedit`)
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, body, kb);
}

/** clientCardAction "health". */
export async function showClientHealth(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  // Trainer-authored health notes first; the client's self-reported limitations/injuries
  // only when the client shares health data.
  const card = await getClientCard(ctx.db, ctx.user._id, clientId);
  const lines = [t(lang, "cc_health_title", { name: cname })];
  lines.push(card?.healthNotes ? escapeHtml(card.healthNotes) : t(lang, "cc_health_none"));
  if (trainerCanSee(client.profile, "health")) {
    if (client.profile.limitations) {
      lines.push("", t(lang, "cc_client_limitations", { text: client.profile.limitations }));
    }
    const injuries = await listActiveInjuries(ctx.db, clientId);
    if (injuries.length) {
      lines.push("", t(lang, "cc_injuries_hdr"));
      for (const inj of injuries) {
        const area = t(lang, `inj_area_${inj.area}` as TKey);
        const sev = t(lang, `inj_sev_${inj.severity}` as TKey);
        const last = inj.checkinsHistory[inj.checkinsHistory.length - 1];
        const pain = last ? ` · ${last.score}/10 (${last.date})` : "";
        lines.push(`• ${area} — ${sev} · ${inj.reportedAt.slice(0, 10)}${pain}`);
      }
    }
  } else {
    lines.push("", t(lang, "cc_share_locked", { name: cname }));
  }
  const healthHistory = await listClientNoteHistory(ctx.db, ctx.user._id, clientId, "healthNotes");
  if (healthHistory.length) {
    lines.push("", `<i>${t(lang, "cc_health_history_hdr")}</i>`);
    for (const h of healthHistory.slice(0, 5)) lines.push(`• ${h.savedAt.slice(0, 10)}: ${escapeHtml(h.value)}`);
  }
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_health_edit"), `cl:${clientId}:healthedit`)
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "pers". */
export async function showClientPersonal(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  const card = await getClientCard(ctx.db, ctx.user._id, clientId);
  const lines = [t(lang, "cc_personal_title", { name: cname })];
  if (card?.birthday) {
    const info = birthdayInfo(card.birthday, new Date().toISOString().slice(0, 10));
    let bday = t(lang, "cc_bday_line", { date: info.display, age: info.age !== undefined ? ` (${info.age})` : "" });
    if (info.daysUntil <= 7) bday += t(lang, "cc_bday_soon", { days: info.daysUntil });
    lines.push(bday);
  }
  lines.push(card?.personalNotes ? escapeHtml(card.personalNotes) : t(lang, "cc_personal_none"));
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_personal_edit"), `cl:${clientId}:persedit`)
    .text(t(lang, "cc_bday_btn"), `cl:${clientId}:bday`)
    .row()
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "intv". */
export async function showClientIntake(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  // Interview summary: onboarding answers straight from the client's profile (no backfill
  // needed — both the button wizard and the AI interview write there), consent-gated where
  // the data is body/health sensitive.
  const p = obProgress(client.profile);
  const lines = [t(lang, "cc_intv_title", { name: cname })];
  lines.push(client.onboarded ? t(lang, "cc_intv_done") : t(lang, "cc_intv_progress", { n: p.answered, total: p.total }));
  lines.push("");
  const before = lines.length;
  const add = (key: TKey, v?: string) => { if (v) lines.push(`${t(lang, key)}: ${v}`); };
  add("cc_intv_goal", intvLabel(lang, client.profile.goal));
  add("cc_intv_level", intvLabel(lang, client.profile.level));
  add("cc_intv_history", client.profile.trainingHistory ? escapeHtml(client.profile.trainingHistory) : undefined);
  const days = client.profile.trainingWeekdays ?? [];
  if (days.length) lines.push(`${t(lang, "cc_intv_days")}: ${days.map((w) => weekdayName(lang, w)).join(", ")}`);
  add("cc_intv_equipment", intvLabel(lang, client.profile.equipment));
  add("cc_intv_lifestyle", intvLabel(lang, client.profile.lifestyle));
  add("cc_intv_sleep", intvLabel(lang, client.profile.sleepSchedule));
  add("cc_intv_diet", intvLabel(lang, client.profile.dietPrefs));
  add("cc_intv_allergies", client.profile.allergies ? escapeHtml(client.profile.allergies) : undefined);
  add("cc_intv_food_likes", client.profile.foodLikes ? escapeHtml(client.profile.foodLikes) : undefined);
  add("cc_intv_food_dislikes", client.profile.foodDislikes ? escapeHtml(client.profile.foodDislikes) : undefined);
  add("cc_intv_fav_ex", client.profile.favoriteExercises ? escapeHtml(client.profile.favoriteExercises) : undefined);
  add("cc_intv_dis_ex", client.profile.dislikedExercises ? escapeHtml(client.profile.dislikedExercises) : undefined);
  if (lines.length === before) lines.push(t(lang, "cc_intv_empty"));
  const anthro = anthroBlock(lang, client, cname);
  if (anthro) lines.push("", anthro);
  if (trainerCanSee(client.profile, "health") && client.profile.limitations) {
    lines.push("", t(lang, "cc_client_limitations", { text: client.profile.limitations }));
  }
  const kb = new InlineKeyboard();
  if (!client.onboarded) {
    kb.text(t(lang, "cc_intv_remind_btn"), `cl:${clientId}:intvping`)
      .text(t(lang, "cc_mini_btn"), `mi:${clientId}`)
      .row();
  }
  kb.text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "intvping". */
export async function pingClientIntake(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  // Nudge the client to finish the interview: resume the exact question they stopped at.
  if (client.onboarded) { await clientCardAction(ctx, clientId, "intv"); return; }
  const prefix = t(client.lang, "cc_intv_remind_text");
  const transcript = client.session.transcript;
  if (client.session.mode === "onboarding" && transcript?.length) {
    // AI-interview user — re-send the last unanswered question (same as the cron nudge).
    const lastQ = [...transcript].reverse().find((m) => m.role === "assistant");
    await ctx.api
      .sendMessage(client.chatId, `${prefix}\n\n${escapeHtml(lastQ?.text ?? "")}`.trim(), HTML)
      .catch(() => {});
  } else {
    // Button-wizard user (or an abandoned session) — resume at the first unanswered step.
    const step = client.session.mode === "onboarding" && typeof client.session.step === "number"
      ? client.session.step
      : obProgress(client.profile).next;
    await updateUser(ctx.db, clientId, { session: { mode: "onboarding", step } });
    await sendObStepTo(ctx, client, step, prefix);
  }
  await reply(ctx, t(lang, "cc_intv_reminded", { name: cname }));
}

/** clientCardAction "tpl". */
export async function showTemplateMenu(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  // Reusable program templates: assign one to this client, or save their plan as a new one.
  const tpls = await listTrainerTemplates(ctx.db, ctx.user._id);
  const kb = new InlineKeyboard();
  for (const tp of tpls) {
    kb.text(`📋 ${tp.name}`.slice(0, 48), `cl:${clientId}:tplas:${tp.id}`).text("🗑", `tpldel:${tp.id}`).row();
  }
  kb.text(t(lang, "tpl_save_btn"), `cl:${clientId}:tplsave`).row();
  kb.text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, t(lang, tpls.length ? "tpl_pick" : "tpl_none", { name: cname }), kb);
}

export async function clientCardAction(ctx: MyContext, clientId: number, action: string, arg?: string) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) {
    await reply(ctx, t(lang, "client_not_found"));
    return;
  }
  const cname = escapeHtml(client.profile.name ?? `id ${clientId}`);
  if (action === "card") {
    await showClientCard(ctx, client, clientId, cname, lang);
  } else if (action === "edit") {
    await showPlanEditPicker(ctx, clientId, "cl", cname);
  } else if (action === "eday") {
    await showPlanEditDay(ctx, clientId, "cl", Number(arg) as Weekday);
  } else if (action === "editdone") {
    await clearEditOwner(ctx);
    await reply(ctx, t(lang, "client_card", { name: cname, status: client.onboarded ? "✅" : "⏳" }), clientCardKb(lang, clientId));
  } else if (action === "plan") {
    const plan = (await getActivePlan(ctx.db, clientId)) ?? (await getDraftPlan(ctx.db, clientId));
    if (!plan) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)));
  } else if (action === "sched") {
    const plan = await getActivePlan(ctx.db, clientId);
    if (!plan) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
    const logs = (await workoutLogsSince(ctx.db, clientId, localCutoff(client.profile.timezone, 14))).map((l) => ({ date: l.date, completed: l.completed }));
    await reply(ctx, renderSchedule(lang, upcomingSessions(lang, plan, client.profile.timezone, logs, 8)));
  } else if (action === "prog") {
    const records = await listStrength(ctx.db, clientId);
    await reply(ctx, renderStrength(lang, records));
  } else if (action === "body") {
    const body = await bodyLogsByUser(ctx.db, clientId);
    // Static anthropometry (profile data) is client-owned — gated by the body-sharing consent.
    // The measurement dynamics below come from logs and stay trainer-visible as before.
    const block = anthroBlock(lang, client, cname);
    const anthro = block ? `${block}\n\n` : "";
    await reply(ctx, `📐 ${cname}\n${anthro}${renderBodyDynamics(lang, body)}`);
  } else if (action === "draft") {
    await runTrainerDraft(ctx, client, client.profile);
  } else if (action === "assign") {
    const ok = await assignDraftPlan(ctx.db, clientId);
    if (!ok) { await reply(ctx, t(lang, "no_draft")); return; }
    await recordAudit(ctx.db, ctx.user._id, "assign_plan", clientId);
    await reply(ctx, t(lang, "plan_assigned", { name: cname }));
    await ctx.api.sendMessage(client.chatId, t(client.lang, "client_plan_assigned"), { ...HTML, reply_markup: mainMenu(client.lang) }).catch(() => {});
  } else if (action === "flag") {
    const next = !client.flagged;
    await setUserFlag(ctx.db, clientId, next);
    await recordAudit(ctx.db, ctx.user._id, next ? "flag_client" : "unflag_client", clientId);
    await reply(ctx, t(lang, next ? "client_flagged" : "client_unflagged", { name: cname }), clientCardKb(lang, clientId));
  } else if (action === "discard") {
    const ok = await deleteDraftPlan(ctx.db, clientId);
    await reply(ctx, t(lang, ok ? "draft_discarded" : "no_draft"), clientCardKb(lang, clientId));
  } else if (action === "msg") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "msg_client", targetId: clientId } });
    await reply(ctx, t(lang, "msg_prompt", { name: cname }));
  } else if (action === "thread") {
    await showClientThread(ctx, clientId, cname, lang);
  } else if (action === "note") {
    await showClientNote(ctx, clientId, cname, lang);
  } else if (action === "noteedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_note", targetId: clientId } });
    await reply(ctx, t(lang, "cc_note_prompt", { name: cname }));
  } else if (action === "health") {
    await showClientHealth(ctx, client, clientId, cname, lang);
  } else if (action === "healthedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_health", targetId: clientId } });
    await reply(ctx, t(lang, "cc_health_prompt"));
  } else if (action === "pers") {
    await showClientPersonal(ctx, clientId, cname, lang);
  } else if (action === "persedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_personal", targetId: clientId } });
    await reply(ctx, t(lang, "cc_personal_prompt"));
  } else if (action === "bday") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_bday", targetId: clientId } });
    await reply(ctx, t(lang, "cc_bday_prompt"));
  } else if (action === "intv") {
    await showClientIntake(ctx, client, clientId, cname, lang);
  } else if (action === "intvping") {
    await pingClientIntake(ctx, client, clientId, cname, lang);
  } else if (action === "logs") {
    await showClientLogDays(ctx, clientId);
  } else if (action === "tpl") {
    await showTemplateMenu(ctx, clientId, cname, lang);
  } else if (action === "tplsave") {
    const plan = (await getActivePlan(ctx.db, clientId)) ?? (await getDraftPlan(ctx.db, clientId));
    if (!plan || !plan.split.length) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
    ctx.user.session = { ...ctx.user.session, mode: "tpl_name", targetId: clientId };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "tpl_name_prompt"));
  } else if (action === "tplas") {
    const tpl = await getTrainerTemplate(ctx.db, ctx.user._id, Number(arg));
    if (!tpl) { await reply(ctx, t(lang, "error_generic")); return; }
    // Personalize the template for THIS client (weekday remap, weight scaling to bodyweight/PRs)
    // and stage it as a draft — same review/assign path as an AI draft.
    const records = await listStrength(ctx.db, clientId, 8);
    const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
    const draft = adaptPlan(tpl.plan, client.profile, clientId, { prs, authoredBy: ctx.user._id });
    await localizePlanNames(ctx, draft, client.lang);
    await saveDraftPlan(ctx.db, draft);
    await recordAudit(ctx.db, ctx.user._id, "template_draft", clientId, tpl.name).catch(() => {});
    await reply(ctx, t(lang, "tpl_draft_ready", { tpl: tpl.name, name: cname }));
    await reply(ctx, renderPlan(lang, draft), clientCardKb(lang, clientId));
  } else if (action === "week") {
    // Forwardable weekly report card for THIS client — same card the solo user gets.
    const card = await buildWeekCard(ctx.db, clientId, client.profile.timezone, client.profile.name ?? `id ${clientId}`, lang, client.reminders?.lastVacation);
    if (!card) {
      await reply(ctx, t(lang, "wcard_client_empty", { name: cname }), clientCardKb(lang, clientId));
      return;
    }
    await reply(ctx, `${card}\n\n${t(lang, "wcard_client_hint")}`, clientCardKb(lang, clientId));
  } else if (action === "photo") {
    // Ask the client for a progress photo; their next photo routes to this trainer.
    await updateUser(ctx.db, clientId, { session: { ...client.session, photoReviewFor: ctx.user._id } });
    const kb = new InlineKeyboard().text(t(client.lang, "photo_req_skip_btn"), "photo:skip");
    const trName = escapeHtml(ctx.user.profile.name ?? "trainer");
    const ok = await ctx.api
      .sendMessage(client.chatId, t(client.lang, "photo_req_from", { name: trName }), { ...HTML, reply_markup: kb })
      .then(() => true)
      .catch(() => false);
    await reply(ctx, t(lang, ok ? "photo_req_sent" : "error_generic", { name: cname }), clientCardKb(lang, clientId));
  }
}

// Trainer typed a template name → snapshot the client's plan under it.
export async function handleTemplateName(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const plan = (await getActivePlan(ctx.db, clientId)) ?? (await getDraftPlan(ctx.db, clientId));
  if (!plan || !plan.split.length) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
  const name = text.trim().slice(0, 48);
  if (!name) { await reply(ctx, t(lang, "error_generic")); return; }
  const bank: BankPlan = {
    split: plan.split,
    nutrition: plan.nutrition,
    ...(plan.restDayNutrition ? { restDayNutrition: plan.restDayNutrition } : {}),
    supplements: plan.supplements ?? [],
    methodology: plan.methodology ?? "",
    ...(typeof plan.stepsTarget === "number" ? { stepsTarget: plan.stepsTarget } : {}),
  };
  await saveTrainerTemplate(ctx.db, ctx.user._id, name, bank);
  await reply(ctx, t(lang, "tpl_saved", { name }), menuBtn(lang));
}

export async function onTemplateDelete(ctx: MyContext, tplId: number) {
  const ok = await deleteTrainerTemplate(ctx.db, ctx.user._id, tplId);
  await reply(ctx, t(ctx.user.lang, ok ? "tpl_deleted" : "error_generic"), menuBtn(ctx.user.lang));
}

// Trainer typed a private note about a client → save it (or "-" to clear) and reopen the card.
export async function handleTrainerNote(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const note = text.trim() === "-" ? "" : text.trim().slice(0, 1000);
  await setClientNote(ctx.db, ctx.user._id, clientId, note);
  await reply(ctx, t(lang, note ? "cc_note_saved" : "cc_note_cleared"));
  await clientCardAction(ctx, clientId, "card");
}

// Trainer typed health notes for a client → save to the client card ("-" clears) and reopen.
export async function handleTrainerHealth(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const notes = text.trim() === "-" ? null : text.trim().slice(0, 1000);
  await setClientCard(ctx.db, ctx.user._id, clientId, { healthNotes: notes });
  await reply(ctx, t(lang, "cc_health_saved"));
  await clientCardAction(ctx, clientId, "health");
}

// Trainer typed personal notes for a client → save to the client card ("-" clears) and reopen.
export async function handleTrainerPersonal(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const notes = text.trim() === "-" ? null : text.trim().slice(0, 1000);
  await setClientCard(ctx.db, ctx.user._id, clientId, { personalNotes: notes });
  await reply(ctx, t(lang, "cc_personal_saved"));
  await clientCardAction(ctx, clientId, "pers");
}

// Trainer typed the client's birthday (DD.MM.YYYY / DD.MM, "-" clears) → save and reopen.
export async function handleTrainerBirthday(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  const tt = text.trim();
  const birthday = tt === "-" ? null : parseBirthdayInput(tt, new Date().toISOString().slice(0, 10));
  if (birthday === null && tt !== "-") { await reply(ctx, t(lang, "cc_bday_invalid")); return; } // stay in mode
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  await setClientCard(ctx.db, ctx.user._id, clientId, { birthday });
  await reply(ctx, t(lang, "cc_bday_saved"));
  await clientCardAction(ctx, clientId, "pers");
}

// --- trainer: view & correct a client's logged (completed) workouts ---
