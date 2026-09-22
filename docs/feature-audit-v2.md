# trix v2 feature audit

This is the implementation audit for the inventory in [`docs/features.md`](features.md). The
legacy Telegram surface remains active while the v2 Mini App and API are introduced. “v2
integrated” means the scenario has a React entry point, a `/api/v2/*` route, and the same
application behavior is reachable through the new seam. “Legacy retained” means the feature is
available and intentionally not yet moved into the v2 navigation. “Partial” means the new shell
exposes the role or data, but the full scenario still uses legacy routes or bot flows.

| Area | Current status | v2 surface | Decision |
|---|---|---|---|
| Onboarding & roles | v2 integrated | React onboarding form, pending-plan state, profile/consent editor and role-aware workspace use `/api/v2/onboarding` and `/api/v2/profile` | Keep the bot wizard as a peer interface; plan generation remains an asynchronous scheduler job |
| Training plan | v2 integrated | `Plan` screen, `/api/v2/plan`, catalog search, version check and `If-Match` support | Keep; Mini App now exposes weight/sets plus catalog/custom add/swap, delete/reorder, superset linking, personal video overrides and trainer-for-client editing; whole-day editing remains long-tail. Catalog swap and add-exercise were returning 400 from the Mini App (client sent `value`, handler read `name`) — fixed, with a regression test that posts the payload the client actually builds. Every edit is now recorded in the plan change log and the last 10 entries are shown in a History card, for the athlete and for a trainer viewing a client |
| Workout logging | v2 integrated | `Train` guided logger handles reps, timed and distance metrics, offline drafts, idempotent save, exercise swaps, ad-hoc exercises, rest timer (resilient to screen-lock/backgrounding), and full editing of any already-saved session in the 14-day window, through the shared `/api/v2/workout/*` seam | Keep; rest-timer delivery already pushes for real (minute-cron + `v2_rest_timers`, worst-case ~60s lag) — a Durable Object alarm was considered for sub-second precision and deliberately declined, see [ADR-0002](adr/0002-no-do-rest-timer.md). The rest timer was reworked: a sticky bar with a progress ring, `-15`/`+15`/Skip, a remembered per-metric preference, 3-2-1 haptics plus an optional tone, overrun counting up instead of vanishing, and a live work-vs-rest density and rest-discipline streak. Skip now cancels the server-side push via `DELETE /api/v2/workout/rest` (it previously fired anyway). Saving shows a session summary built from the PR/badge/level payload the endpoint already returned and the app used to discard |
| Nutrition | v2 integrated | `Fuel` totals/meals, AI quick-log, food search, barcode, measured portions, recent re-add, meal-plan regeneration, grocery-list send-to-chat, and rest-day target labeling use `/api/v2/nutrition` and `/api/v2/log` | Keep; per-item meal-plan editing shipped. Photo-of-food logging stays bot-only by decision, not by gap — the upload path exists (`POST /api/v2/photo`), but the value is in the conversational confirm loop, see [ADR-0007](adr/0007-photo-of-food-stays-in-the-bot.md) |
| Body & activity | v2 integrated | `Progress` renders a tappable 84-day heatmap with per-day detail, measurement/e1RM line charts, a macros donut, and progress-photo upload, backed by the existing dashboard payload plus a new `/api/v2/photo` POST | Keep |
| Gamification & social | v2 integrated | Workspace exposes buddy progress, challenges, records, badges, leaderboard read, injury reporting, quick activity logging, and a read-only squad view (`/api/v2/squads`, scoped to the caller's own membership) through `/api/v2/*` | Keep in the role-aware Connect workspace; squad creation/management stays bot-only |
| Trainer workspace | v2 integrated | Client card (notes, note history, message thread, consent-gated health/body, photo gallery + photo-request), template bank, attention-first client sorting, a dedicated at-risk report, and an interview-nudge trigger are all reachable from the React shell | Keep; full in-app interview/onboarding chat stays bot-only (Telegram chat is the natural medium for it) |
| Reminders & automation | Legacy retained | Existing scheduler, outbox and Telegram notifications remain the delivery adapter | Keep dual delivery telemetry; migrate scheduler decisions only after parity and retry metrics are stable |
| Owner operations | v2 integrated | Owner workspace has 7 report tabs (overview/roster/AI/trainers/onboarding/errors/events) plus block/unblock/delete moderation (two-tap confirm, matching the bot's own gate) through `/api/v2/owner/*` | Keep; all authorization stays backend-side (chatId-matched owner check) |
| AI coach | v2 integrated | A single-turn "ask the coach" screen (`/api/v2/coach/ask`) reuses the shared provider-fallback/rate-limit pipeline, grounded in the user's active plan + last 14 days | Keep; the richer tap-to-apply plan-edit coach conversation, and the client-with-trainer routed-to-human flow, stay bot-only by design |
| Platform reliability | v2 integrated | Telegram initData auth, unified v2 envelopes, idempotency, `If-Match`, dark responsive shell | Keep; add contract/parity/offline tests before each cohort expansion |

Open work identified against this audit is tracked in [`docs/roadmap-next.md`](roadmap-next.md);
its P0/P1/P4 items are built, P2 (long-tail parity) and P3 (pending cutover flags) remain.

## Advertised, duplicated and unsafe entries

- The new shell has no entry points for unsupported booking, billing, public trainer discovery or
  other placeholder flows. Existing legacy routes remain reachable only where they already have
  backend behavior.
- The legacy `/app` shell is retired — `GET /app` now redirects to `/app-v2`
  (`scripts/build-webapp.mjs`). Its source (`src/webapp/client/*`) and the unversioned `/api/*`
  routes it called stay in the tree only as the rollback path. `/app-v2` and `/api/v2/*`
  are the sole surface for every user (`V2_APP_ENABLED=1`); `v2_*` tables are the sole
  source of truth. The dual-write/cohort/shadow-read machinery that staged this cutover
  (`V2_DUAL_WRITE`, `V2_COHORT_PERCENT`, `V2_INTERNAL_USER_IDS`, `V2_SHADOW_READS`) has been
  removed now that the cutover is complete and verified — see
  [ADR-0004](adr/0004-retire-dual-write-and-shadow-reads.md).
- Plan edits use a resource version and reject stale changes with `409 conflict`. Workout and
  quick-log saves accept `Idempotency-Key`; repeated requests replay the stored result.
- User deletion covers v2 account projections, trainer relationships and user-targeted audit
  rows in addition to legacy data.

## Cutover evidence

Run the following checks against the local D1 before enabling a cohort:

```bash
npm run verify-v2-backfill
npm run typecheck
npm run typecheck:webapp
npm test
```

For a remote database, use `node scripts/verify-v2-backfill.mjs --remote` only after reviewing the
target and Cloudflare credentials. The script compares legacy and v2 counts for accounts, plans,
plan elements, workouts, sets, nutrition entries, measurements, trainer relationships,
notifications and audit events.
