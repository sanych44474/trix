// Accountability buddy detail: the paired partner's progress (level/XP/streak), this week's
// workouts, and their active plan. Both users opted in by pairing, so sharing is consented.
import { getActivePlan, getUser, userStatCounts, workoutLogsSince } from "../db/repos";
import { computeXp, levelFromXp } from "../domain/gamification";
import { weekStartStr, weekStreak } from "../domain/records";
import { localParts } from "../domain/progression";
import { miniAppUser } from "./auth";
import type { Env } from "../types";

export async function handleBuddyApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const buddyId = user.profile.buddyId;
  if (!buddyId) return Response.json({ buddy: null }, { headers: { "cache-control": "no-store" } });
  const mate = await getUser(env.DB, buddyId).catch(() => null);
  if (!mate) return Response.json({ buddy: null }, { headers: { "cache-control": "no-store" } });

  const today = localParts(user.profile.timezone).date;
  const wkStart = weekStartStr(today);
  const cutoff = new Date(Date.parse(today) - 120 * 86_400_000).toISOString().slice(0, 10);
  const [counts, plan, buddyLogs, myLogs] = await Promise.all([
    userStatCounts(env.DB, mate._id),
    getActivePlan(env.DB, mate._id).catch(() => null),
    workoutLogsSince(env.DB, mate._id, cutoff).catch(() => []),
    workoutLogsSince(env.DB, user._id, wkStart).catch(() => []),
  ]);

  const buddyDone = buddyLogs.filter((l) => l.completed);
  const lv = levelFromXp(computeXp(counts));
  const streak = weekStreak(buddyDone.map((l) => l.date), today, mate.reminders?.lastVacation);
  const wkDone = buddyDone.filter((l) => l.date >= wkStart);
  // This week's sessions (date + up to 4 exercise names) and the plan split summary.
  const week = wkDone
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((l) => ({ date: l.date, ex: (l.exercises ?? []).filter((e) => !e.skipped).map((e) => e.name).slice(0, 4) }));
  const planDays = (plan?.split ?? []).map((d) => ({ weekday: d.weekday, group: d.muscleGroup, n: d.exercises.length }));

  return Response.json(
    {
      buddy: {
        name: mate.profile.name ?? "Buddy",
        level: lv.level,
        xp: lv.xp,
        intoLevel: lv.intoLevel,
        needed: lv.needed,
        streak,
        weekWorkouts: wkDone.length,
        myWeekWorkouts: myLogs.filter((l) => l.completed).length,
        week,
        plan: planDays,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
