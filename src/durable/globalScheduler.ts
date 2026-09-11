// Singleton Durable Object for the account-wide jobs (owner alerts, leaderboard cache,
// telemetry pruning) — always exactly one instance, addressed by a fixed name. These jobs are
// not what the whole per-user/per-squad DO redesign was solving (none of them touch the
// per-invocation subrequest ceiling: an owner alert is at most one send, the rest is pure D1);
// this exists for design consistency with the other two DO types, not because it fixes a
// problem specific to these jobs. Same dry-run posture as the others: runs the real
// runGlobalJobs (scheduler.ts) against a shadowed D1 and a logging Sender.
import { Bot } from "grammy";
import { runGlobalJobs, type Sender } from "../scheduler";
import { isCutOver } from "./cutover";
import { logDryRun } from "../db/repos";
import type { Env } from "../types";
import { shadowD1 } from "./shadowDb";
import { logInfo } from "../log";

const ALARM_INTERVAL_MS = 60 * 60 * 1000; // hourly, matching the cron path's own cadence
export const GLOBAL_SCHEDULER_NAME = "global";
// A fixed entityId for the dry-run log — there is no real per-entity id for a singleton. 0 is
// safe: user ids are positive Telegram ids and squad chat ids are negative, so it never collides
// with either when deleteUserData/deleteSquad scope their cleanup by (source, entityId).
const GLOBAL_LOG_ENTITY_ID = 0;

/** Wake the singleton GlobalSchedulerDO. Idempotent — safe to call every health-check tick. */
export async function wakeGlobalScheduler(env: Env): Promise<void> {
  const id = env.GLOBAL_SCHEDULER.idFromName(GLOBAL_SCHEDULER_NAME);
  const stub = env.GLOBAL_SCHEDULER.get(id);
  await stub.fetch("https://do/wake");
}

export class GlobalSchedulerDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/wake") return new Response("not found", { status: 404 });
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
    return new Response("ok");
  }

  async alarm(): Promise<void> {
    // Reschedule first — same reasoning as the other two DOs.
    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);

    // Cut over? (durable/cutover.ts — default off.) Real bot, real db: the exact path
    // runGlobalJobs used to run in the cron loop (and now skips — see scheduler.ts).
    const cutOver = await isCutOver(this.env.DB, "global");
    logInfo("do_alarm_run", { doType: "global", cutOver });
    if (cutOver) {
      const bot = new Bot(this.env.TELEGRAM_BOT_TOKEN);
      await runGlobalJobs(this.env.DB, bot);
      return;
    }

    const writes: { sql: string; params: unknown[] }[] = [];
    const shadowEnv: Env = { ...this.env, DB: shadowD1(this.env.DB, (w) => writes.push(w)) };

    const sends: { chatId: number; text: string }[] = [];
    const sender: Sender = {
      api: {
        sendMessage: (async (chatId: number, text: string) => {
          sends.push({ chatId, text });
          return {} as Awaited<ReturnType<Sender["api"]["sendMessage"]>>;
        }) as Sender["api"]["sendMessage"],
      },
    };

    await runGlobalJobs(shadowEnv.DB, sender);

    for (const s of sends) await logDryRun(this.env.DB, "global", GLOBAL_LOG_ENTITY_ID, "send", s);
    for (const w of writes) await logDryRun(this.env.DB, "global", GLOBAL_LOG_ENTITY_ID, "write", w);
  }
}
