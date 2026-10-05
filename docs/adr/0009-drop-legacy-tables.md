# ADR-0009: drop the pre-v2 tables

- Status: accepted
- Date: 2026-10-05
- Completes [ADR-0001](0001-v2-seams-and-staged-cutover.md) and [ADR-0004](0004-retire-dual-write-and-shadow-reads.md)

## Context

Since the v2 cutover every domain reads and writes `v2_*` tables, and the legacy repo layer
(`src/db/repos`) has been removed. The 55 pre-v2 tables only held stale copies of personal data
that account deletion still had to clear, plus a write freeze (`legacyFreeze.ts`,
`CUTOVER_LEGACY_FROZEN`) guarding them.

## Decision

- `migrations/0089_drop_legacy_tables.sql` drops the 55 pre-v2 tables. `scheduler_dryrun_log`
  stays: the Durable-Object dry run still writes it.
- `deleteUserData` (`adapters/d1/v2Account.ts`) clears `v2_*` tables only.
- Remove the legacy write freeze and the `CUTOVER_LEGACY_FROZEN` var: nothing is left to freeze.
- Remove `scripts/verify-v2-backfill.mjs`, the cutover parity check.

## Consequences

- Before the drop, a scan of `src/` found no SQL against these tables (only comments), and no
  `v2_*` table has a foreign key into them.
- The drop can't be undone from the app. D1 Time Travel can restore the database to a point
  before migration 0089 (within its retention window) if a missed reader ever turns up.
