// Daily-habit reads for the apps: the wellbeing averages/trend (the bot's /well screen) and the
// evening survey checklist (what is still unlogged today). Both reuse the bot's own functions.
import { dailyCheckinsSince } from "../adapters/d1/v2Tracking";
import { surveyRemaining } from "../features/survey/eveningSurvey";
import { localCutoff, localParts } from "../domain/localTime";
import { wellbeingAverages, wellbeingTrend } from "../domain/wellbeing";
import { miniAppUser } from "./auth";
import type { Env } from "../types";
import { typedFailure } from "./failure";

const NO_STORE = { "cache-control": "no-store" };

export async function handleDailyApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return typedFailure(401, "unauthorized", "unauthorized");
  if (req.method !== "GET") return typedFailure(405, "validation_error", "method not allowed");

  // GET /api/wellbeing: 90-day averages (1-5) and the first-half vs second-half change, as /well shows.
  if (url.pathname === "/api/wellbeing") {
    const checkins = await dailyCheckinsSince(env.DB, user._id, localCutoff(user.profile.timezone, 90));
    const averages = wellbeingAverages(checkins);
    const trend = wellbeingTrend(checkins);
    const round = (n: number) => Number(n.toFixed(1));
    const rounded = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)]));
    return Response.json(
      {
        count: checkins.length,
        averages: averages ? rounded(averages) : null,
        trend: trend ? rounded(trend) : null,
      },
      { headers: NO_STORE },
    );
  }

  // GET /api/survey: today's still-unlogged evening items (food, water, steps, check-in).
  if (url.pathname === "/api/survey") {
    const { date } = localParts(user.profile.timezone);
    const items = await surveyRemaining(env.DB, user, date, user.lang);
    return Response.json({ date, items: items.map(({ key, label }) => ({ key, label })) }, { headers: NO_STORE });
  }

  return typedFailure(404, "not_found", "not found");
}
