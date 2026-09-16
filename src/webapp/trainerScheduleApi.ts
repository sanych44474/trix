// Trainer scheduling and money:
//   /api/trainer/sessions (GET)   — the schedule in a [from, to) window, with client names
//   /api/trainer/sessions (POST)  — create / set status / reschedule / delete one session
//   /api/trainer/finance (GET)    — per-client ledger for the window, plus the payment log
//   /api/trainer/finance (POST)   — record or delete a payment
//
// Both routes were already registered (v2Api.ts PATHS, index.ts's extras allowlist) and pointed
// at handleExtrasApi, which had no branch for either, so every call fell through to a 404. They
// now live here rather than in extrasApi.ts: this is a self-contained domain with its own tables
// (migrations/0082) and extrasApi.ts is already a grab-bag.
//
// Same initData auth + trainer-role gate as trainerApi.ts, and every clientId is checked with
// getClientForTrainer, so a trainer can only schedule or bill their OWN clients. The adapter
// scopes each query by trainerId again -- a guessed row id from another trainer's schedule
// matches nothing rather than being read or mutated.
import {
  clientLedgers,
  createSession,
  deletePayment,
  deleteSession,
  listPayments,
  listSessions,
  recordPayment,
  rescheduleSession,
  setSessionStatus,
  SESSION_STATUSES,
  type SessionStatus,
} from "../adapters/d1/v2Sessions";
import { getClientForTrainer, getTrainer, listClients } from "../adapters/d1/v2Trainer";
import { logInfo } from "../log";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
import type { Env } from "../types";

const noStore = { headers: { "cache-control": "no-store" } };
const bad = () => Response.json({ error: "bad request" }, { status: 400 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });

const MAX_NOTE = 300;
const MAX_AMOUNT = 10_000_000;
const DAY_MS = 86_400_000;

/** ISO date-time or plain date, normalized to a full ISO instant. undefined = unusable. */
function isoInstant(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function noteField(v: unknown): string | undefined {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > MAX_NOTE ? undefined : s;
}

/** A whole-currency-unit amount (see migrations/0082 on why not minor units). */
function money(v: unknown, { required }: { required: boolean }): number | null | undefined {
  if (v === undefined || v === null || v === "") return required ? undefined : null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_AMOUNT) return undefined;
  return Math.round(v);
}

/**
 * Defaults to a 30-day window starting a week back, so the schedule opens on "this week plus
 * what's coming" rather than empty. `to` is exclusive.
 */
function windowFrom(url: URL): { from: string; to: string } | null {
  const now = Date.now();
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const from = rawFrom ? isoInstant(rawFrom) : new Date(now - 7 * DAY_MS).toISOString();
  const to = rawTo ? isoInstant(rawTo) : new Date(now + 30 * DAY_MS).toISOString();
  if (!from || !to || from >= to) return null;
  return { from, to };
}

export async function handleTrainerScheduleApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "trainer") return Response.json({ error: "forbidden" }, { status: 403 });

  const isSessions = url.pathname === "/api/trainer/sessions";
  const isFinance = url.pathname === "/api/trainer/finance";
  if (!isSessions && !isFinance) return notFound();

  // Names are resolved here, once, rather than stored on each row: a client rename must not leave
  // stale names scattered across the schedule and the payment log.
  const clients = await listClients(env.DB, user._id).catch(() => []);
  const nameOf = (clientId: number) => clients.find((c) => c._id === clientId)?.profile.name ?? `id ${clientId}`;

  if (req.method === "GET") {
    const range = windowFrom(url);
    if (!range) return bad();
    if (isSessions) {
      const sessions = await listSessions(env.DB, user._id, range.from, range.to);
      return Response.json({
        from: range.from,
        to: range.to,
        clients: clients.map((c) => ({ id: c._id, name: c.profile.name ?? `id ${c._id}` })),
        sessions: sessions.map((s) => ({ ...s, clientName: nameOf(s.clientId) })),
      }, noStore);
    }
    const trainer = await getTrainer(env.DB, user._id).catch(() => null);
    const [ledgers, payments] = await Promise.all([
      clientLedgers(env.DB, user._id, range.from, range.to),
      listPayments(env.DB, user._id, range.from.slice(0, 10), range.to.slice(0, 10)),
    ]);
    return Response.json({
      from: range.from,
      to: range.to,
      currency: trainer?.currency || "UAH",
      defaultPrice: trainer?.priceOnline ?? null,
      clients: clients.map((c) => ({ id: c._id, name: c.profile.name ?? `id ${c._id}` })),
      ledgers: ledgers.map((l) => ({ ...l, clientName: nameOf(l.clientId) })),
      payments: payments.map((p) => ({ ...p, clientName: nameOf(p.clientId) })),
      totals: {
        billed: ledgers.reduce((sum, l) => sum + l.billed, 0),
        paid: ledgers.reduce((sum, l) => sum + l.paid, 0),
        balance: ledgers.reduce((sum, l) => sum + l.balance, 0),
      },
    }, noStore);
  }

  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  if (isSessions) {
    if (action === "create") {
      const clientId = Number(body.clientId);
      if (!Number.isInteger(clientId) || !(await getClientForTrainer(env.DB, user._id, clientId))) return notFound();
      const startsAt = isoInstant(body.startsAt);
      const note = noteField(body.note);
      const price = money(body.price, { required: false });
      const durationMin = typeof body.durationMin === "number" && body.durationMin > 0 && body.durationMin <= 600 ? Math.round(body.durationMin) : 60;
      if (!startsAt || note === undefined || price === undefined) return bad();
      const id = await createSession(env.DB, user._id, { clientId, startsAt, durationMin, price, note });
      logInfo("trainer_session_created", {});
      return Response.json({ ok: true, id });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id)) return bad();
    if (action === "status") {
      const status = typeof body.status === "string" ? body.status : "";
      if (!(SESSION_STATUSES as string[]).includes(status)) return bad();
      if (!(await setSessionStatus(env.DB, user._id, id, status as SessionStatus))) return notFound();
      return Response.json({ ok: true });
    }
    if (action === "reschedule") {
      const startsAt = isoInstant(body.startsAt);
      const durationMin = typeof body.durationMin === "number" && body.durationMin > 0 && body.durationMin <= 600 ? Math.round(body.durationMin) : 60;
      if (!startsAt) return bad();
      if (!(await rescheduleSession(env.DB, user._id, id, startsAt, durationMin))) return notFound();
      return Response.json({ ok: true });
    }
    if (action === "delete") {
      if (!(await deleteSession(env.DB, user._id, id))) return notFound();
      return Response.json({ ok: true });
    }
    return bad();
  }

  if (action === "pay") {
    const clientId = Number(body.clientId);
    if (!Number.isInteger(clientId) || !(await getClientForTrainer(env.DB, user._id, clientId))) return notFound();
    const amount = money(body.amount, { required: true });
    const note = noteField(body.note);
    const paidOn = typeof body.paidOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn) ? body.paidOn : new Date().toISOString().slice(0, 10);
    if (amount === undefined || amount === null || amount <= 0 || note === undefined) return bad();
    const trainer = await getTrainer(env.DB, user._id).catch(() => null);
    const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().slice(0, 8) : trainer?.currency || "UAH";
    const id = await recordPayment(env.DB, user._id, { clientId, amount, currency, paidOn, note });
    logInfo("trainer_payment_recorded", {});
    return Response.json({ ok: true, id });
  }
  if (action === "delete") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return bad();
    if (!(await deletePayment(env.DB, user._id, id))) return notFound();
    return Response.json({ ok: true });
  }
  return bad();
}
