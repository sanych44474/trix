// Singleton Durable Object for the account-wide jobs (owner alerts, leaderboard cache,
// telemetry pruning) — always exactly one instance, addressed by a fixed name. These jobs are
// not what the whole per-user/per-squad DO redesign was solving (none of them touch the
// per-invocation subrequest ceiling: an owner alert is at most one send, the rest is pure D1);
// this exists for design consistency with the other two DO types, not because it fixes a
// problem specific to these jobs. Nothing else runs them (ADR-0015).
import { DurableObject } from "cloudflare:workers";
import { loadLearnedMuscles } from "../features/exercise/muscleLearning";
import { Bot } from "grammy";
import { botClientOptions } from "../adapters/telegram/rawApi";
import { logSchedulerError } from "../schedulerJobs/shared";
import { runGlobalJobs } from "../schedulerJobs/global";
import type { Env } from "../types";
import { logInfo, runWithRequestId } from "../log";
import { nextHourlyAlarm } from "../domain/alarmTiming";

export class GlobalSchedulerDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/wake") return new Response("not found", { status: 404 });
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(nextHourlyAlarm(Date.now()));
    }
    return new Response("ok");
  }

  // Thin wrapper so logInfo's Analytics Engine write (src/log.ts) has this.env to reach for --
  // the DO's own alarm() never went through runWithRequestId the way fetch()/scheduled() do.
  async alarm(): Promise<void> {
    await loadLearnedMuscles(this.env.DB).catch(() => {}); // the digest and quests count learned exercises too
    return runWithRequestId(crypto.randomUUID(), this.env, () => this.runAlarm());
  }

  private async runAlarm(): Promise<void> {
    // Reschedule first — same reasoning as the other two DOs.
    await this.ctx.storage.setAlarm(nextHourlyAlarm(Date.now()));

    logInfo("do_alarm_run", { doType: "global" });
    // runGlobalJobs catches each of its own sub-jobs. This is defense in depth, so an unexpected
    // exception still reaches error_logs and the owner report, not only Workers Logs.
    const bot = new Bot(this.env.TELEGRAM_BOT_TOKEN, botClientOptions);
    await runGlobalJobs(this.env.DB, bot, this.env).catch((err) => logSchedulerError(this.env.DB, "global_jobs", err));
  }
}
