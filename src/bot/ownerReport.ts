// The owner report: overview, engagement, retention, AI, trainers, onboarding, errors and users
// sections, the metrics JSON and the error digest, plus their text-chart helpers. Split out of
// owner.ts; owner.ts re-exports everything here.
import type { Env } from "../types";
import { aiCallStatsSince, aiTokensByKindSince, aiUsageSince, cohortMembersSince, countAdjustmentsSince, countPlanSourcesSince, dailyActiveUsers, engagementSince, errorStatsSince, eventCountsByUser, eventStatsSince, listUsersBrief, recentAudit, recentErrors, recentFeedback } from "../adapters/d1/v2Admin";
import { countCompletedWorkoutsBetween } from "../adapters/d1/v2Workouts";
import { planStatusByUser } from "../adapters/d1/v2Plans";
import { countByRole, countClientsOf, countPendingClientRequests, listTrainerUsers, pendingRequestsAll, pendingTrainerApplications } from "../adapters/d1/v2Trainer";
import { countActiveSince, countInactive, countModeration, countOnboarded, countUsers, countUsersCreatedSince, getUser, listChurnedUsers, listOnboardingUsers, listPlanPendingUsers, nonOnboardedByMode } from "../adapters/d1/v2Users";
import { weekStartStr } from "../domain/records";
import { biggestDrop, cohortRetention, RETENTION_WEEKS } from "../domain/cohorts";
import { escapeHtml } from "../locales/i18n";
import { splitKeys } from "../ai/errors";
import { obSteps } from "../bot";
import { interviewProgress, OwnerUserRow } from "./owner";

// Telegram renders no real tables — a monospace <pre> block with space-aligned columns is the
// only table-like option. First column left-aligned (labels), the rest right-aligned (numbers).
export function monoTable(headers: string[], rows: (string | number)[][]): string {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (cells: (string | number)[]) =>
    cells.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join("  ");
  const sep = w.map((n) => "-".repeat(n)).join("  ");
  return `<pre>${escapeHtml([fmt(headers), sep, ...rows.map(fmt)].join("\n"))}</pre>`;
}

// Visual helpers for report sections. Telegram renders no CSS/tables — unicode does the work:
// ▰▱ progress bars for shares, ▁▂▃▄▅▆▇█ sparklines for day-by-day trends.
export function pctBar(part: number, total: number, width = 10): string {
  const ratio = total > 0 ? Math.max(0, Math.min(1, part / total)) : 0;
  const filled = Math.round(ratio * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function sparkline(values: number[]): string {
  if (!values.length) return "";
  const chars = "▁▂▃▄▅▆▇█";
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(chars.length - 1, Math.round((v / max) * (chars.length - 1)))]).join("");
}

export const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

// Ranked list with proportional bars: `  42 ▇▇▇▇▇▇▇▇ menu:today` — reads faster than a
// two-column count table when the point is "what dominates".
export function barList(rows: { label: string; n: number }[], maxBar = 8): string {
  const top = Math.max(...rows.map((r) => r.n), 1);
  const w = Math.max(...rows.map((r) => String(r.n).length));
  const lines = rows.map((r) => {
    const bar = "▇".repeat(Math.max(1, Math.round((r.n / top) * maxBar)));
    return `${String(r.n).padStart(w)} ${bar.padEnd(maxBar)} ${r.label}`;
  });
  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
}

// 7/14/30-day windows shared by the owner-report sections.
export function ownerReportWindows() {
  const now = Date.now();
  return {
    since7Iso: new Date(now - 7 * 86_400_000).toISOString(),
    since14Iso: new Date(now - 14 * 86_400_000).toISOString(),
    since30Iso: new Date(now - 30 * 86_400_000).toISOString(),
  };
}

// 📊 Overview: trainers/clients summary + 7-day engagement KPIs (carries the report header).
export async function orOverview(db: D1Database): Promise<string> {
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
  const usersWithPlan = [...planStatus.values()].filter((p) => p.active).length;
  const retentionPct = share(active7, onboarded);
  const todayStr = new Date().toISOString().slice(0, 10);
  const thisWkStart = weekStartStr(todayStr);
  const lastWkStart = weekStartStr(new Date(Date.parse(todayStr) - 7 * 86_400_000).toISOString().slice(0, 10));
  const [wkThis, wkLast, dauRows] = await Promise.all([
    countCompletedWorkoutsBetween(db, thisWkStart, "9999-12-31"),
    countCompletedWorkoutsBetween(db, lastWkStart, thisWkStart),
    dailyActiveUsers(db, since7Date).catch(() => [] as { date: string; n: number }[]),
  ]);
  const wkArrow = wkThis > wkLast ? "↑" : wkThis < wkLast ? "↓" : "→";
  // DAU day-by-day for the last 7 calendar days (missing days = 0, so the sparkline is honest).
  const dauBy = new Map(dauRows.map((d) => [d.date, d.n]));
  const days: number[] = [];
  for (let i = 6; i >= 0; i--) days.push(dauBy.get(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)) ?? 0);
  const dauPeak = Math.max(...days, 0);

  // Attention block: only real action items; each line says what to DO about it.
  const attention: string[] = [];
  if (pendingApps.length) attention.push(`• 🧑‍🏫 Trainer application(s): <b>${pendingApps.length}</b> — see 🧑‍🏫 Trainers section`);
  if (pendingReqs) attention.push(`• 📥 Pending client request(s): <b>${pendingReqs}</b>`);
  if (churned.length) attention.push(`• 📉 Churn risk (quiet 7–14d): <b>${churned.length}</b> — ${churned.slice(0, 5).map((c) => escapeHtml(c.name || `id ${c.id}`)).join(", ")}${churned.length > 5 ? "…" : ""}`);
  if (inactive7 > 0) attention.push(`• 💤 Inactive 7d+ (solo): <b>${inactive7}</b> → /cleanup`);
  if (moderation.blocked || moderation.botBlocked) attention.push(`• 🚫 Blocked: by owner <b>${moderation.blocked}</b> · bot blocked by user <b>${moderation.botBlocked}</b>`);

  return [
    `🛠 <b>TRIX — owner report</b>`,
    `📅 ${todayStr} · ${new Date().toISOString().slice(11, 16)} UTC · window 7d`,
    // At-a-glance TL;DR so the whole report's gist lands in one line before the detail.
    `🧭 <b>${onboarded}</b> onboarded · <b>${active7}</b> active 7d · <b>${wkThis}</b> workouts this wk ${wkArrow} · ${attention.length ? `⚠️ <b>${attention.length}</b> to review` : "✅ all clear"}`,
    "",
    "👥 <b>People</b>",
    `${pctBar(onboarded, totalUsers)} onboarded <b>${onboarded}</b>/${totalUsers} (${share(onboarded, totalUsers)}%)`,
    `• New 7d: <b>+${new7}</b> · Trainers <b>${trainersCount}</b> · Clients <b>${clientsCount}</b>`,
    `• Active: 7d <b>${active7}</b> · 30d <b>${active30}</b> · retention 7d/onb <b>${retentionPct}%</b>`,
    `• DAU 7d: <code>${sparkline(days)}</code> peak ${dauPeak}`,
    `🔻 ${totalUsers} → ${onboarded} onboarded → ${active7} active 7d`,
    "",
    "🏋️ <b>Training (7d)</b>",
    `• Workouts <b>${engagement.workouts}</b> · done ${engagement.workouts ? share(engagement.completed, engagement.workouts) : 0}% · this wk <b>${wkThis}</b> ${wkArrow} (prev ${wkLast})`,
    `• Check-ins <b>${engagement.checkins}</b> · Nutrition logs <b>${engagement.nutrition}</b>`,
    `${pctBar(usersWithPlan, onboarded)} active plan <b>${usersWithPlan}</b>/${onboarded}`,
    "",
    attention.length ? `⚠️ <b>Attention (${attention.length})</b>\n${attention.join("\n")}` : "✅ <b>All clear</b> — nothing pending, nobody stuck.",
  ].join("\n");
}

// 📊 Usage events (7d), split into real-user activity vs owner/admin actions (from event_counts).
export async function orEngagement(db: D1Database): Promise<string> {
  const { since7Iso } = ownerReportWindows();
  const rows = await eventStatsSince(db, since7Iso.slice(0, 10), 120).catch(() => [] as { event: string; n: number }[]);
  if (!rows.length) return "📊 <b>Usage events (7d)</b>\nNo events recorded yet.";
  const isAdmin = (e: string) => /^(orep|ou|clean)/.test(e) || e === "menu:ownerreport" || e === "menu:users";
  // Mini App feature counters (app_*, POST /api/v2/event) get their own block: they answer "is
  // this feature used at all", which the bot's tap list buries.
  const isApp = (e: string) => e.startsWith("app_");
  const appRows = rows.filter((r) => isApp(r.event)).map((r) => ({ label: r.event.slice(4), n: r.n }));
  const userRows = rows.filter((r) => !isAdmin(r.event) && !isApp(r.event)).slice(0, 20).map((r) => ({ label: r.event, n: r.n }));
  const adminRows = rows.filter((r) => isAdmin(r.event)).map((r) => ({ label: r.event, n: r.n }));
  const totalTaps = userRows.reduce((s, r) => s + r.n, 0);
  const parts = [
    `📊 <b>Usage events (7d) — users</b> · ${totalTaps} tap(s), top ${userRows.length}`,
    userRows.length ? barList(userRows) : "—",
  ];
  if (appRows.length) parts.push("📱 <b>Mini App features (7d)</b>", barList(appRows));
  if (adminRows.length) parts.push("🛠 <b>Admin actions (7d)</b>", barList(adminRows));
  return parts.join("\n");
}

// 🧲 Retention by signup week: of those who joined that week, the share who completed a workout
// in their week 1/2/4/8 (domain/cohorts.ts). Shows where people drop off, which the funnel and
// DAU (how many are active now) can't. Last 16 weeks of signups, newest cohort first.
export async function orRetention(db: D1Database): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 16 * 7 * 86_400_000).toISOString();
  const members = await cohortMembersSince(db, since).catch(() => [] as Array<{ joined: string; trainedWeeks: number[] }>);
  const rows = cohortRetention(members, today, 10);
  if (!rows.length) return "🧲 <b>Retention by signup week</b>\nNo signups in the last 16 weeks.";
  const cell = (r: number | null) => (r === null ? "—" : `${r}%`).padStart(4);
  const header = `cohort  users ${RETENTION_WEEKS.map((w) => `  w${w}`).join(" ")}`;
  const lines = rows.map((r) => `${(r.cohort === "all" ? "all" : r.cohort.slice(5)).padEnd(6)} ${String(r.size).padStart(5)} ${r.rates.map(cell).join(" ")}`);
  const drop = biggestDrop(rows.find((r) => r.cohort === "all"));
  return [
    "🧲 <b>Retention by signup week</b> — share who logged a workout in their week 1 / 2 / 4 / 8",
    `<pre>${escapeHtml([header, ...lines].join("\n"))}</pre>`,
    drop ? `📉 Biggest drop: week ${drop.from} → week ${drop.to} (${drop.fromRate}% → ${drop.toRate}%).` : "",
    "<i>— = the cohort hasn't lived through that week yet.</i>",
  ].filter(Boolean).join("\n");
}

// 🤖 AI: provider usage, calls by task, latency/fallback, and plan-source offload.
export async function orAI(db: D1Database, env?: Env): Promise<string> {
  const { since7Iso } = ownerReportWindows();
  const [usage7, callStats, kindStats7, planSources] = await Promise.all([
    aiUsageSince(db, since7Iso),
    aiCallStatsSince(db, since7Iso),
    aiTokensByKindSince(db, since7Iso),
    countPlanSourcesSince(db, since7Iso),
  ]);
  const kTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const okBy = new Map<string, number>();
  const failBy = new Map<string, number>();
  for (const u of usage7) {
    const m = u.ok ? okBy : failBy;
    m.set(u.provider, (m.get(u.provider) ?? 0) + 1);
  }
  // Provider lines in fallback order; new providers appear automatically.
  const PROVIDERS: [string, string, string][] = [
    ["gemini", "Gemini", "GEMINI_API_KEY"],
    ["groq", "Groq (fallback)", "GROQ_API_KEY"],
    ["ollama", "Ollama (fallback)", "OLLAMA_API_KEY"],
    ["openrouter", "OpenRouter (fallback)", "OPENROUTER_API_KEY"],
    ["workersai", "Workers AI (fallback)", ""],
  ];
  const keyCount = (k: string) => (env && k ? splitKeys((env as unknown as Record<string, string>)[k]).length : 0);
  const usageRows: (string | number)[][] = PROVIDERS.filter(([p, , k]) => okBy.has(p) || failBy.has(p) || keyCount(k) > 0).map(
    ([p, label, k]) => [label.replace(" (fallback)", "*"), okBy.get(p) ?? 0, failBy.get(p) ?? 0, k ? keyCount(k) : env ? "bind" : "-"],
  );
  // Tokens-by-task (not just tokens-by-provider, below) — pinpoints which KIND of call is
  // actually driving spend, e.g. a runaway prompt in one flow the provider-only view can't show.
  const taskRows: (string | number)[][] = kindStats7.map((k) => [k.kind, k.calls, kTok(k.tokens)]);
  // One-glance health verdict, derived from the 7d call stats (details in the tables below).
  const totalCalls0 = callStats.reduce((s, c) => s + c.calls, 0);
  const fbPct0 = totalCalls0 ? Math.round((callStats.reduce((s, c) => s + c.fallbacks, 0) / totalCalls0) * 100) : 0;
  const gemAvg = callStats.find((c) => c.provider === "gemini")?.avgLatencyMs ?? 0;
  const health =
    gemAvg > 15_000 || fbPct0 > 60
      ? `🔴 <b>Degraded</b> — fallback ${fbPct0}%${gemAvg ? `, Gemini ${(gemAvg / 1000).toFixed(1)}s avg` : ""}`
      : fbPct0 > 25
        ? `🟡 <b>Strained</b> — fallback ${fbPct0}%${gemAvg ? `, Gemini ${(gemAvg / 1000).toFixed(1)}s avg` : ""}`
        : `🟢 <b>Healthy</b> — fallback ${fbPct0}%${gemAvg ? `, Gemini ${(gemAvg / 1000).toFixed(1)}s avg` : ""}`;
  const lines: string[] = [
    "🤖 <b>AI usage (7d)</b>",
    ...(totalCalls0 ? [health] : []),
    monoTable(["Provider", "ok", "fail", "keys"], usageRows.length ? usageRows : [["—", 0, 0, "-"]]),
    "<i>* = fallback provider · Gemini “fail” = rate-limited</i>",
    "",
    "📋 <b>AI calls by task (7d)</b>",
    monoTable(["Task", "calls", "tok"], taskRows.length ? taskRows : [["—", 0, "0"]]),
  ];
  if (callStats.length) {
    const totalCalls = callStats.reduce((s, c) => s + c.calls, 0);
    const totalFallbacks = callStats.reduce((s, c) => s + c.fallbacks, 0);
    const totalTokens = callStats.reduce((s, c) => s + c.tokens, 0);
    const fallbackPct = totalCalls ? Math.round((totalFallbacks / totalCalls) * 100) : 0;
    lines.push(
      "",
      "⚙️ <b>AI calls (7d): latency & fallback</b>",
      `• Total: ${totalCalls} call(s) · fallback rate ${fallbackPct}%${totalTokens ? ` · ${kTok(totalTokens)} tokens` : ""}`,
      monoTable(["Provider", "calls", "avg ms", "tok"], callStats.map((c) => [c.provider, c.calls, c.avgLatencyMs, kTok(c.tokens)])),
    );
    // Latency alert: the primary provider should answer in a few seconds; > 15s avg means it's
    // hitting timeouts/retries (degraded) and dragging every plan/translate call.
    const gem = callStats.find((c) => c.provider === "gemini");
    if (gem && gem.avgLatencyMs > 15_000) {
      lines.push(`⚠️ <b>Gemini degraded</b>: ${(gem.avgLatencyMs / 1000).toFixed(0)}s avg latency — likely timeouts/retries. Fallbacks are carrying load.`);
    }
  }
  // Plan source (7d): confirms the bank/template actually offloaded Gemini. zero-AI = bank+template.
  if (planSources.length) {
    const rows = planSources.map((s) => [s.kind, s.source, s.c]);
    const total = planSources.reduce((a, s) => a + s.c, 0);
    const zeroAi = planSources.filter((s) => s.source !== "ai").reduce((a, s) => a + s.c, 0);
    const pct = total ? Math.round((zeroAi / total) * 100) : 0;
    lines.push("", "🏦 <b>Plan source (7d)</b>", `• Zero-AI served: <b>${pct}%</b> (${zeroAi}/${total})`, monoTable(["Kind", "Source", "n"], rows));
  }
  return lines.join("\n");
}

// 🧑‍🏫 Trainers & requests: pending applications, pending client requests, trainer roster.
export async function orTrainers(db: D1Database): Promise<string> {
  const [pendingApps, reqs, trainers] = await Promise.all([
    pendingTrainerApplications(db),
    pendingRequestsAll(db, 20),
    listTrainerUsers(db),
  ]);
  const lines: string[] = [];
  if (pendingApps.length) {
    lines.push("🆕 <b>Trainer applications (approve via their message)</b>");
    for (const a of pendingApps) lines.push(`• ${escapeHtml(a.name)} (id ${a.trainerId})`);
  }
  if (reqs.length) {
    lines.push("", "📥 <b>Pending client requests (client → trainer)</b>");
    for (const r of reqs) {
      const [cl, tr] = await Promise.all([getUser(db, r.clientId), getUser(db, r.trainerId)]);
      const clName = escapeHtml(cl?.profile.name ?? `id ${r.clientId}`);
      const trName = escapeHtml(tr?.profile.name ?? `id ${r.trainerId}`);
      lines.push(`• ${clName} → ${trName}${r.note ? `: ${escapeHtml(r.note)}` : ""}`);
    }
  }
  if (trainers.length) {
    lines.push("", "🧑‍🏫 <b>Trainers</b>");
    for (const tr of trainers) {
      const n = await countClientsOf(db, tr._id);
      lines.push(`• ${escapeHtml(tr.profile.name ?? `id ${tr._id}`)} — ${n} client(s)`);
    }
  }
  return lines.length ? lines.join("\n") : "🧑‍🏫 <b>Trainers & requests</b>\nNothing pending.";
}

// 🚧 Onboarding & churn: who is mid-interview / stuck / generating, and who went quiet.
export async function orOnboarding(db: D1Database): Promise<string> {
  const { since7Iso, since14Iso } = ownerReportWindows();
  const [onboarding, planPending, churned, byMode] = await Promise.all([
    listOnboardingUsers(db).catch(() => []),
    // Far-future cutoff → every plan-generation-stage user, not just stale ones.
    listPlanPendingUsers(db, new Date(Date.now() + 86_400_000).toISOString()).catch(() => []),
    listChurnedUsers(db, since14Iso, since7Iso).catch(() => [] as { id: number; name: string }[]),
    nonOnboardedByMode(db).catch(() => [] as { mode: string; n: number }[]),
  ]);
  const lines: string[] = [];
  // Funnel: which question the in-interview cohort is currently sitting on (drop-off point),
  // plus every non-onboarded user bucketed by session mode (never started, role pick, …).
  if (byMode.length) {
    lines.push("🪜 <b>Funnel — non-onboarded by stage</b>", monoTable(["Stage", "n"], byMode.map((m) => [m.mode, m.n])));
  }
  const stepCounts = new Map<string, number>();
  const steps = obSteps("en");
  for (const u of onboarding) {
    const field = String(steps[u.session.step ?? 0]?.field ?? `step ${u.session.step ?? 0}`);
    stepCounts.set(field, (stepCounts.get(field) ?? 0) + 1);
  }
  if (stepCounts.size) {
    lines.push("❓ <b>Interview — stuck on question</b>", monoTable(["Question", "n"], [...stepCounts.entries()].sort((a, b) => b[1] - a[1])));
  }
  if (lines.length) lines.push("");
  if (onboarding.length || planPending.length) {
    const stuck: string[] = [];
    const retrying: string[] = [];
    const waiting: string[] = [];
    for (const u of onboarding) {
      const who = u.profile.name ? escapeHtml(u.profile.name) : `id ${u._id}`;
      const { filled, total } = interviewProgress(u.profile);
      const prog = `${filled}/${total} details`;
      const tr = u.session.transcript ?? [];
      const last = tr[tr.length - 1];
      if (u.session.retryAfter) retrying.push(`${who} (${prog}, retry queued)`);
      else if (last?.role === "user") stuck.push(`${who} · ${prog} · ${tr.length} turns · since ${u.updatedAt.toISOString().slice(5, 16).replace("T", " ")}`);
      else waiting.push(`${who} (${prog})`);
    }
    const inProgress = onboarding.length + planPending.length;
    lines.push(`🚧 <b>Onboarding (${inProgress} in progress)</b>`);
    if (stuck.length) {
      lines.push(`❌ <b>STUCK — answered, no bot reply (${stuck.length})</b>`);
      for (const s of stuck) lines.push(`• ${s}`);
      lines.push("↳ fix: /users → tap user → ▶️ Continue interview");
    }
    if (retrying.length) lines.push(`🔁 Auto-retry queued: ${retrying.join(", ")}`);
    if (waiting.length) lines.push(`⏳ Waiting on user: ${waiting.join(", ")}`);
    if (planPending.length) {
      const names = planPending.map((u) => (u.profile.name ? escapeHtml(u.profile.name) : `id ${u._id}`));
      lines.push(`⚙️ Generating plan (${planPending.length}): ${names.join(", ")}`);
    }
  }
  if (churned.length) {
    lines.push("", `📉 <b>Churn risk (${churned.length})</b> — silent 7-14d`);
    lines.push(churned.map((c) => escapeHtml(c.name || `id ${c.id}`)).join(", "));
  }
  return lines.length ? lines.join("\n") : "🚧 <b>Onboarding & churn</b>\nAll clear.";
}

// 🐞 Errors, progression activity, and the recent admin audit trail.
export async function orErrors(db: D1Database): Promise<string> {
  const { since7Iso } = ownerReportWindows();
  const [errors7, planSources, adjustments7, audit] = await Promise.all([
    errorStatsSince(db, since7Iso).catch(() => [] as { errorType: string; kind: string; n: number }[]),
    countPlanSourcesSince(db, since7Iso),
    countAdjustmentsSince(db, since7Iso),
    recentAudit(db, 8).catch(() => [] as { ts: string; actorId: number; action: string; targetId: number | null; detail: string | null }[]),
  ]);
  const lines: string[] = [];
  // Progression activity (7d): how dynamically plans are adapting.
  const psBy = (k: string) => planSources.filter((s) => s.kind === k).reduce((a, s) => a + s.c, 0);
  const progRows: (string | number)[][] = [
    ["Weekly progress", adjustments7],
    ["Plateau swaps", psBy("plateau_swap")],
    ["Level-ups", psBy("level_up")],
    ["Goal switches", psBy("goal_switch")],
  ];
  if (progRows.some((r) => Number(r[1]) > 0)) {
    lines.push("📈 <b>Progression (7d)</b>", monoTable(["Event", "n"], progRows));
  }
  if (errors7.length) {
    const byType = new Map<string, number>();
    for (const e of errors7) byType.set(e.errorType, (byType.get(e.errorType) ?? 0) + e.n);
    lines.push("", "🐞 <b>Errors by type (7d)</b>", monoTable(["Type", "n"], [...byType.entries()].sort((a, b) => b[1] - a[1])));
  }
  // AI errors (last 24h). Null when there were no errors.
  const errReport = await buildErrorReport(db).catch(() => null);
  if (errReport) lines.push("", errReport);
  // Audit trail of recent owner/trainer admin actions (assign, block, flag, broadcast…).
  if (audit.length) {
    lines.push("", "🛡 <b>Recent admin actions</b>");
    for (const a of audit) {
      const when = a.ts.slice(5, 16).replace("T", " ");
      lines.push(`• ${when} · ${escapeHtml(a.action)}${a.targetId ? ` → ${a.targetId}` : ""}${a.detail ? ` (${escapeHtml(a.detail)})` : ""}`);
    }
  }
  return lines.length ? lines.join("\n") : "🐞 <b>Errors & progression</b>\nNo errors in the last 7d. 🎉";
}

export async function ownerUsersData(
  db: D1Database,
): Promise<{ rows: OwnerUserRow[]; feedback: { who: string; date: string; text: string }[] }> {
  const [users, trainers, eventCounts, planStatus, feedback] = await Promise.all([
    listUsersBrief(db),
    listTrainerUsers(db),
    eventCountsByUser(db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
    recentFeedback(db, 10),
  ]);
  const trainerName = new Map<number, string>();
  for (const tr of trainers) trainerName.set(tr._id, tr.profile.name ?? `id ${tr._id}`);
  const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
  const rows: OwnerUserRow[] = users.map((u) => {
    const ev = eventCounts.get(u.id) ?? zero;
    const ps = planStatus.get(u.id);
    const prog = interviewProgress(u.profile);
    const status: OwnerUserRow["status"] = u.blocked
      ? "banned"
      : u.botBlocked
        ? "blocked"
        : !u.onboarded
          ? "onboarding"
          : ps?.active
            ? "active"
            : ps?.draft
              ? "draft"
              : "none";
    return {
      id: u.id,
      name: u.name || `id ${u.id}`,
      nick: u.username ? `@${u.username}` : "",
      trainer: u.trainerId ? trainerName.get(u.trainerId) ?? `id ${u.trainerId}` : "",
      status,
      onb: u.onboarded ? "" : `${prog.filled}/${prog.total}`,
      w: ev.workouts, c: ev.checkins, n: ev.nutrition, s: ev.steps,
      last: u.lastSeenAt ? u.lastSeenAt.slice(5, 10) : "",
      total: ev.workouts + ev.checkins + ev.nutrition + ev.steps,
      ...(u.lastSeenAt ? { lastSeen: u.lastSeenAt } : {}),
    };
  });
  const fb = feedback.map((f) => ({ who: f.username ? `@${f.username}` : `id ${f.userId}`, date: f.date, text: f.text }));
  return { rows, feedback: fb };
}

export async function orUsers(db: D1Database): Promise<string> {
  const [users, trainers, eventCounts, planStatus, feedback] = await Promise.all([
    listUsersBrief(db), // all users — the owner report lists everyone
    listTrainerUsers(db),
    eventCountsByUser(db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
    recentFeedback(db, 10),
  ]);
  const lines: string[] = [];
  if (users.length) {
    // A wide monospace <pre> table (13 columns) wrapped and became unreadable on phones. Instead:
    // one compact 2-line "card" per user that flows naturally at any width. A leading glyph encodes
    // status at a glance; counts are self-labelled with emoji so no column alignment is needed.
    lines.push("👤 <b>Users</b> · 🟢 active plan · 🟠 draft · ⚪ no plan · 🟡 onboarding · 🚫 bot-blocked · ⛔ banned · 🧑‍🏫 trainer · 🏋️ workouts · ✅ check-ins · 🍽 nutrition · 👟 steps · date = last active");
    const trainerName = new Map<number, string>();
    for (const tr of trainers) trainerName.set(tr._id, tr.profile.name ?? `id ${tr._id}`);
    const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
    // Most-active first: rank by total logged events (workouts + check-ins + nutri + steps).
    const ranked = [...users]
      .map((u) => ({ u, ev: eventCounts.get(u.id) ?? zero }))
      .sort((a, b) => {
        const sum = (e: typeof zero) => e.workouts + e.checkins + e.nutrition + e.steps;
        return sum(b.ev) - sum(a.ev);
      });
    const cards = ranked.map(({ u, ev }) => {
      const prog = interviewProgress(u.profile);
      const ps = planStatus.get(u.id);
      const glyph = u.blocked ? "⛔" : u.botBlocked ? "🚫" : !u.onboarded ? "🟡" : ps?.active ? "🟢" : ps?.draft ? "🟠" : "⚪";
      const head = [`${glyph} <b>${escapeHtml(u.name || `id ${u.id}`)}</b>`];
      if (u.username) head.push(`@${escapeHtml(u.username)}`);
      if (u.trainerId) head.push(`🧑‍🏫${escapeHtml(trainerName.get(u.trainerId) ?? `id ${u.trainerId}`)}`);
      if (!u.onboarded) head.push(`${prog.filled}/${prog.total}`);
      const plan = ps?.active ? (ps?.draft ? "📋+📝" : "📋") : ps?.draft ? "📝" : "";
      const act: string[] = [];
      if (ev.workouts) act.push(`🏋️${ev.workouts}`);
      if (ev.checkins) act.push(`✅${ev.checkins}`);
      if (ev.nutrition) act.push(`🍽${ev.nutrition}`);
      if (ev.steps) act.push(`👟${ev.steps}`);
      const meta: string[] = [];
      if (plan) meta.push(plan);
      meta.push(act.length ? act.join(" ") : "—");
      if (u.lastSeenAt) meta.push(u.lastSeenAt.slice(5, 10)); // MM-DD of last GENUINE activity
      return `${head.join(" · ")}\n   ${meta.join(" · ")}`;
    });
    // Blank line every 8 cards → chunkReport split points (Telegram's 4096 cap) + batch grouping.
    for (let i = 0; i < cards.length; i += 8) { lines.push(""); lines.push(cards.slice(i, i + 8).join("\n")); }
  }
  if (feedback.length) {
    lines.push("", "✍️ <b>Recent feedback</b>");
    for (const f of feedback) {
      const who = f.username ? `@${f.username}` : `id ${f.userId}`;
      lines.push(`• <b>${escapeHtml(who)}</b> (${f.date}): ${escapeHtml(f.text)}`);
    }
  } else {
    lines.push("", "✍️ No feedback yet.");
  }
  return lines.join("\n");
}

// Full report (used by the scheduled weekly owner push) = all sections concatenated.
export async function buildOwnerReport(db: D1Database, env?: Env): Promise<string> {
  const sections = await Promise.all([
    orOverview(db),
    orAI(db, env),
    orTrainers(db),
    orOnboarding(db),
    orErrors(db),
    orEngagement(db),
    orRetention(db),
    orUsers(db),
  ]);
  // A light rule between sections so the seven blocks read as distinct cards, not one wall of
  // text. Kept on its own blank-line-delimited line so chunkReport still splits cleanly.
  return sections.filter(Boolean).join("\n\n────────────\n\n");
}

// Structured counterpart to buildOwnerReport, for the Grafana "owner metrics" dashboard
// (GET /admin/metrics/owner in src/index.ts). Calls the same repo functions as
// orOverview/orAI above rather than re-deriving the numbers, so the two stay in sync by
// construction instead of by hand-maintained duplication.
export async function buildOwnerMetrics(db: D1Database) {
  const { since7Iso, since14Iso, since30Iso } = ownerReportWindows();
  const since7Date = since7Iso.slice(0, 10);
  const nowIsoStr = new Date().toISOString();
  const [
    trainersCount, clientsCount, pendingApps, pendingReqs, pendingReqRows, active7, active30, engagement,
    totalUsers, onboarded, new7, moderation, planStatus, churned, inactive7,
  ] = await Promise.all([
    countByRole(db, "trainer"),
    countByRole(db, "client"),
    pendingTrainerApplications(db),
    countPendingClientRequests(db),
    pendingRequestsAll(db, 20),
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
  const usersWithPlan = [...planStatus.values()].filter((p) => p.active).length;
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
      retentionPct: share(active7, onboarded),
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
