# ADR-0001: v2 seams and staged cutover

- Status: accepted (dual-write/cohort/shadow-read mechanism retired — see
  [ADR-0004](0004-retire-dual-write-and-shadow-reads.md); legacy `/app` shell retired — see
  [ADR-0006](0006-retire-legacy-app-shell.md))
- Date: 2026-09-15

## Context

trix has a working Telegram bot, a legacy Mini App and a D1 schema with user history already in
production. Replacing those surfaces in one operation would make rollback difficult and would put
plans, workouts, nutrition and role relationships at risk. The Worker also needs one set of
business rules for Telegram and HTTP.

## Decision

The v2 surface is introduced as a parallel composition root:

- `apps/mini-app` is a React/Vite client built to `public/app-v2`.
- `src/webapp/v2Api.ts` is the REST adapter for `/api/v2/*` and returns a stable data/error
  envelope.
- `src/application` exposes small application interfaces. `DashboardReader` is the first deep
  module; `src/adapters/d1` implements it and the legacy-to-v2 projection.
- `src/webapp/quickLogApi.ts` owns the quick-log use case used by both `/api/log` and
  `/api/v2/log`.
- `migrations/0069_v2_core.sql` creates normalized v2 tables and an idempotent initial projection.
- `V2_DUAL_WRITE` enables projection after successful legacy writes. `V2_COHORT_PERCENT` and
  `V2_INTERNAL_USER_IDS` provide deterministic internal/percentage cohorts; `V2_APP_ENABLED`
  selects the React v2 URL in bot buttons. All default to disabled so the legacy surface remains
  the rollback path.
- `scripts/verify-v2-backfill.mjs` compares legacy and v2 row cardinalities before a cohort move.
- `V2_SHADOW_READS=1` compares per-account plan/workout/nutrition/measurement counts on dashboard
  reads and records mismatches without changing the user response.

The v2 adapter delegates to proven legacy handlers during the migration. This keeps behavior
local and reduces the risk of a second implementation diverging while contracts, auth and
concurrency semantics are tested. New code does not access D1 directly outside repository or
adapter modules.

## Consequences

Positive:

- A cohort can be moved by configuration, and `/app` remains available for rollback.
- Existing Telegram behavior and user history remain available during migration.
- Idempotency and optimistic concurrency are applied at the v2 seam.
- The projection is repeatable and can be checked with a concrete parity command.

Costs and constraints:

- The legacy schema and handlers remain until parity and cutover evidence are complete.
- The first v2 routes are adapters, not a complete replacement of every long-tail feature.
- Projection failures are logged as `v2_dual_write_failure` and do not break a successful legacy
  user action; rollout monitoring must treat that signal as a release blocker.

## Rollout

Use the following order: local migration and parity check, internal users, 1%, 10%, 50%, then
100%. Each stage checks error rate, projection failures, duplicate-save behavior, authorization
parity and legacy/v2 read agreement. Keep the legacy schema read-only after cutover until a
separate deletion decision is recorded.
