// Strava connection: OAuth, token refresh, activity sync into the workout log. `fetchImpl` is
// injectable so test/strava.test.ts drives the whole flow against a fake Strava.
//
// Sync rules: only activities after the later of (last sync - 1 day, now - 30 days) are fetched;
// each becomes one cardio exercise on its local date (domain/strava.ts); a day that already has a
// log keeps everything in it and gets the new cardio appended; imported ids are remembered, so a
// run is never added twice. A day created only from Strava is a completed session, same as cardio
// logged from the bot's own menu.
import { planImport, type StravaActivity } from "../../domain/strava";
import { getWorkoutLog, upsertWorkoutLog } from "../../adapters/d1/v2Workouts";
import {
  deleteStravaLink, getStravaLink, importedActivityIds, markStravaSync, recordImportedActivities,
  saveStravaLink, updateStravaTokens, type StravaTokens,
} from "../../adapters/d1/v2Strava";
import type { DB } from "../../adapters/d1/shared";
import type { Lang, Weekday } from "../../types";

export interface StravaConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Fetch = typeof fetch;

const API = "https://www.strava.com/api/v3";
const OAUTH = "https://www.strava.com/oauth";
const LOOKBACK_MS = 30 * 86_400_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 3; // a first sync of a very active month; anything older stays out

export function authorizeUrl(cfg: StravaConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read",
    state,
  });
  return `${OAUTH}/authorize?${q}`;
}

interface TokenResponse { access_token: string; refresh_token: string; expires_at: number; athlete?: { id: number } }

async function tokenRequest(cfg: StravaConfig, body: Record<string, string>, fetchImpl: Fetch): Promise<TokenResponse> {
  const res = await fetchImpl(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
  });
  if (!res.ok) throw new Error(`strava_token_${res.status}`);
  return (await res.json()) as TokenResponse;
}

const toTokens = (t: TokenResponse): StravaTokens => ({ access: t.access_token, refresh: t.refresh_token, expiresAt: t.expires_at });

/** OAuth callback: exchange the code and store the link. Requires the activity:read scope. */
export async function connectStrava(db: DB, cfg: StravaConfig, accountId: number, code: string, grantedScope: string, fetchImpl: Fetch = fetch): Promise<void> {
  if (!grantedScope.split(",").includes("activity:read") && !grantedScope.split(",").includes("activity:read_all")) throw new Error("strava_scope");
  const t = await tokenRequest(cfg, { code, grant_type: "authorization_code" }, fetchImpl);
  if (!t.athlete?.id) throw new Error("strava_no_athlete");
  await saveStravaLink(db, accountId, t.athlete.id, toTokens(t), cfg.clientSecret);
}

async function freshTokens(db: DB, cfg: StravaConfig, accountId: number, tokens: StravaTokens, fetchImpl: Fetch, now: number): Promise<StravaTokens> {
  if (tokens.expiresAt * 1000 > now + 5 * 60_000) return tokens;
  const next = toTokens(await tokenRequest(cfg, { refresh_token: tokens.refresh, grant_type: "refresh_token" }, fetchImpl));
  await updateStravaTokens(db, accountId, next, cfg.clientSecret);
  return next;
}

async function listActivities(access: string, afterSec: number, fetchImpl: Fetch): Promise<StravaActivity[]> {
  const out: StravaActivity[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchImpl(`${API}/athlete/activities?after=${afterSec}&per_page=${PAGE_SIZE}&page=${page}`, { headers: { Authorization: `Bearer ${access}` } });
    if (res.status === 401) throw new Error("strava_unauthorized");
    if (res.status === 429) throw new Error("strava_rate_limited");
    if (!res.ok) throw new Error(`strava_activities_${res.status}`);
    const batch = (await res.json()) as StravaActivity[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

function isoWeekdayOf(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (d === 0 ? 7 : d) as Weekday;
}

export interface SyncResult { imported: number; days: number }

/** Pulls new activities into the log. Records the outcome on the link either way. */
export async function syncStrava(db: DB, cfg: StravaConfig, accountId: number, lang: Lang, fetchImpl: Fetch = fetch, now = Date.now()): Promise<SyncResult> {
  const link = await getStravaLink(db, accountId, cfg.clientSecret);
  if (!link) throw new Error("strava_not_linked");
  try {
    const tokens = await freshTokens(db, cfg, accountId, link.tokens, fetchImpl, now);
    const since = Math.max(now - LOOKBACK_MS, link.lastSyncAt ? Date.parse(link.lastSyncAt) - 86_400_000 : 0);
    const activities = await listActivities(tokens.access, Math.floor(since / 1000), fetchImpl);
    const seen = await importedActivityIds(db, accountId, activities.map((a) => a.id));
    const plan = planImport(activities, seen, lang);
    let imported = 0;
    for (const [date, items] of plan) {
      const existing = await getWorkoutLog(db, accountId, date);
      const exercises = [...(existing?.exercises ?? []), ...items.map((i) => i.exercise)];
      await upsertWorkoutLog(db, accountId, date, existing?.weekday ?? isoWeekdayOf(date), exercises, true, existing?.notes);
      await recordImportedActivities(db, accountId, items.map((i) => ({ activityId: i.activityId, date })));
      imported += items.length;
    }
    await markStravaSync(db, accountId, null);
    return { imported, days: plan.size };
  } catch (err) {
    await markStravaSync(db, accountId, err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}

/** Revokes the app's access on Strava's side (best effort) and forgets the tokens. */
export async function disconnectStrava(db: DB, cfg: StravaConfig, accountId: number, fetchImpl: Fetch = fetch): Promise<void> {
  const link = await getStravaLink(db, accountId, cfg.clientSecret).catch(() => null);
  if (link) {
    await fetchImpl(`${OAUTH}/deauthorize`, { method: "POST", headers: { Authorization: `Bearer ${link.tokens.access}` } }).catch(() => null);
  }
  await deleteStravaLink(db, accountId);
}
