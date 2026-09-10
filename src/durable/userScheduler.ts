// Per-user Durable Object: one instance per userId (see bot/router.ts's wake-on-create and
// settings handlers). Its alarm fires hourly, mirroring the old cron's per-user cadence, and
// runs the SAME processUser decision logic (src/scheduler.ts) the cron path still runs for
// real — the only thing that differs is WHO calls it: each user's own alarm, in its own
// invocation, with its own 50-subrequest budget, decoupled from every other user's. That
// decoupling is the entire reason this exists (see docs/features.md's scheduler notes).
//
// DRY-RUN PHASE (current): every send and every D1 write processUser would make is intercepted
// — logged to scheduler_dryrun_log (migrations/0060) instead of actually happening — via a
// logging Sender and shadowD1 (./shadowDb.ts). The old cron path remains the SOLE real sender
// and the sole writer of reminders.sent for as long as this phase lasts. Nothing here persists
// its own dedup state yet: each firing reads the CURRENT real reminders.sent from D1 fresh,
// exactly like the cron path does, so the two paths can be compared like-for-like. Cutover
// (making this the real sender, and giving it its own persisted dedup state) is a deliberate
// later phase, not a flag flip — see the grilling transcript this design came out of.
import { getUser, logDryRun } from "../db/repos";
import { buildSinglePass, processUser, type Sender } from "../scheduler";
import type { Env } from "../types";
import { shadowD1 } from "./shadowDb";

// Hourly, matching the cron path's own hourKey-gated cadence (scheduler.ts) — processUser's
// internal gates (reminderHour, already(), daysBetween(...)) are what actually decide whether
// anything fires on a given hour, same as today.
const ALARM_INTERVAL_MS = 60 * 60 * 1000;

/** Wake (or re-wake) a user's scheduler DO. Idempotent — see the class's fetch() doc. */
export async function wakeUserScheduler(env: Env, userId: number): Promise<void> {
  const id = env.USER_SCHEDULER.idFromName(String(userId));
  const stub = env.USER_SCHEDULER.get(id);
  await stub.fetch(`https://do/wake?userId=${userId}`);
}

export class UserSchedulerDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  /** Wake (or re-wake) this DO for a specific user. Idempotent: safe to call again after a
   * settings change (timezone/reminder-hour) that needs the alarm cadence re-armed, or just to
   * make sure a DO that never got its first alarm (e.g. created before this code shipped) gets
   * one. Does NOT reset an alarm that's already scheduled — waking a user who didn't change
   * anything must not perturb their existing cadence. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/wake") return new Response("not found", { status: 404 });
    const userId = Number(url.searchParams.get("userId"));
    if (!Number.isFinite(userId)) return new Response("bad userId", { status: 400 });
    await this.state.storage.put("userId", userId);
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
    return new Response("ok");
  }

  async alarm(): Promise<void> {
    const userId = await this.state.storage.get<number>("userId");
    if (typeof userId !== "number") return; // woken without an id somehow — nothing to do

    // Reschedule FIRST, before any work that could throw. This is deliberate: the bug that
    // motivated this whole design (scheduler.ts's markSent-before-send finding) was exactly a
    // dedup key getting written independent of whether the thing it guards actually happened.
    // The equivalent failure mode here would be an alarm that silently stops recurring because
    // something downstream threw — reschedule can't be conditional on the rest of this succeeding.
    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);

    const user = await getUser(this.env.DB, userId);
    if (!user) return; // account deleted since the last wake

    const writes: { sql: string; params: unknown[] }[] = [];
    const shadowEnv: Env = { ...this.env, DB: shadowD1(this.env.DB, (w) => writes.push(w)) };

    const sends: { chatId: number; text: string }[] = [];
    const sender: Sender = {
      api: {
        sendMessage: (async (chatId: number, text: string) => {
          sends.push({ chatId, text });
          // processUser only ever awaits this and, on a few paths, catches a GrammyError for
          // the 403-blocked case — it never reads the resolved message back. A minimal stand-in
          // is enough; there is no real Telegram response to fabricate faithfully.
          return {} as Awaited<ReturnType<Sender["api"]["sendMessage"]>>;
        }) as Sender["api"]["sendMessage"],
      },
    };

    const pass = await buildSinglePass(shadowEnv.DB, userId);
    await processUser(shadowEnv, sender, user, pass);

    // Persisted through the REAL db, deliberately not the shadow — the shadow exists to protect
    // processUser's OWN writes; the dry-run observation itself must actually land, or there is
    // nothing left to compare against the cron path.
    for (const s of sends) await logDryRun(this.env.DB, "user", userId, "send", s);
    for (const w of writes) await logDryRun(this.env.DB, "user", userId, "write", w);
  }
}
