// The owner snapshot (counts and windows shared by the text reports), the metrics payload for the
// Mini App console, and the daily error report.
import { aiCallStatsSince, aiTokensByKindSince, aiUsageSince, errorStatsSince, recentErrors } from "../../adapters/d1/v2AiTelemetry";
import { countPlanSourcesSince, engagementSince } from "../../adapters/d1/v2Analytics";
import { countCompletedWorkoutsBetween } from "../../adapters/d1/v2Workouts";
import { planStatusByUser } from "../../adapters/d1/v2Plans";
import { countByRole, countClientsOf, countPendingClientRequests, listTrainerUsers, pendingRequestsAll, pendingTrainerApplications } from "../../adapters/d1/v2Trainer";
import { countActiveSince, countInactive, countModeration, countOnboarded, countUsers, countUsersCreatedSince, getUser, listChurnedUsers } from "../../adapters/d1/v2Users";
import { weekStartStr } from "../../domain/records";
import { escapeHtml } from "../../locales/i18n";
import { share } from "./reportFormat";

// 7/14/30-day windows shared by the owner-report sections.
export function ownerReportWindows() {
  const now = Date.now();
  return {
    since7Iso: new Date(now - 7 * 86_400_000).toISOString(),
    since14Iso: new Date(now - 14 * 86_400_000).toISOString(),
    since30Iso: new Date(now - 30 * 86_400_000).toISOString(),
  };
}

/** The headline numbers behind the overview section, the full report and the Grafana owner feed.
 * Each of those used to run this same set of queries itself (buildOwnerMetrics even said it did not
 * "re-derive" them while repeating all fifteen). Load once, render from it. */
export async function loadOwnerSnapshot(db: D1Database) {
  const { since7Iso, since14Iso, since30Iso } = ownerReportWindows();
  const since7Date = since7Iso.slice(0, 10);
  const nowIsoStr = new Date().toISOString();
  const [trainersCount, clientsCount, pendingApps, pendingReqs, active7, active30, engagement,
    totalUsers, onboarded, new7, moderation, planStatus, churned, inactive7] = await Promise.all([
    countByRole(db, "trainer"),
    countByRole(db, "client"),
    pendingTrainerApplications(db),
    countPendingClientRequests(db),
    countActiveSince(db, since7Iso),
    countActiveSince(db, since30Iso),
    engagementSince(db, since7Date),
    countUsers(db),
    countOnboarded(db),
    countUsersCreatedSince(db, since7Iso),
    countModeration(db),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
    listChurnedUsers(db, since14Iso, since7Iso).catch(() => [] as { id: number; name: string }[]),
    countInactive(db, since7Iso, nowIsoStr).catch(() => 0),
  ]);
  return {
    trainersCount, clientsCount, pendingApps, pendingReqs, active7, active30, engagement,
    totalUsers, onboarded, new7, moderation, churned, inactive7,
    usersWithPlan: [...planStatus.values()].filter((p) => p.active).length,
    // Share of onboarded users active in the last 7 days. NOT retention: retention is the cohort
    // view in orRetention (domain/cohorts.ts), which asks "did people who joined come back".
    activityRate7d: share(active7, onboarded),
  };
}
// Structured counterpart to buildOwnerReport, for the Grafana "owner metrics" dashboard
// (GET /admin/metrics/owner in src/index.ts). Built from the same loadOwnerSnapshot as the text
// report, so the two agree by construction instead of by a hand-kept copy of the queries.
export async function buildOwnerMetrics(db: D1Database) {
  const { since7Iso } = ownerReportWindows();
  const [snap, pendingReqRows] = await Promise.all([loadOwnerSnapshot(db), pendingRequestsAll(db, 20)]);
  const {
    trainersCount, clientsCount, pendingApps, pendingReqs, active7, active30, engagement,
    totalUsers, onboarded, new7, moderation, churned, inactive7, usersWithPlan, activityRate7d,
  } = snap;
  const pendingRequestRows = await Promise.all(
    pendingReqRows.map(async (r) => {
      const [cl, tr] = await Promise.all([getUser(db, r.clientId), getUser(db, r.trainerId)]);
      return {
        client: cl?.profile.name ?? `id ${r.clientId}`,
        trainer: tr?.profile.name ?? `id ${r.trainerId}`,
        note: r.note ?? "",
      };
    }),
  );
  const trainerRows = await Promise.all(
    (await listTrainerUsers(db)).map(async (tr) => ({
      id: tr._id,
      name: tr.profile.name ?? `id ${tr._id}`,
      clients: await countClientsOf(db, tr._id),
    })),
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const thisWkStart = weekStartStr(todayStr);
  const lastWkStart = weekStartStr(new Date(Date.parse(todayStr) - 7 * 86_400_000).toISOString().slice(0, 10));
  const [wkThis, wkLast, usage7, callStats, kindStats7, planSources] = await Promise.all([
    countCompletedWorkoutsBetween(db, thisWkStart, "9999-12-31"),
    countCompletedWorkoutsBetween(db, lastWkStart, thisWkStart),
    aiUsageSince(db, since7Iso),
    aiCallStatsSince(db, since7Iso),
    aiTokensByKindSince(db, since7Iso),
    countPlanSourcesSince(db, since7Iso),
  ]);

  const okBy = new Map<string, number>();
  const failBy = new Map<string, number>();
  for (const u of usage7) {
    const m = u.ok ? okBy : failBy;
    m.set(u.provider, (m.get(u.provider) ?? 0) + 1);
  }
  const providers = [...new Set([...okBy.keys(), ...failBy.keys()])].map((p) => ({
    provider: p, ok: okBy.get(p) ?? 0, fail: failBy.get(p) ?? 0,
  }));

  const totalCalls = callStats.reduce((s, c) => s + c.calls, 0);
  const totalFallbacks = callStats.reduce((s, c) => s + c.fallbacks, 0);
  const totalTokens = callStats.reduce((s, c) => s + c.tokens, 0);

  return {
    generatedAt: new Date().toISOString(),
    people: {
      totalUsers, onboarded, trainers: trainersCount, clients: clientsCount,
      new7d: new7, active7d: active7, active30d: active30,
      activityRate7d,
      pendingTrainerApps: pendingApps.length, pendingClientRequests: pendingReqs,
      churned7to14d: churned.length, inactive7dPlus: inactive7,
      blockedByOwner: moderation.blocked, blockedBot: moderation.botBlocked,
    },
    // Named detail behind the counts above -- who exactly is churned/pending, not just how many.
    attention: {
      churned: churned.map((c) => ({ id: c.id, name: c.name || `id ${c.id}` })),
      pendingTrainerApps: pendingApps.map((a) => ({ trainerId: a.trainerId, name: a.name })),
      pendingClientRequests: pendingRequestRows,
    },
    trainers: trainerRows,
    training7d: {
      workouts: engagement.workouts, workoutsCompleted: engagement.completed,
      checkins: engagement.checkins, nutritionLogs: engagement.nutrition,
      usersWithActivePlan: usersWithPlan,
      workoutsThisWeek: wkThis, workoutsLastWeek: wkLast,
    },
    ai7d: {
      byProvider: providers,
      byTask: kindStats7.map((k) => ({ kind: k.kind, calls: k.calls, tokens: k.tokens })),
      totalCalls, totalFallbacks, totalTokens,
      fallbackPct: totalCalls ? Math.round((totalFallbacks / totalCalls) * 100) : 0,
      planSource: planSources.map((s) => ({ kind: s.kind, source: s.source, n: s.c })),
    },
  };
}

// Daily AI-error report for the owner — last 24h only. Returns null when there were no errors
// (so the owner isn't pinged on clean days). Mirrors the error block that used to live in the
// weekly owner report, but on a 1-day window sent every day.
export async function buildErrorReport(db: D1Database): Promise<string | null> {
  const since1Iso = new Date(Date.now() - 86_400_000).toISOString();
  const [errStats, errSamples, callStats] = await Promise.all([
    errorStatsSince(db, since1Iso).catch(() => []),
    recentErrors(db, since1Iso, 8).catch(() => []),
    aiCallStatsSince(db, since1Iso).catch(() => []),
  ]);
  if (!errStats.length) return null;

  const total = errStats.reduce((s, e) => s + e.n, 0);
  const byType: Record<string, number> = {};
  for (const e of errStats) byType[e.errorType] = (byType[e.errorType] ?? 0) + e.n;
  const lines = [
    `🐞 <b>AI errors (24h): ${total}</b>`,
    "• by type: " + Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(" · "),
    "• by task: " + errStats.slice(0, 6).map((e) => `${e.kind}/${e.errorType} ${e.n}`).join(", "),
  ];
  if (callStats.length) {
    const totalCalls = callStats.reduce((s, c) => s + c.calls, 0);
    const totalFallbacks = callStats.reduce((s, c) => s + c.fallbacks, 0);
    const fallbackPct = totalCalls ? Math.round((totalFallbacks / totalCalls) * 100) : 0;
    lines.push(`• AI calls (24h): ${totalCalls} · fallback rate ${fallbackPct}%`);
  }
  for (const e of errSamples) {
    lines.push(`  ${e.ts.slice(11, 16)} ${escapeHtml(e.kind)}/${escapeHtml(e.errorType)}: ${escapeHtml((e.message ?? "").slice(0, 80))}`);
  }
  return lines.join("\n");
}
