# trix — metrics contract & SLOs

Local working document, not published. Phase 1 of the Grafana observability plan (owner-report
metrics → Grafana, see the plan discussion for full context). Pins down exact names, units,
labels, retention, and definitions BEFORE any instrumentation or dashboard work, so the later
phases build against a fixed target instead of a moving one.

**Ground rule (privacy):** no raw username, chat ID, or health/injury data as a metric *label* in
any external system (Analytics Engine, Prometheus/Grafana Alloy, or any SaaS this eventually
exports to). Labels are low-cardinality categorical values only (event name, provider, kind,
status, weekday, cohort week). Anything user-identifying stays in D1 and is surfaced only through
the existing owner-only bot/Mini-App views (`ownerUsersData`, `orUsers`, …), never as a label a
dashboard groups or filters by.

---

## 1. What already exists (source of truth for Part 2 below)

The 7 owner-report sections (`src/bot/owner.ts`) are NOT being replaced — this whole effort turns
their existing aggregates into persisted time-series so they render in Grafana instead of (or
alongside) a point-in-time Telegram message. Current sections and their real data sources:

| Section | Function | Backing tables / repo calls |
|---|---|---|
| Overview | `orOverview` | `users` (counts, `lastSeenAt`), `event_counts` (DAU), `countCompletedWorkoutsBetween`, `planStatusByUser`, `listChurnedUsers` |
| Engagement | `orEngagement` | `event_counts` (`eventStatsSince`) — raw tap/screen-open counts by event key |
| AI | `orAI` | `ai_usage` (ok/fail by provider), `ai_call_logs` (latency, fallback, tokens), `countPlanSourcesSince` (AI vs bank/template) |
| Trainers | `orTrainers` | trainer applications, pending client requests, `countClientsOf` |
| Onboarding | `orOnboarding` | `listOnboardingUsers`, `listPlanPendingUsers`, `nonOnboardedByMode`, `listChurnedUsers` |
| Errors | `orErrors` | `error_logs` (`errorStatsSince`), `countAdjustmentsSince`, `recentAudit` |
| Users | `orUsers` / `ownerUsersData` | `listUsersBrief`, `eventCountsByUser`, `planStatusByUser`, `recentFeedback` |

Existing tables relevant to the metrics below:

- **`event_counts`** (`userId, event, day, n`) — a counter per (user, normalized event key, local
  day). `event` is a free-form key today (`"menu:plan"`, `"log:finish"`, `"vid:pick"`, …), bumped
  by `bumpEvent()`. This is the closest existing thing to a product-analytics event stream; Part 2
  below adds a small set of NAMED, funnel-shaped events on top rather than replacing it.
- **`ai_usage`** (`userId, provider, kind, model, ok, date, ts`) — one row per AI call attempt,
  ok/fail only, no latency or tokens.
- **`ai_call_logs`** (`userId, provider, kind, latency_ms, tokens, was_fallback, ts`) — per-attempt
  latency + fallback position. `tokens` is a single nullable total (not split input/output), and
  there is no cost estimate column yet — see §3.
- **`error_logs`** (`userId, kind, errorType, message, ts`) — one row per fully-failed AI call
  (every provider exhausted).
- **`users.lastSeenAt`** — set ONLY on a real user action (never by the cron); this is already the
  correct, precise definition of "active" used throughout the owner report. Reuse it, don't
  reinvent a parallel "last active" signal.

## 2. Core definitions

These are binding — every dashboard panel, alert, and rollup below must use these, not a
plausible-sounding restatement.

| Term | Definition |
|---|---|
| **Visit / session** | One `app_open` OR `dashboard_loaded` event (§3) from a given `userId` with no prior such event from the same user in the preceding 30 minutes. Session count, not page count. |
| **Active user (Nd)** | A user whose `users.lastSeenAt` falls within the last N days. Matches `countActiveSince` / the existing "active 7d/30d" figures in `orOverview` exactly — do not compute a second definition from event counts. |
| **Onboarded** | `users.onboarded = 1` (unchanged; matches `countOnboarded`). |
| **Completed workout** | A row in `workout_logs` with `completed = 1`. Matches `countCompletedWorkoutsBetween`. A row that exists but has `completed = 0` is a **started, not completed** workout (§3's `workout_started`/`workout_skipped` events distinguish these going forward; historically only the completed/not-completed row exists, not a started-vs-skipped distinction). |
| **Retention D1/D7/D30** | Of users onboarded on day X, the fraction with `lastSeenAt` on day X+1 / X+7 / X+30 respectively. Computed from the daily rollup table in §4, not live at dashboard-render time. |
| **Churn risk** | Unchanged from `listChurnedUsers`: onboarded, active in the [14d, 7d) window, silent in the last 7d. |
| **AI cost (estimated)** | `input_tokens × input_price + output_tokens × output_price` per provider/model, summed. Gemini/Groq/OpenRouter `:free` tiers and Workers AI are $0 by contract; this is tracked as a **leading indicator of paid-tier exposure**, not a real invoice reconciliation — call it "estimated cost," never "cost," in every panel label so nobody mistakes it for a billing figure. |
| **AI fallback rate** | `was_fallback = 1` rows ÷ total `ai_call_logs` rows in the window. Matches `orAI`'s existing calculation. |
| **Funnel step** | `signup → onboarding_started → onboarding_completed → first_plan_ready → first_workout_completed`, each a named event in §3. A user who never fires a step is "dropped at" the last step they did reach. |

## 3. New product events

Each new event is a single structured log line (`logInfo()`, `src/log.ts`) at the point it
actually happens — see the companion instrumentation PR for exact call sites. Fields marked
**label** are safe for any external system; fields marked **D1 only** must never leave the
Worker's own logs/D1.

Common fields on every event: `event` (name below), `ts` (ISO), `reqId` (when inside a request —
already provided by `log.ts`'s ambient context, free correlation to the request's own log line).
`userId` is **D1 only** in this table's convention — Analytics Engine / any exported system gets a
`cohortWeek` (ISO week of `users.createdAt`) instead when a per-user breakdown is genuinely needed
for a cohort chart, never the raw id as a label.

| Event | Fired when | Extra fields (labels unless noted D1-only) |
|---|---|---|
| `app_open` | Mini App shell (`GET /app`) or `/start` handled | `surface` (`miniapp`\|`bot`) |
| `dashboard_loaded` | `GET /api/dashboard` succeeds | — |
| `session_started` | First `app_open`/`dashboard_loaded` after the 30-min idle gate (§2) | — |
| `onboarding_started` | First onboarding step answered | `role` (`solo`\|`client`\|`trainer`) |
| `onboarding_completed` | `users.onboarded` flips to true | `role`, `stepsAnswered` (count) |
| `first_plan_ready` | A user's first-ever `setActivePlan` call | `source` (`ai`\|`bank`\|`template`) |
| `first_workout_completed` | A user's first-ever `workout_logs.completed=1` row | — |
| `workout_started` | A guided-log session begins (first set entered) | — |
| `workout_completed` | `saveWorkout` succeeds with `completed=1` | `exerciseCount` |
| `workout_skipped` | A planned day is explicitly marked skipped | `weekday` |
| `nutrition_logged` | A meal entry is appended | `method` (`text`\|`photo`\|`voice`\|`barcode`\|`miniapp`) |
| `checkin_submitted` | Daily check-in recorded | — |
| `photo_uploaded` | A progress photo is saved | — |
| `trainer_client_connected` | `linkClient` succeeds | — |
| `trainer_question_answered` | Trainer answers a client question | — |
| `ai_call_completed` | Any AI provider call returns (success or exhausted) | `provider`, `kind`, `ok`, `wasFallback`, `latencyMs`, `inputTokens`, `outputTokens`, `estCostUsd` |
| `ai_fallback` | An AI call falls through to the next provider | `fromProvider`, `toProvider`, `kind` |
| `r2_cache_hit` / `r2_cache_miss` | `photoStorage.ts`'s `getCachedPhoto` | — |
| `telegram_photo_fallback` | Photo served via the Telegram proxy (R2 miss or unconfigured) | — |
| `cron_run` / `cron_failure` | `runSchedule` completes / throws | `durationMs` |
| `do_alarm_run` | A scheduler DO's `alarm()` fires | `doType` (`user`\|`squad`\|`global`), `cutOver` (bool) |
| `telegram_send_failure` | A `bot.api.send*` call rejects | `kind` (best-effort category, e.g. `blocked`\|`rate_limited`\|`other`) |

**Not duplicating `event_counts`:** the existing free-form tap/screen counters stay exactly as
they are (`orEngagement` keeps working unchanged) — the table above is a *small, deliberately
funnel-shaped* set layered on top for the panels in §5 that `event_counts`' generic keys can't
answer (e.g. "onboarding → first plan → first workout" isn't reconstructable from `menu:plan` tap
counts).

## 4. Daily rollups (D1)

One new table, populated once per day by a scheduler job (Phase 2), NOT computed live per
dashboard load — retention/funnel/cohort queries over the full user history get expensive as the
user base grows, and Grafana panels should read a small pre-aggregated table.

`daily_metrics (date TEXT, metric TEXT, dims TEXT /* JSON, low-cardinality */, value REAL, PRIMARY KEY(date, metric, dims))`

Metrics populated into it (initial set — extend, don't fork a parallel table, when more are
needed): `dau`, `wau`, `mau`, `new_users`, `onboarded_total`, `active_plans`, `completed_workouts`,
`ai_calls`, `ai_fallback_rate`, `ai_est_cost_usd`, `error_rate`, `retention_d1`, `retention_d7`,
`retention_d30`.

## 5. Grafana board — sections (reference, not re-specified here)

The board layout (Executive summary / Funnel / Workouts / Retention / Nutrition / Trainers / AI
economics / Cloudflare-reliability / Operations / restricted tables) is as already scoped in the
plan discussion. This document is the contract those panels bind to — a panel that needs a metric
not listed in §3/§4 means the contract is incomplete and gets extended here FIRST.

## 6. Retention

- `event_counts`, `ai_usage`, `ai_call_logs`, `error_logs`: unchanged (no existing retention
  policy is being tightened or loosened by this effort).
- New structured event log lines (§3): live in Workers Logs at Cloudflare's platform retention
  (not re-specified here); once Analytics Engine is wired (a live-infra step requiring separate
  approval), Analytics Engine's own dataset retention applies.
- `daily_metrics` (§4): kept indefinitely — one row per (date, metric, dims) is cheap, and
  long-running trend/forecast panels (§7) need history that outlives any single table's prune
  cycle.
- `idempotency_keys`, telemetry tables already on the weekly 90-day prune pass: unaffected.

## 7. SLOs and alerts

Fixed thresholds first (below); Grafana Forecasting-based anomaly detection only after 4-6 weeks
of `daily_metrics` history exists — a forecast on a two-week baseline is noise, not a signal.

**Critical (page immediately):**

| SLO | Threshold | Existing signal |
|---|---|---|
| Health endpoints up | `GET /health` and `/health/db` both 200 | Already smoke-tested every deploy (`scripts/smoke.mjs`); the Grafana alert is the same check on a schedule, not a new one. |
| Cron heartbeat | Last successful `runSchedule` < 5 min old | `checkCronHeartbeat` already implements this exact check for the bot-side alert; Grafana alert reads the same heartbeat setting. |
| Worker error rate | > 1% of requests over 5 min | New: needs the GraphQL Analytics API (Cloudflare-side, not app code) — no live wiring done yet. |
| Mass Telegram send failures | `telegram_send_failure` rate spikes | New event (§3). |
| D1 unavailable | Any `db.prepare(...).run()`/`.first()` rejecting at an elevated rate | Existing `error_logs`/`logSchedulerError` already capture this; needs a rate threshold, not new instrumentation. |
| Webhook/auth regression | `POST /webhook` or any `/api/*` route stops rejecting bad credentials | Directly covered by `scripts/smoke.mjs`'s auth-rejection checks (already added this session) — promote these into a scheduled Grafana check too, don't just rely on deploy-time smoke. |

**Warning:**

| SLO | Threshold |
|---|---|
| AI fallback rate | Above the `orAI` health-verdict thresholds already coded (25% strained, 60% degraded) — reuse those numbers, don't invent new ones. |
| AI token/cost growth | Day-over-day `ai_est_cost_usd` (or token volume) jump beyond a set multiple of the trailing 7-day average. |
| D1 rows read/written or latency | Anomalous vs the trailing baseline (Cloudflare GraphQL Analytics API). |
| R2 approaching free-tier limit | Reuse `enforceStorageBudget`'s own 80% trigger (already implemented) as the alert threshold — one number, one place it's defined. |
| Onboarding completion rate drop | Day-over-day drop beyond a set threshold in `daily_metrics`. |
| Workouts/DAU below seasonal norm | Deferred to the Forecasting phase (§ above) — a fixed threshold here would just be a worse version of the eventual forecast band. |

---

**Open items for Phase 2+ (not resolved by this document, flagged so they aren't silently
decided in code):** exact `estCostUsd` per-provider/model price table and where it's version to store, whether
`daily_metrics` back-fills history before today from existing `event_counts`/`ai_usage`/workout
tables or starts from zero, and the exact Grafana/Cloudflare integration mechanics (Analytics
Engine binding, OTLP export, GraphQL Analytics API credentials) -- each of those is a live/external
step requiring its own explicit go-ahead per the standing rule, taken one at a time.
