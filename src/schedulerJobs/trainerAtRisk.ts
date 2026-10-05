// Trainer at-risk alert: a client missed two planned days in a row or lapsed on food logging.
// Called by processUser for clients with a trainer.
import { InlineKeyboard } from "grammy";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { getUser } from "../adapters/d1/v2Users";
import { nutritionLogsSince } from "../adapters/d1/v2Nutrition";
import { missedConsecutiveWorkouts, nutritionLapse } from "../domain/atrisk";
import { t } from "../locales/i18n";
import { HTML, isoDaysAgo } from "./shared";
import type { UserPass } from "./userPass";

export async function trainerAtRiskAlert(p: UserPass): Promise<void> {
  const { user, db, date, activePlan, sent, markSent, setSent, sendTo, durable } = p;
  markSent("atrisk_check");
  const [wl, nl] = await Promise.all([
    workoutLogsSince(db, user._id, isoDaysAgo(21)),
    nutritionLogsSince(db, user._id, isoDaysAgo(21)),
  ]);
  // Workout at-risk needs an ACTIVE (assigned) plan — a client with only a draft has nothing to
  // follow. Floor the window to the later of plan-start / join date so a new client is never
  // credited with "missing" sessions that predate them (the false-alert bug).
  let missed: [string, string] | null = null;
  if (activePlan?.split.length) {
    const genD = activePlan.generatedAt.toISOString().slice(0, 10);
    const joinD = user.createdAt.toISOString().slice(0, 10);
    const floor = genD > joinD ? genD : joinD;
    missed = missedConsecutiveWorkouts(activePlan.split.map((d) => d.weekday), wl.filter((l) => l.completed).map((l) => l.date), date, floor);
  }
  const lapse = nutritionLapse(nl.map((l) => l.date), date);
  const fireWorkout = missed && sent["atrisk_workout"] !== missed[1];
  const fireNutrition = lapse && sent["atrisk_nutrition"] !== lapse.lastLogged;
  if (fireWorkout || fireNutrition) {
    const trainer = user.trainerId ? await getUser(db, user.trainerId) : null;
    if (trainer) {
      const name = user.profile.name ?? `id ${user._id}`;
      const kb = new InlineKeyboard().text(t(trainer.lang, "cc_message"), `cl:${user._id}:msg`);
      if (fireWorkout) {
        const r = await sendTo(trainer, "atrisk_workout", t(trainer.lang, "atrisk_workout_alert", { name, d1: missed![0], d2: missed![1] }), { ...HTML, reply_markup: kb });
        // Keyed on the miss itself, so a dropped alert re-fires on the next pass rather than
        // being suppressed forever by a 429 the trainer never saw.
        if (durable(r)) setSent("atrisk_workout", missed![1]);
      }
      if (fireNutrition) {
        const r = await sendTo(trainer, "atrisk_nutrition", t(trainer.lang, "atrisk_nutrition_alert", { name, n: lapse!.gapDays }), { ...HTML, reply_markup: kb });
        if (durable(r)) setSent("atrisk_nutrition", lapse!.lastLogged);
      }
    }
  }
}
