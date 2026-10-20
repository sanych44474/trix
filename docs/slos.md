# trix — metrics and SLO status

Internal operating contract. Status reviewed 2026-10-19 against the repository. A binding in
`wrangler.toml` or a dashboard JSON file proves that the code is prepared; it does not prove that
the production account or an external Grafana workspace is configured correctly.

## Data path and privacy

- `src/index.ts` writes one `request` record per Worker request with method, normalized path,
  status, and duration. Cron runs and failures also have structured events.
- `src/log.ts` writes structured events to Workers Logs and, when the `ANALYTICS` binding is
  present, to the `trix_events` Analytics Engine dataset declared in `wrangler.toml`.
- Analytics Engine fields pass through an allowlist. Raw account IDs, usernames, chat IDs, health
  details, and message contents are excluded. Keep the allowlist in `src/log.ts` as the boundary.
- `grafana/user-activity.json` reads activity from the authenticated `/admin/metrics/activity`
  endpoint through Grafana's Infinity datasource. The endpoint is backed by D1 and omits direct
  identifiers from its top-user rows. Those rows remain pseudonymous and may be re-identified in
  a small population; names and IDs belong only in D1 and owner-only views.
- `v2_daily_metrics` stores daily aggregate rows. The rollup in `src/dailyMetricsRollup.ts` writes
  completed workouts, planned days without a completed workout, session counts, signups, plan
  snapshots, and bounded AI telemetry. It does not contain a user identifier.

Production Grafana credentials, datasource settings, alert rules, and notification routing are
external to this repository and have not been verified here.

## Metric definitions

| Metric | Current definition |
|---|---|
| Session | A bot or Mini App interaction after at least 30 minutes idle, stored through `recordPresence` as a `session` event in `v2_analytics_events`. |
| Session `dau` / `wau` / `mau` | Distinct accounts with a `session` mark in the day / trailing 7 days / trailing 30 days. Used by the daily rollup. |
| Activity DAU / WAU / MAU | Distinct accounts with any persisted workout session, food-log day, check-in, water, steps, or counted analytics event in the day / trailing 7 days / trailing 30 days. Used by the Grafana activity endpoint; it can differ from session counts. |
| Signup | `v2_accounts.createdAt`; there is no separate `signup` log event. |
| Workout completed | A completed row in `v2_workout_sessions`. A partially logged session is not complete. |
| Workout missed | A current active plan contains the date's weekday and there is no completed session for that account and date. This is derived, not an explicit user action. |
| Workout retention | Cohort members who completed a workout in weeks 1, 2, 4, or 8 after signup, as shown by the activity dashboard. |
| `ai_provider_attempts` | Number of provider-attempt rows in `v2_ai_usage`. |
| `ai_fallback_attempt_share` | Provider-attempt rows with `wasFallback = 1`, divided by all provider-attempt rows. It counts attempts, not logical requests that needed fallback. |
| `error_events` | Count of every row in `v2_error_events`, including exhausted AI chains and non-AI application errors. It has no denominator and is not a Worker HTTP error rate. |
| Estimated AI cost | Not currently calculated. Token telemetry is a single total and no versioned per-model price table exists. |
| Onboarding funnel | Per account, from state rather than events (`src/domain/funnel.ts`, `src/adapters/d1/funnel.ts`): signup (`v2_accounts.createdAt`) → onboarding started (the `funnel_onboarding_started` event from the bot wizard or Mini App form, or a Mini App draft with an answer) → onboarding finished (`v2_onboarding.status = 'completed'`) → plan activated (a `v2_plans` row that is not `draft`) → first completed workout → second within 7 days of the first. Steps are monotonic: an account that reached a later step counts at every earlier one. Shown at the top of the owner Onboarding tab for the last 30 days' signups and all accounts, with the median days to the first workout. Owner-banned accounts are excluded; trainers are included. |

`onboarded_total` and `active_plans` in the daily rollup are snapshots taken when yesterday is
rolled up, not historical values reconstructed for that day. Daily history begins when the
rollup runs; the repository does not backfill it.

Legacy `error_rate` rows, if present, are not a valid rate: the old rollup divided all application
error events by AI provider attempts. New rollups write an `error_events` count instead; no checked-in
dashboard or report reads the old key.

## Implemented product events

These event scopes are emitted in the current code. Signup counts come from account creation
timestamps. Analytics Engine receives only values admitted by the `src/log.ts` allowlist.

| Event | Source |
|---|---|
| `app_open`, `dashboard_loaded`, `session_started` | Bot start, Mini App dashboard load, and shared presence adapter. |
| `onboarding_started`, `onboarding_completed`, `first_plan_ready` | Onboarding and plan activation flows. Funnel counters `funnel_onboarding_started` / `funnel_onboarding_finished` are bumped in `v2_analytics_events` by both the bot wizard and the Mini App form. |
| `first_workout_completed`, `workout_completed` | Shared workout completion flow. |
| `nutrition_logged`, `checkin_submitted`, `photo_uploaded` | Bot and Mini App logging paths. |
| `trainer_client_connected`, `trainer_question_answered` | Trainer linking and messaging flows. |
| `ai_call_completed`, `ai_fallback` | AI provider attempts and fallback transitions. Only total tokens are recorded; the event has no input/output split or cost estimate. |
| `r2_cache_hit`, `r2_cache_miss`, `telegram_photo_fallback` | Progress-photo cache and fallback path. |
| `cron_run`, `cron_failure`, `do_alarm_run`, `telegram_send_failure` | Scheduled runs, Durable Object alarms, and Telegram send errors. |

The current activity dashboard shows DAU/WAU/MAU, adoption, workouts, check-ins, signups, top
events, and workout retention. The signup-to-second-workout funnel is in the owner Onboarding tab, not
in Grafana.

## SLOs and alerting

| Signal | Threshold or check | Repository status |
|---|---|---|
| Worker availability | `GET /health` returns 200. | Covered by post-deploy `scripts/smoke.mjs`; no scheduled HTTP monitor is defined here. |
| D1 availability | `GET /health/db` returns 200 with `ok: true`. | Covered by post-deploy smoke. `scripts/verify-schema.mjs` checks expected tables and added columns. |
| Worker HTTP failures | More than 1% non-2xx responses over 5 minutes. | Request records already reach Analytics Engine. No versioned Grafana query, alert rule, or notification route is present. |
| Cron liveness | Successful cron run every 5 minutes. | `HEALTHCHECK_PING_URL` optionally pings Healthchecks.io every 5 minutes and fails immediately; the in-app owner alert fires after a 10-minute heartbeat gap when a request arrives. Confirm the external check is configured in production. |
| Auth regression | Bad webhook, admin, and Mini App credentials remain rejected. | Negative cases are in the post-deploy smoke script. No scheduled auth probe is defined here. |
| AI degradation | Fallback rate: 25% strained, 60% degraded, using the owner-report verdict. | Provider-attempt telemetry and owner report exist. A Grafana alert rule is not checked in. |
| Telegram delivery | Send failures rise above normal baseline. | `telegram_send_failure` events exist; no threshold or routed alert is checked in. |
| D1 usage and latency | Reads, writes, and latency vs account limits and recent baseline. | Requires Cloudflare account analytics; no query or alert is checked in. |
| R2 storage | Use the existing 80% storage-budget threshold. | The application guard exists; external alert routing is not verified here. |

## Remaining operational work

1. Verify the production Worker has the `ANALYTICS` binding and confirm fresh `request` events
   appear in the intended dataset.
2. Verify Grafana's Infinity datasource uses the production Worker host and the `X-Admin-Secret`
   header, then confirm the checked-in activity dashboard loads without returning account IDs.
3. Add and route scheduled alerts for availability, HTTP failures, auth checks, AI fallback, and
   Telegram delivery. Keep query definitions and thresholds in version control where possible.
4. Add D1 request/billing metrics from Cloudflare account analytics. Add an AI cost estimate only
   after input/output tokens and a dated, reviewable model-price table are available.
5. Schedule a production recovery exercise under the [D1 recovery runbook](runbooks/d1-recovery.md).
   The local synthetic SQL import sanity check passes; Time Travel restore is an in-place live
   database mutation and needs explicit approval.
