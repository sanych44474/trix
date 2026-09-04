// Remaining bot surfaces migrated to the Mini App: personal records, the week card, the trainer
// requests inbox (accept/decline), the find-a-trainer directory (+ request), the public program
// library (+ take), what's-new, the plates calculator, and become-a-trainer / trainer-profile
// editing. Reuses the same repos and domain code as the bot; pushes (confirmations, interview
// kick-off) go out via the Bot API.
import { buildWeekCard, obKeyboard, obSteps } from "../bot";
import {
  applyTrainer,
  bumpSharedTaken,
  countClientsOf,
  createRequest,
  getOwnerChatId,
  getRequest,
  getSharedProgram,
  getTrainer,
  getUser,
  linkClient,
  listAchievements,
  listPublicPrograms,
  listStrength,
  pendingRequestsForTrainer,
  setActivePlan,
  setRequestStatus,
  updateTrainer,
  updateUser,
} from "../db/repos";
import { adaptPlan } from "../domain/planAdapt";
import { platePlan, warmupRamp } from "../domain/calc";
import { BADGES, e1rm } from "../domain/records";
import { formatRecordBest } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { latestRelease, releaseBody } from "../releaseNotes";
import { miniAppUser } from "./auth";
import type { Env } from "../types";

async function tgSend(env: Env, chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  }).catch(() => {});
}

const bad = () => Response.json({ error: "bad request" }, { status: 400 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function handleExtrasApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const lang = user.lang;
  const path = url.pathname;
  const noStore = { headers: { "cache-control": "no-store" } };

  // ---- Personal records + badge catalog (earned/locked) ----
  if (req.method === "GET" && path === "/api/records") {
    const [records, earned] = await Promise.all([
      listStrength(env.DB, user._id).catch(() => []),
      listAchievements(env.DB, user._id).catch(() => [] as string[]),
    ]);
    const have = new Set(earned);
    return Response.json(
      {
        records: records.map((r) => ({
          exercise: r.exercise,
          best: formatRecordBest(r),
          metric: r.metric,
          updated: r.updatedAt ? String(r.updatedAt).slice(0, 10) : null,
          // e1RM trend for weight×reps lifts — the client draws it inline on tap.
          points: r.metric === "reps"
            ? r.history.filter((h) => h.weight > 0 && h.reps > 0).map((h) => ({ date: h.date, v: Math.round(e1rm(h.weight, h.reps) * 10) / 10 }))
            : [],
        })),
        badges: BADGES.map((code) => ({ label: t(lang, `badge_${code}` as Parameters<typeof t>[1]), earned: have.has(code) })),
      },
      noStore,
    );
  }

  // ---- Week card (shareable 7-day summary) ----
  if (req.method === "GET" && path === "/api/weekcard") {
    const card = await buildWeekCard(env.DB, user._id, user.profile.timezone, user.profile.name ?? "", lang, user.reminders?.lastVacation);
    return Response.json({ card }, noStore);
  }

  // ---- What's new ----
  if (req.method === "GET" && path === "/api/whatsnew") {
    const note = latestRelease();
    return Response.json({ version: note.version, html: releaseBody(lang, note) }, noStore);
  }

  // ---- Plates calculator ----
  if (req.method === "GET" && path === "/api/plates") {
    const target = Number(url.searchParams.get("kg"));
    if (!Number.isFinite(target) || target <= 0 || target > 600) return bad();
    const plan = platePlan(target);
    const ramp = warmupRamp(target);
    return Response.json({ plan: plan ? { loaded: plan.loaded, perSide: plan.perSide, leftover: plan.leftover } : null, ramp }, noStore);
  }

  // ---- Trainer requests inbox ----
  if (path === "/api/requests") {
    if (user.role !== "trainer") return Response.json({ error: "forbidden" }, { status: 403 });
    if (req.method === "GET") {
      const reqs = await pendingRequestsForTrainer(env.DB, user._id).catch(() => []);
      const out = [];
      for (const r of reqs) {
        const client = await getUser(env.DB, r.clientId).catch(() => null);
        out.push({ id: r.id, clientId: r.clientId, name: client?.profile.name ?? `id ${r.clientId}`, note: r.note ?? "" });
      }
      return Response.json({ requests: out }, noStore);
    }
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const body = (await req.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
    const r = await getRequest(env.DB, Number(body.id));
    if (!r || r.trainerId !== user._id || r.status !== "pending") return notFound();
    if (body.action === "decline") {
      await setRequestStatus(env.DB, r.id, "declined");
      const client = await getUser(env.DB, r.clientId).catch(() => null);
      if (client) await tgSend(env, client.chatId, t(client.lang, "client_declined"));
      return Response.json({ ok: true });
    }
    if (body.action !== "accept") return bad();
    // Accept — mirrors the bot's onRequestAccept: link, then walk a new client into the interview.
    await setRequestStatus(env.DB, r.id, "accepted");
    await linkClient(env.DB, r.clientId, user._id);
    const client = await getUser(env.DB, r.clientId).catch(() => null);
    if (client) {
      const trainerName = escapeHtml(user.profile.name ?? "trainer");
      if (client.onboarded) {
        await updateUser(env.DB, client._id, { session: { mode: "idle" } });
        await tgSend(env, client.chatId, t(client.lang, "client_transferred", { name: trainerName }));
      } else {
        await updateUser(env.DB, client._id, { session: { mode: "onboarding", step: 0 } });
        const steps = obSteps(client.lang);
        await tgSend(
          env, client.chatId,
          `${t(client.lang, "client_accepted", { name: trainerName })}\n\n(1/${steps.length}) ${t(client.lang, steps[0].q)}`,
          obKeyboard(client.lang, steps[0], []),
        );
      }
      const shareKb = { inline_keyboard: [
        [{ text: t(client.lang, "share_body_btn"), callback_data: "share:tog:body" }],
        [{ text: t(client.lang, "share_health_btn"), callback_data: "share:tog:health" }],
        [{ text: t(client.lang, "share_skip_btn"), callback_data: "share:skip" }],
      ] };
      await tgSend(env, client.chatId, t(client.lang, "share_prompt_new"), shareKb);
    }
    return Response.json({ ok: true });
  }

  // ---- Send a request to a trainer the client already knows (invite link / code) ----
  if (path === "/api/trainers") {
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    if (user.role !== "solo") return bad();
    const body = (await req.json().catch(() => ({}))) as { trainerId?: unknown; note?: unknown };
    const trainer = await getUser(env.DB, Number(body.trainerId)).catch(() => null);
    const trDoc = trainer ? await getTrainer(env.DB, trainer._id).catch(() => null) : null;
    if (!trainer || !trDoc || trDoc.status !== "approved") return notFound();
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : undefined;
    const reqId = await createRequest(env.DB, user._id, trainer._id, note);
    const who = escapeHtml(user.profile.name ?? `id ${user._id}`);
    const kb = { inline_keyboard: [[
      { text: t(trainer.lang, "req_accept"), callback_data: `req:accept:${reqId}` },
      { text: t(trainer.lang, "req_decline"), callback_data: `req:decline:${reqId}` },
    ]] };
    await tgSend(env, trainer.chatId, t(trainer.lang, "trainer_new_request", { name: who }) + (note ? `\n💬 ${escapeHtml(note)}` : ""), kb);
    return Response.json({ ok: true });
  }

  // ---- Public program library (+ take) ----
  if (path === "/api/library") {
    if (req.method === "GET") {
      const progs = await listPublicPrograms(env.DB, 20).catch(() => []);
      return Response.json({ role: user.role, programs: progs }, noStore);
    }
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    if (user.role === "client") return bad(); // the trainer owns a client's plan
    const body = (await req.json().catch(() => ({}))) as { code?: unknown };
    const sp = await getSharedProgram(env.DB, String(body.code ?? ""));
    if (!sp) return notFound();
    const records = await listStrength(env.DB, user._id, 8).catch(() => []);
    const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
    const plan = adaptPlan(sp.plan, user.profile, user._id, { prs });
    await setActivePlan(env.DB, plan);
    await updateUser(env.DB, user._id, { onboarded: true, nutrition: plan.nutrition });
    await bumpSharedTaken(env.DB, sp.code).catch(() => {});
    return Response.json({ ok: true, name: sp.name });
  }

  // ---- Become a trainer / edit trainer profile ----
  if (path === "/api/trainer/profile") {
    if (req.method === "GET") {
      const tr = await getTrainer(env.DB, user._id).catch(() => null);
      const nClients = tr ? await countClientsOf(env.DB, user._id).catch(() => 0) : 0;
      return Response.json(
        {
          role: user.role,
          trainer: tr
            ? { status: tr.status, name: tr.name, bio: tr.bio ?? "", specialization: tr.specialization ?? "", experienceYears: tr.experienceYears ?? null, priceOnline: tr.priceOnline ?? null, city: tr.city ?? "", contact: tr.contact ?? "", accepting: !!tr.accepting, clients: nClients }
            : null,
        },
        noStore,
      );
    }
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
    const patch = {
      name: str(body.name, 60), bio: str(body.bio, 600), specialization: str(body.specialization, 120),
      approach: str(body.approach, 600), city: str(body.city, 60), contact: str(body.contact, 120),
      experienceYears: typeof body.experienceYears === "number" && body.experienceYears >= 0 && body.experienceYears <= 60 ? Math.round(body.experienceYears) : undefined,
      priceOnline: typeof body.priceOnline === "number" && body.priceOnline >= 0 && body.priceOnline <= 100000 ? Math.round(body.priceOnline) : undefined,
    };
    const existing = await getTrainer(env.DB, user._id).catch(() => null);
    if (existing) {
      await updateTrainer(env.DB, user._id, { ...patch, ...(typeof body.accepting === "boolean" ? { accepting: body.accepting } : {}) });
      return Response.json({ ok: true });
    }
    // New application (pending owner approval) — needs at least a name.
    if (!patch.name) return bad();
    await applyTrainer(env.DB, user._id, patch);
    const ownerChatId = await getOwnerChatId(env.DB).catch(() => null);
    if (ownerChatId) {
      const who = user.username ? `@${user.username}` : `id ${user._id}`;
      const kb = { inline_keyboard: [[
        { text: "✅", callback_data: `trainer:approve:${user._id}` },
        { text: "❌", callback_data: `trainer:reject:${user._id}` },
      ]] };
      await tgSend(env, ownerChatId, `🎓 <b>Trainer application</b> from ${escapeHtml(who)}: ${escapeHtml(patch.name)}`, kb);
    }
    return Response.json({ ok: true, pending: true });
  }

  return notFound();
}
