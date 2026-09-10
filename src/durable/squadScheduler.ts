// Per-squad Durable Object: one instance per squad chatId (see bot/squad.ts's wake-on-create).
// Mirrors UserSchedulerDO exactly — same dry-run posture, same reasons — for the weekly squad
// recap that used to be a batched cron sweep (postSquadRecaps in scheduler.ts). Alarm fires
// hourly, same as UserSchedulerDO, for like-for-like comparison against the cron path during
// this phase; it only actually acts once the recap hour arrives and the week hasn't been
// recapped yet, exactly the same gate scheduler.ts's own SQUAD_RECAP_HOUR_UTC uses.
import { Bot } from "grammy";
import { deleteSquad, getSquad, logDryRun, markSquadRecapped } from "../db/repos";
import { isCutOver } from "./cutover";
import { postSquadDigest, type DigestWindow, type SquadApi } from "../bot/squad";
import { isoWeekKey, weekRangeOffset, weekStartStr } from "../domain/records";
import type { Env } from "../types";
import { shadowD1 } from "./shadowDb";

const ALARM_INTERVAL_MS = 60 * 60 * 1000;
// Must match scheduler.ts's SQUAD_RECAP_HOUR_UTC — duplicated rather than imported because
// scheduler.ts pulls in the whole app (bot.ts and everything under it) and this DO should not
// have to load that just for one constant. Both are exercised by their own tests; a drift
// between them would show up as the two paths disagreeing during the dry-run comparison.
const SQUAD_RECAP_HOUR_UTC = 9;

export async function wakeSquadScheduler(env: Env, chatId: number): Promise<void> {
  const id = env.SQUAD_SCHEDULER.idFromName(String(chatId));
  const stub = env.SQUAD_SCHEDULER.get(id);
  await stub.fetch(`https://do/wake?chatId=${chatId}`);
}

export class SquadSchedulerDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/wake") return new Response("not found", { status: 404 });
    const chatId = Number(url.searchParams.get("chatId"));
    if (!Number.isFinite(chatId)) return new Response("bad chatId", { status: 400 });
    await this.state.storage.put("chatId", chatId);
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
    return new Response("ok");
  }

  async alarm(): Promise<void> {
    const chatId = await this.state.storage.get<number>("chatId");
    if (typeof chatId !== "number") return;
    // Reschedule first — same reasoning as UserSchedulerDO: nothing below should be able to
    // silently stop this squad's recap forever by throwing before the next alarm is armed.
    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);

    const today = new Date().toISOString().slice(0, 10);
    if (new Date().getUTCHours() < SQUAD_RECAP_HOUR_UTC) return; // not the recap hour yet today

    const squad = await getSquad(this.env.DB, chatId);
    if (!squad) return; // squad deleted/retired since the last wake
    const weekKey = isoWeekKey(today);
    if (squad.lastRecapWeek === weekKey) return; // already recapped this week — nothing to log

    const { from } = weekRangeOffset(today, 1); // Monday of the week that just ended
    const until = weekStartStr(today);
    const win: DigestWindow = { weekStart: from, until, past: true };

    // Cut over? (durable/cutover.ts — default off.) Real bot.api, real db: the exact path
    // postSquadRecaps used to run in the cron loop (and now skips — see scheduler.ts).
    if (await isCutOver(this.env.DB, "squad")) {
      const bot = new Bot(this.env.TELEGRAM_BOT_TOKEN);
      const ok = await postSquadDigest(this.env.DB, bot.api, chatId, win);
      await markSquadRecapped(this.env.DB, chatId, weekKey).catch(() => {});
      if (!ok) await deleteSquad(this.env.DB, chatId).catch(() => {});
      return;
    }

    const writes: { sql: string; params: unknown[] }[] = [];
    const shadowDb = shadowD1(this.env.DB, (w) => writes.push(w));

    const sends: { chatId: number; text: string }[] = [];
    const api: SquadApi = {
      sendMessage: (async (targetChatId: number, text: string) => {
        sends.push({ chatId: targetChatId, text });
        return {} as Awaited<ReturnType<SquadApi["sendMessage"]>>;
      }) as SquadApi["sendMessage"],
    };

    await postSquadDigest(shadowDb, api, chatId, win);
    await markSquadRecapped(shadowDb, chatId, weekKey);

    for (const s of sends) await logDryRun(this.env.DB, "squad", chatId, "send", s);
    for (const w of writes) await logDryRun(this.env.DB, "squad", chatId, "write", w);
  }
}
