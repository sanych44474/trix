# ADR-0004: retire the dual-write / cohort / shadow-read staging mechanism

- Status: accepted
- Date: 2026-09-17
- Supersedes the dual-write/cohort/shadow-read portion of [ADR-0001](0001-v2-seams-and-staged-cutover.md)

## Context

ADR-0001 introduced `V2_DUAL_WRITE`, `V2_COHORT_PERCENT`, `V2_INTERNAL_USER_IDS` (gating
`v2CohortEnabled()`, `src/contracts/rollout.ts`, and `syncDualWrite()` in `src/webapp/v2Api.ts`)
and `V2_SHADOW_READS` (gating `compareV2UserParity()`, `src/adapters/d1/v2Parity.ts`) to stage
the legacy→v2 cutover safely: write to both schemas for a growing cohort, and compare read
counts, before committing to v2 as the source of truth.

That cutover is now complete and verified live against production (`V2_APP_ENABLED=1` is the
committed default; `v2_*` tables are the source of truth for all ten domains). All four flags
have been `"0"`/empty in `wrangler.toml` in production, meaning:

- `v2CohortEnabled()` always returned `false`, so `syncDualWrite()` never ran.
- `V2_SHADOW_READS !== "1"`, so `compareV2UserParity()` never ran.

Beyond being inert, `syncDualWrite()`'s own re-projection logic had become **logically stale**:
it re-projects v2 tables FROM the request's own already-v2-native handler response — a v2→v2
round-trip, not a legacy→v2 bridge. It bridged nothing that current writes still need, since
every `/api/v2/*` handler now reads and writes `v2_*` tables directly. Likewise,
`compareV2UserParity()` compares dashboard reads against legacy tables the v2-native dashboard
read path no longer consults — the comparison had lost the thing it was meant to catch.

## Decision

Remove the dead code and its gating configuration entirely, rather than leave it disabled
indefinitely:

- Deleted `src/adapters/d1/v2Parity.ts` and `src/contracts/rollout.ts` (each was a single
  export with exactly one, now-removed, consumer).
- Removed `syncDualWrite()` and the `V2_SHADOW_READS` branch from `src/webapp/v2Api.ts`, and
  the now-unused imports that only fed them (`projectNutrition`/`projectPlan`/
  `projectUserCore`/`projectWorkout` from `v2Projection.ts` remain — they have other, live
  consumers in `v2Trainer.ts`/`v2Users.ts`/`v2Plans.ts`/`v2Workouts.ts`/`v2Nutrition.ts`, this
  ADR only removes `v2Api.ts`'s own now-dead call site).
- Removed `V2_DUAL_WRITE`, `V2_COHORT_PERCENT`, `V2_INTERNAL_USER_IDS`, `V2_SHADOW_READS` from
  `wrangler.toml`'s `[vars]` and from the `Env`/`SecretKey` types in `src/types.ts`.
  `V2_APP_ENABLED` and `CUTOVER_LEGACY_FROZEN` are untouched — they gate a different, still-live
  decision (which Mini App bundle to serve; whether legacy tables reject writes).
- Updated `README.md`'s Configuration table, `docs/feature-audit-v2.md`, and ADR-0001's status
  line to point here instead of describing machinery that no longer exists.

## Consequences

- `src/webapp/v2Api.ts`'s `forward()` is shorter and no longer computes a request body clone or
  a cohort check on every mutating request purely to feed logic that never ran.
- If a future migration needs the same staged dual-write/shadow-read pattern again (e.g. a new
  schema cutover), re-derive it fresh against that migration's actual read/write paths rather
  than reviving this one — the specific comparisons here (`plans`/`workout_logs`/
  `nutrition_logs`/`body_logs` row counts) were sized for the v2 cutover's ten domains, not a
  general-purpose tool.
