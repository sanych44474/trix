// Vacation ended -> run the comeback interview once: send the opener with its first (free-text)
// question, and only then put the user in `comeback` mode; their replies are handled by the
// normal bot flow. Split out of scheduler.ts's runScheduleInner so the delivery rule is testable.
import type { Env, UserDoc } from "../types";
import type { Sender } from "./shared";
import { listVacationEnded, markComebackDone, updateUser } from "../adapters/d1/v2Users";
import { notificationStatus } from "../adapters/d1/v2Notifications";
import { afterDelivery } from "../domain/notificationDelivery";
import { notify } from "../notify";
import { HTML, logSchedulerError } from "./shared";
import { t } from "../locales/i18n";

export async function runComebackOpeners(env: Env, bot: Sender, db: D1Database = env.DB, now: Date = new Date()): Promise<void> {
  const nowIso = now.toISOString();
  const ended = await listVacationEnded(db, nowIso).catch(() => [] as UserDoc[]);
  for (const u of ended) {
    if (u.blocked || u.botBlocked) {
      await markComebackDone(db, u._id, nowIso).catch(() => {});
      continue;
    }
    try {
      // Deliver BEFORE committing the state change. The old order marked the interview done and
      // put the user in `comeback` mode first, so a failed send left them parked in a mode whose
      // opening question they never saw -- their next message was then read as an answer to a
      // question the bot never asked. Enqueue-and-deliver also means a transient failure retries
      // from the outbox instead of being lost, and an un-marked user is simply picked up again on
      // the next tick (a duplicate opener being the worst case, not a silent dead end).
      const key = `${nowIso.slice(0, 10)}:comeback:${u._id}`;
      const delivered = await notify(env, bot, { userId: u._id, chatId: u.chatId }, {
        kind: "comeback_opener",
        key,
        text: `${t(u.lang, "vacation_ended")}\n\n${t(u.lang, "comeback_q_feel")}`,
        extra: HTML,
      });
      // The interview starts only once its first question has reached them. A retry in flight
      // waits for a later tick; a "duplicate" is judged by what happened to the first attempt (a
      // permanently failed opener used to come back as "duplicate" and park them anyway).
      const existing = delivered === "duplicate" ? await notificationStatus(db, u._id, key).catch(() => null) : null;
      const next = afterDelivery(delivered, existing);
      if (next === "wait") continue;
      if (next === "commit") await updateUser(db, u._id, { session: { mode: "comeback", comeback: { step: 0, answers: {} } } });
      // Committed, or it will never arrive (muted, blocked, failed): either way this comeback is over.
      await markComebackDone(db, u._id, nowIso);
    } catch (err) {
      logSchedulerError(db, "comeback_opener", err, u._id);
    }
  }
}
