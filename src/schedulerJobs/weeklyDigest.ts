// The Sunday digest: the week's workouts, food, steps and weight, the muscle week with its badges
// and body-map picture, and next week's quests. Called by processUser (scheduler.ts); returns true
// when it sent something (one user-facing message per tick).
import { appKeyboard } from "../notify/appKeyboard";
import { isoDateMinus } from "../features/gamification/boards";
import type { Env, Lang, UserDoc } from "../types";
import { listStrength, workoutLogsSince } from "../adapters/d1/v2Workouts";
import { awardAchievement } from "../adapters/d1/v2Gamification";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { bodyLogsByUser, stepLogsSince } from "../adapters/d1/v2Tracking";
import { updateUser } from "../adapters/d1/v2Users";
import { nutritionLogsSince } from "../adapters/d1/v2Nutrition";
import { recentPrCount } from "../domain/records";
import { nextBalanceStreak, weeklyReport } from "../domain/weeklyReport";
import { pickQuests, plannedDayCount } from "../domain/quests";
import { toLoggedDays } from "../domain/recoverySwap";
import { weekMapUrl } from "../webapp/weekMap";
import { t } from "../locales/i18n";
import { renderQuestLines, renderWeeklyMuscleLines } from "../render";
import { HTML, isoDaysAgo } from "./shared";
import type { Sender } from "./shared";

export interface WeeklyDigestCtx {
  env: Env;
  db: D1Database;
  user: UserDoc;
  lang: Lang;
  date: string;
  botBlocked: boolean;
  markSent: (key: string) => void;
  sendAndMark: (key: string, text: string, extra?: Parameters<Sender["api"]["sendMessage"]>[2]) => Promise<unknown>;
}

export async function weeklyDigest(p: WeeklyDigestCtx): Promise<boolean> {
  const { env, db, user, lang, date, botBlocked, markSent, sendAndMark } = p;
  const since = isoDaysAgo(7);
  const [wl, nl, sl, body] = await Promise.all([
    workoutLogsSince(db, user._id, since),
    nutritionLogsSince(db, user._id, since),
    stepLogsSince(db, user._id, since),
    bodyLogsByUser(db, user._id),
  ]);
  const doneN = wl.filter((w) => w.completed).length;
  if (doneN || nl.length) {
    const parts: string[] = [t(lang, "wdigest_header")];
    parts.push(t(lang, "wdigest_workouts", { n: doneN }));
    if (nl.length) {
      const avgKcal = Math.round(nl.reduce((s, n) => s + n.meals.reduce((m, x) => m + (x.kcal || 0), 0), 0) / nl.length);
      parts.push(t(lang, "wdigest_nutrition", { kcal: avgKcal, n: nl.length }));
    }
    if (sl.length) parts.push(t(lang, "wdigest_steps", { avg: Math.round(sl.reduce((s, l) => s + l.steps, 0) / sl.length) }));
    const recentBody = body.filter((b) => typeof b.weight === "number" && b.weight! > 0).slice(-2);
    if (recentBody.length === 2) {
      const d = +(recentBody[1].weight! - recentBody[0].weight!).toFixed(1);
      parts.push(t(lang, "wdigest_weight", { w: recentBody[1].weight!, delta: d > 0 ? `+${d}` : `${d}` }));
    }
    // The muscle week (domain/weeklyReport.ts): balance score, what lagged, records, one focus,
    // and the badges it earns -- plus the body map as the digest's picture.
    const report = weeklyReport(toLoggedDays(wl), since);
    let photoUrl: string | null = null;
    if (report.trainedSets > 0) {
      const newBadges: string[] = [];
      const award = async (code: string) => { if (await awardAchievement(db, user._id, code).catch(() => false)) newBadges.push(code); };
      if (report.fullBody) await award("full_body_week");
      if (report.allInRange) await award("all_in_range");
      const balanceWeeks = nextBalanceStreak(user.reminders?.balanceWeeks, report.allInRange);
      if (balanceWeeks >= 4) await award("balance_streak_4");
      user.reminders = { ...user.reminders, balanceWeeks };
      await updateUser(db, user._id, { reminders: user.reminders }).catch(() => {});
      const prs = recentPrCount(await listStrength(db, user._id).catch(() => []), since);
      parts.push("", ...renderWeeklyMuscleLines(lang, report, prs, newBadges));
      photoUrl = await weekMapUrl(env.WORKER_URL, user.profile.sex, report.zones, env.TELEGRAM_BOT_TOKEN).catch(() => null);
    }
    // Next week's quests (domain/quests.ts): the same pick the Mini App's Today card will show
    // from Monday, so the digest's promise and the app agree.
    const nextMonday = isoDateMinus(date, -1);
    const plan = await getActivePlan(db, user._id).catch(() => null);
    const quests = pickQuests(nextMonday, toLoggedDays(wl), plannedDayCount(user.profile.trainingWeekdays, plan?.split));
    parts.push("", ...renderQuestLines(lang, quests));
    const kb = appKeyboard(env, [[
      { text: t(lang, "menu_progress"), view: "progress", fallback: "menu:progress" },
      { text: t(lang, "wcard_btn"), view: "more", fallback: "share:week" },
    ]]);
    // With a picture: Telegram fetches the map from the signed link (drawn in its own request),
    // the text rides as the caption. Any failure there falls back to the plain text digest.
    let sentAsPhoto = false;
    if (photoUrl && !botBlocked) {
      sentAsPhoto = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: user.chatId, photo: photoUrl, caption: parts.join("\n").slice(0, 1024), parse_mode: "HTML", ...(kb ? { reply_markup: { inline_keyboard: kb.inline_keyboard } } : {}) }),
      })
        .then(async (res) => res.ok && ((await res.json()) as { ok?: boolean }).ok === true)
        .catch(() => false);
      if (sentAsPhoto) markSent("digest");
    }
    if (!sentAsPhoto) await sendAndMark("digest", parts.join("\n"), kb ? { ...HTML, reply_markup: kb } : HTML);
    return true;
  }
  return false;
}
