// Settings consolidation for the Mini App: everything from the bot's ⚙️ Settings that wasn't in
// /api/profile yet — reminder toggles, vacation mode, language, cycle tracking, leaderboard
// opt-in + alias, feedback, data export (pushed as a document to the chat), leave-trainer and
// account deletion. One endpoint, action-based POSTs; GET returns the whole current state.
import { buildExportMd } from "../bot";
import {
  clearVacation,
  deleteUserData,
  getOwnerChatId,
  getUser,
  insertFeedback,
  setVacation,
  unlinkClient,
  updateUser,
} from "../db/repos";
import { localParts } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { miniAppUser } from "./auth";
import type { Env, Lang, UserDoc } from "../types";

type TKey = Parameters<typeof t>[1];

// Same toggleable reminder keys the bot's settings screen exposes (REM map in bot.ts), plus the
// bi-weekly quality ask.
const REM_KEYS: [string, string][] = [
  ["workout", "rem_workout"], ["nutrition", "rem_nutrition"], ["steps", "rem_steps"], ["water", "rem_water"],
  ["checkin", "rem_checkin"], ["wellbeing", "rem_wellbeing"], ["tomorrow", "rem_tomorrow"], ["measure", "rem_measure"],
];

async function tgSend(env: Env, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

// Push the markdown export as a document (multipart) — the app can't download files (CSP), so
// delivery goes to the user's Telegram chat, same as /export in the bot.
async function tgSendDocument(env: Env, chatId: number, filename: string, content: string, caption: string): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("document", new Blob([new TextEncoder().encode(content)], { type: "text/markdown" }), filename);
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form }).catch(() => null);
  return !!res?.ok;
}

function state(user: UserDoc, lang: Lang) {
  const off = new Set(user.profile.remindersOff ?? []);
  return {
    onboarded: user.onboarded,
    reminders: REM_KEYS.map(([key, label]) => ({ key, label: t(lang, label as TKey), on: !off.has(key) })),
    vacationUntil: user.vacationUntil && user.vacationUntil > new Date() ? user.vacationUntil.toISOString().slice(0, 10) : null,
    lang: user.lang,
    role: user.role,
    cycle: user.profile.sex === "female"
      ? { on: !!user.profile.cycleTracking, lastStart: user.profile.lastPeriodStart ?? null, len: user.profile.cycleLengthDays ?? 28 }
      : null,
    compete: { on: !!user.competeOptIn, alias: user.alias ?? "" },
  };
}

export async function handleSettingsApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const lang = user.lang;

  if (req.method === "GET") {
    return Response.json(state(user, lang), { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const action = String(body.action);

  try {
    if (action === "remToggle") {
      const key = String(body.key);
      if (!REM_KEYS.some(([k]) => k === key)) return Response.json({ error: "bad request" }, { status: 400 });
      const off = new Set(user.profile.remindersOff ?? []);
      if (off.has(key)) off.delete(key);
      else off.add(key);
      const profile = { ...user.profile, remindersOff: [...off] };
      await updateUser(env.DB, user._id, { profile });
      user.profile = profile;
    } else if (action === "vacation") {
      if (body.off === true) {
        await clearVacation(env.DB, user._id);
        user.vacationUntil = undefined;
      } else {
        const days = Number(body.days);
        if (!Number.isInteger(days) || days < 1 || days > 90) return Response.json({ error: "bad request" }, { status: 400 });
        const until = new Date(Date.now() + days * 86_400_000);
        await setVacation(env.DB, user._id, until.toISOString());
        // Freeze the streak for the window (same bookkeeping as the bot's vacation flow).
        const { date } = localParts(user.profile.timezone);
        const reminders = { ...user.reminders, lastVacation: { from: date, until: until.toISOString().slice(0, 10) } };
        await updateUser(env.DB, user._id, { reminders });
        user.vacationUntil = until;
        user.reminders = reminders;
      }
    } else if (action === "lang") {
      const next = body.lang === "en" ? "en" : body.lang === "uk" ? "uk" : null;
      if (!next) return Response.json({ error: "bad request" }, { status: 400 });
      await updateUser(env.DB, user._id, { lang: next });
      user.lang = next;
    } else if (action === "cycle") {
      if (user.profile.sex !== "female") return Response.json({ error: "bad request" }, { status: 400 });
      const profile = { ...user.profile };
      if (typeof body.on === "boolean") profile.cycleTracking = body.on;
      if (typeof body.lastStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.lastStart)) {
        const { date } = localParts(user.profile.timezone);
        if (body.lastStart <= date) profile.lastPeriodStart = body.lastStart;
      }
      if (typeof body.len === "number" && body.len >= 20 && body.len <= 45) profile.cycleLengthDays = Math.round(body.len);
      await updateUser(env.DB, user._id, { profile });
      user.profile = profile;
    } else if (action === "compete") {
      const patch: { competeOptIn?: boolean; alias?: string } = {};
      if (typeof body.on === "boolean") patch.competeOptIn = body.on;
      if (typeof body.alias === "string") patch.alias = body.alias.trim().slice(0, 30);
      await updateUser(env.DB, user._id, patch);
      if (patch.competeOptIn !== undefined) user.competeOptIn = patch.competeOptIn;
      if (patch.alias !== undefined) user.alias = patch.alias;
    } else if (action === "feedback") {
      const text = String(body.text ?? "").trim().slice(0, 1500);
      if (text.length < 2) return Response.json({ error: "bad request" }, { status: 400 });
      const { date } = localParts(user.profile.timezone);
      await insertFeedback(env.DB, { userId: user._id, username: user.username, text, date });
      const ownerChatId = await getOwnerChatId(env.DB).catch(() => null);
      if (ownerChatId) {
        const who = user.username ? `@${user.username}` : `id ${user._id}`;
        await tgSend(env, ownerChatId, `✍️ <b>Feedback</b> from ${escapeHtml(who)}:\n${escapeHtml(text)}`);
      }
    } else if (action === "export") {
      const md = await buildExportMd(env.DB, user);
      if (!md) return Response.json({ ok: false, reason: "empty" });
      const ok = await tgSendDocument(env, user.chatId, "trix-export.md", md, t(lang, "export_caption"));
      return Response.json({ ok });
    } else if (action === "leaveTrainer") {
      if (user.role !== "client") return Response.json({ error: "bad request" }, { status: 400 });
      const formerTrainerId = user.trainerId;
      await unlinkClient(env.DB, user._id);
      user.role = "solo";
      user.trainerId = undefined;
      if (formerTrainerId) {
        const trainer = await getUser(env.DB, formerTrainerId).catch(() => null);
        if (trainer) {
          const who = escapeHtml(user.profile.name ?? `id ${user._id}`);
          await tgSend(env, trainer.chatId, t(trainer.lang, "client_left_trainer", { name: who }));
        }
      }
    } else if (action === "deleteAccount") {
      // Hard delete, same as the bot's /deleteme after confirm. The app MUST confirm first.
      if (body.confirm !== true) return Response.json({ error: "bad request" }, { status: 400 });
      await deleteUserData(env.DB, user._id);
      return Response.json({ ok: true, deleted: true });
    } else {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    return Response.json({ ok: true, state: state(user, user.lang) });
  } catch (err) {
    console.error("api/settings", user._id, action, err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
