// The activation arc: the first 14 days, nudging toward three sessions. Called by processUser.
import { InlineKeyboard } from "grammy";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { ACTIVATION_LAST_DAY, ACTIVATION_TARGET, activationDay, nextActivationStep } from "../domain/activation";
import { t } from "../locales/i18n";
import { HTML } from "./shared";
import type { UserPass } from "./userPass";

export async function activationNudge(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, sent, markSent, sendAndMark } = p;
  let claimed = false;
  const joined = user.createdAt.toISOString().slice(0, 10);
  const dayIndex = activationDay(joined, date);
  if (dayIndex >= 2 && dayIndex <= ACTIVATION_LAST_DAY) {
    markSent("activation"); // one evaluation per day, not one per cron minute
    const done = (await workoutLogsSince(db, user._id, joined)).filter((l) => l.completed).length;
    const nudge = nextActivationStep({ joinedDate: joined, today: date, workouts: done, sentSteps: Object.keys(sent) });
    if (nudge) {
      claimed = true; // this tick's one user-facing message
      const key =
        nudge.step === "act_first" ? "act_first"
        : nudge.step === "act_win" ? "act_win"
        : nudge.step === "act_week" ? (nudge.onTrack ? "act_week_on" : "act_week_behind")
        : nudge.onTrack ? "act_locked_on" : "act_locked_behind";
      const kb = new InlineKeyboard();
      // The behind branches offer a SMALLER commitment, not a louder one: someone missing
      // sessions in week one has too much plan, not too little willpower.
      if (nudge.step === "act_first") kb.text(t(lang, "act_btn_today"), "act:today");
      else if (!nudge.onTrack) kb.text(t(lang, "act_btn_fewer"), "pday:open");
      const text = t(lang, key, { workouts: nudge.workouts, target: ACTIVATION_TARGET, day: nudge.dayIndex });
      const extra = kb.inline_keyboard.length ? { ...HTML, reply_markup: kb } : HTML;
      // The step key is written only on a durable send: each activation beat fires once ever, so
      // marking a dropped one would silently skip that beat for this user permanently.
      await sendAndMark(nudge.step, text, extra);
    }
  }
  return claimed;
}
