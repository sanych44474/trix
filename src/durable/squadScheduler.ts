// Per-squad Durable Object: one instance per squad chatId (see bot/squad.ts's wake-on-create).
// It posts the weekly squad recap. The alarm fires hourly, like UserSchedulerDO's, and acts once
// the recap hour has arrived and the week has not been recapped yet. Nothing else posts recaps
// (ADR-0015).
import { DurableObject } from "cloudflare:workers";
import { Bot } from "grammy";
import { botClientOptions } from "../adapters/telegram/rawApi";
import { deleteSquad, getSquad, markSquadRecapped } from "../adapters/d1/v2Gamification";
import { logSchedulerError } from "../schedulerJobs/shared";
import { postSquadDigest, type DigestWindow } from "../features/squad/digest";
import { isoWeekKey, weekRangeOffset, weekStartStr } from "../domain/records";
import type { Env } from "../types";
import { logInfo, runWithRequestId } from "../log";
import { nextHourlyAlarm } from "../domain/alarmTiming";

// Squad recaps go to GROUP chats, which have no timezone of their own — a single sensible UTC
// hour is the honest answer (09:00 UTC = noon in Kyiv, morning across Europe).
const SQUAD_RECAP_HOUR_UTC = 9;

export class SquadSchedulerDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/wake") return new Response("not found", { status: 404 });
    const chatId = Number(url.searchParams.get("chatId"));
    if (!Number.isFinite(chatId)) return new Response("bad chatId", { status: 400 });
    await this.ctx.storage.put("chatId", chatId);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(nextHourlyAlarm(Date.now()));
    }
    return new Response("ok");
  }

  // Thin wrapper so logInfo's Analytics Engine write (src/log.ts) has this.env to reach for --
  // the DO's own alarm() never went through runWithRequestId the way fetch()/scheduled() do.
  async alarm(): Promise<void> {
    return runWithRequestId(crypto.randomUUID(), this.env, () => this.runAlarm());
  }

  private async runAlarm(): Promise<void> {
    const chatId = await this.ctx.storage.get<number>("chatId");
    if (typeof chatId !== "number") return;
    // Reschedule first — same reasoning as UserSchedulerDO: nothing below should be able to
    // silently stop this squad's recap forever by throwing before the next alarm is armed.
    await this.ctx.storage.setAlarm(nextHourlyAlarm(Date.now()));

    const today = new Date().toISOString().slice(0, 10);
    if (new Date().getUTCHours() < SQUAD_RECAP_HOUR_UTC) return; // not the recap hour yet today

    const squad = await getSquad(this.env.DB, chatId);
    if (!squad) return; // squad deleted/retired since the last wake
    const weekKey = isoWeekKey(today);
    if (squad.lastRecapWeek === weekKey) return; // already recapped this week — nothing to log

    const { from } = weekRangeOffset(today, 1); // Monday of the week that just ended
    const until = weekStartStr(today);
    const win: DigestWindow = { weekStart: from, until, past: true };

    logInfo("do_alarm_run", { doType: "squad" });
    // Without the catch an exception here would only reach Workers Logs, not error_logs or the
    // owner report.
    try {
      const bot = new Bot(this.env.TELEGRAM_BOT_TOKEN, botClientOptions);
      const ok = await postSquadDigest(this.env.DB, bot.api, chatId, win);
      // Marked either way: a chat that is merely unreachable this hour must not be retried every
      // hour for the rest of the week.
      await markSquadRecapped(this.env.DB, chatId, weekKey).catch(() => {});
      // A chat that rejects the message (bot kicked, group deleted) is dropped — that is the only
      // automatic squad deletion there is.
      if (!ok) await deleteSquad(this.env.DB, chatId).catch(() => {});
    } catch (err) {
      // accountId has a real FK to v2_accounts -- chatId (a Telegram group id) would violate
      // it and be silently dropped by logSchedulerError's own .catch(). createdBy is squad
      // creation's actual v2_accounts.id, so it both satisfies the FK and gives owner-report a
      // real person to attribute the failure to.
      logSchedulerError(this.env.DB, "squad_recaps", err, squad.createdBy ?? undefined);
    }
  }
}
