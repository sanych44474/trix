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
| Training plan | v2 integrated | `Plan` screen, `/api/v2/plan`, version check and `If-Match` support | Keep; preserve the legacy bot editor and use version conflict responses for both clients |
| Workout logging | v2 integrated | `Train` guided logger handles reps, timed and distance metrics, offline drafts, idempotent save and the shared `/api/v2/workout/*` seam | Keep; exercise swaps and rest timer remain available through the legacy guided surface until their React controls are wired |
| Nutrition | Partial | `Fuel` totals/meals, AI quick-log, food search, barcode, measured portions and recent re-add use `/api/v2/nutrition` and `/api/v2/log` | Keep; grocery generation, full meal-plan editing and meal correction controls remain legacy-compatible routes |
| Body & activity | Partial | Progress data is visible through the v2 dashboard; quick-log seam supports water, steps, measurements and check-ins | Keep; expose dedicated controls in Progress and profile before 100% cutover |
| Gamification & social | v2 integrated | Workspace exposes buddy progress, challenges, records, badges, leaderboard read, injury reporting and quick activity logging through `/api/v2/*` | Keep in the role-aware Connect workspace; squad management and leaderboard opt-in settings remain in the bot/settings flow |
| Trainer workspace | Partial | Trainer dashboard and client pulse are rendered in the React shell; existing trainer APIs remain available | Move client cards, notes, consent, plans and messaging behind application use cases in the long-tail phase |
| Reminders & automation | Legacy retained | Existing scheduler, outbox and Telegram notifications remain the delivery adapter | Keep dual delivery telemetry; migrate scheduler decisions only after parity and retry metrics are stable |
| Owner operations | Partial | Owner workspace renders the protected report, roster and inactive-user action through `/api/v2/owner/*` | Add report section navigation and moderation actions before owner cohort cutover; keep all authorization backend-side |
| AI coach | Legacy retained / shared seam | AI quick nutrition log and dashboard use existing AI orchestration | Keep provider fallback, sanitization, rate limits and audit; add explicit v2 AI endpoints only when their contracts are stable |
| Platform reliability | v2 integrated | Telegram initData auth, unified v2 envelopes, idempotency, `If-Match`, dark responsive shell | Keep; add contract/parity/offline tests before each cohort expansion |

## Advertised, duplicated and unsafe entries

- The new shell has no entry points for unsupported booking, billing, public trainer discovery or
  other placeholder flows. Existing legacy routes remain reachable only where they already have
  backend behavior.
- The legacy `/app` and `/api/*` surface is preserved for rollback. `/app-v2` and `/api/v2/*`
  are the staged surface; `V2_APP_ENABLED`, `V2_DUAL_WRITE`, `V2_COHORT_PERCENT` and
  `V2_INTERNAL_USER_IDS` control exposure and projection cohorts.
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
