// Guided per-exercise workout logging: the step-by-step logger (pick an exercise → sets →
// weight → reps, or the distance/timed-hold variants), the in-progress draft persisted on
// session.logDraft, per-set RPE and correction, the unsaved-work exit guard, and the switch to
// free-text logging. Extracted from bot.ts (god-file split; same barrel seam via bot.ts's
// `export * from "./bot/guidedLog"`) — this was filed under the "Reorder exercises" banner in
// bot.ts, an unrelated concept it happened to follow.
import { InlineKeyboard } from "grammy";
import type { Lang, PlanDay, SetEntry, UserDoc, Weekday } from "../types";
import { getActivePlan, getWorkoutLog, setRestTimer, updateUser, upsertWorkoutLog } from "../db/repos";
import { OB_WEEKDAY_KEYS } from "./onboarding";
import { exerciseMetric, fmtDuration, formatSetEntry, getPlanDay, localParts, parseDistance, parseDuration } from "../domain/progression";
import { unsavedLogCount } from "../domain/session";
import { parseSetEdit, parseSetLine } from "../domain/setLine";
import { escapeHtml, t } from "../locales/i18n";
import { isoDateMinus } from "./boards";
import { trainerMenuActionFor } from "./trainer";
import { finalizeWorkoutLog } from "./workoutSave";
import {
  type MyContext, MENU_MAP, cmdMenu, clearEditOwner, menuActionFor, menuBtn, reply, setMode,
} from "../bot";

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
