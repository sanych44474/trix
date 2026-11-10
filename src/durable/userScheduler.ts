// Per-user Durable Object: one instance per userId (see bot/router.ts's wake-on-create and
// settings handlers). Its alarm fires hourly and runs processUser (src/scheduler.ts) for that one
// user, in its own invocation with its own 50-subrequest budget, decoupled from every other
// user's. That decoupling is the entire reason this exists (see docs/features.md's scheduler
// notes). Nothing else runs a user's reminders (ADR-0015). The alarm runs at hh:01
// (domain/alarmTiming.ts) so hour-exact slots are not skipped by drift.
import { DurableObject } from "cloudflare:workers";
import { loadLearnedMuscles } from "../features/exercise/muscleLearning";
import { Bot } from "grammy";
import { botClientOptions } from "../adapters/telegram/rawApi";
import { getUser } from "../adapters/d1/v2Users";
import { buildSinglePass, processUser } from "../scheduler";
import { logSchedulerError } from "../schedulerJobs/shared";
import type { Env } from "../types";
import { logInfo, runWithRequestId } from "../log";
import { nextHourlyAlarm } from "../domain/alarmTiming";

// processUser's internal gates (reminderHour, already(), daysBetween(...)) decide whether anything
// fires on a given hour.

export class UserSchedulerDO extends DurableObject<Env> {
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
    await this.ctx.storage.put("userId", userId);
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
    const userId = await this.ctx.storage.get<number>("userId");
    if (typeof userId !== "number") return; // woken without an id somehow — nothing to do

    // Reschedule FIRST, before any work that could throw. This is deliberate: the bug that
    // motivated this whole design (scheduler.ts's markSent-before-send finding) was exactly a
    // dedup key getting written independent of whether the thing it guards actually happened.
    // The equivalent failure mode here would be an alarm that silently stops recurring because
    // something downstream threw — reschedule can't be conditional on the rest of this succeeding.
    await this.ctx.storage.setAlarm(nextHourlyAlarm(Date.now()));

    const user = await getUser(this.env.DB, userId);
    if (!user) return; // account deleted since the last wake

    logInfo("do_alarm_run", { doType: "user" });
    // An exception thrown straight out of alarm() only reaches Workers Logs. Logging it here puts
    // it in error_logs and the owner report.
    const bot = new Bot(this.env.TELEGRAM_BOT_TOKEN, botClientOptions);
    const pass = await buildSinglePass(this.env.DB, userId);
    await processUser(this.env, bot, user, pass).catch((err) => logSchedulerError(this.env.DB, "schedule_user", err, userId));
  }
}
