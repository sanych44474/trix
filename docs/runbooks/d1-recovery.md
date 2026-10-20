# Runbook: D1 recovery

**Owner:** repository maintainers  
**Last reviewed:** 2026-10-19  
**On-call:** no rotation is configured in this repository

## Service overview

The Telegram bot and Mini App use Cloudflare D1 through the `DB` binding in `wrangler.toml`.
The current application reads and writes the normalized `v2_*` tables. Migration
[`0089_drop_legacy_tables.sql`](../../migrations/0089_drop_legacy_tables.sql) removed 55
pre-v2 tables that held stale copies. A Worker rollback does not restore those tables or their
contents.

The deploy workflow applies D1 migrations before deploying the Worker. The repository also has
[`backup-d1.mjs`](../../scripts/backup-d1.mjs), which creates a manual SQL export, and
[`verify-schema.mjs`](../../scripts/verify-schema.mjs), which checks the live schema against the
migration files.

## Recovery objectives and dependencies

- D1 availability is checked by `GET /health/db`; it returns `200` and `{"ok":true}` when a
  read-only database ping succeeds.
- The schema must include every table and added column expected by the current migration set.
- Time Travel provides point-in-time restore. Cloudflare documents a seven-day window on Workers
  Free and a 30-day window on Workers Paid. Confirm the database backend and account plan before
  choosing a recovery point. See [Cloudflare's Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/).
- `backup-d1.mjs --remote` is a manual export to `backups/`. It is a plain SQL file containing
  personal data; the folder is gitignored, but the file is not encrypted and is not copied offsite
  by the script. Protect it as production data.
- The repository has no configured backup schedule, offsite export destination, RPO, or RTO.

### Local SQL import sanity check

This isolated check validates Wrangler's local SQL-file import path with synthetic data. It does
not validate a production export, the full application schema, or Cloudflare Time Travel:

```bash
npx wrangler d1 execute trix --local --persist-to .wrangler/restore-drill-state --file scripts/fixtures/d1-restore-drill.sql
npx wrangler d1 execute trix --local --persist-to .wrangler/restore-drill-state --json --command "SELECT id, value FROM restore_drill"
```

The expected row is `1, snapshot-import-ok`. Use a fresh `--persist-to` directory for each run.
The production recovery exercise remains separate because it mutates the live database.

## Common alerts and remediation

### `GET /health/db` returns 500 or `{ "ok": false }`

1. Check Cloudflare Worker and D1 status, then inspect the Worker logs for the `health_db` error.
2. Run `node scripts/verify-schema.mjs --remote` to identify missing tables or columns.
3. Do not run a production migration or restore until the deployed Worker version and migration
   history are understood. Both operations change production state.

### The Worker fails after a D1 migration

1. Record the deployed Worker version, the failed migration, and the last successful migration.
2. Check whether the deploy workflow applied the migration before the Worker deployment.
3. Prefer a forward fix when the migration completed and data is intact. Use point-in-time restore
   only when the data or schema cannot be recovered by a forward change.
4. Do not assume that deploying an older Worker is safe against the current schema.

### Rows were deleted or corrupted

Follow the disaster recovery procedure below. A Time Travel restore overwrites the live database
in place, cancels in-flight queries, and discards writes after the selected point. Cloudflare
returns the previous bookmark so a mistaken restore can be undone.

## Escalation path

Treat any production restore as an incident. Record the affected time range, expected lost writes,
chosen bookmark, Worker version, and validation results. The project rule in `CLAUDE.md` requires
explicit per-session approval before live D1 mutations. Do not use this runbook as that approval.

## Disaster recovery

### 1. Classify the failure

- **Mini App UI regression:** restore the required static UI files and build script from Git
  history, then keep the current `v2_*` schema and API. Do not restore D1 for a UI-only rollback.
- **Application regression:** select a Worker revision compatible with the current `v2_*` schema.
  Do not roll back schema by default.
- **D1 data or schema corruption:** continue with the in-place restore steps below.

### 2. Capture the current recovery state

Before a production restore, obtain the required approval, then export the current database:

```bash
node scripts/backup-d1.mjs --remote
```

Keep the generated SQL file protected, encrypt it before moving it off the machine, and record its
filename. Do not commit or attach it to an issue. If this export fails, stop and include that fact
in the incident record.

Inspect the current bookmark and the candidate recovery time in UTC:

```bash
npx wrangler d1 time-travel info trix
npx wrangler d1 time-travel info trix --timestamp="2026-10-19T12:00:00Z"
```

Replace the example timestamp with the incident's chosen recovery point. Confirm that it falls
within the account's Time Travel window and that the target state matches the selected Worker
revision.

### 3. Restore only after explicit approval

This command overwrites the production database in place. Replace the example timestamp with the
approved recovery point; keep its timezone explicit:

```bash
npx wrangler d1 time-travel restore trix --timestamp="2026-10-19T12:00:00Z"
```

Record both the restored bookmark and the previous bookmark printed by Wrangler. The previous
bookmark is the recovery path if this restore selected the wrong point.

### 4. Validate before normal operation

Check the schema and application health:

```bash
node scripts/verify-schema.mjs --remote
node scripts/smoke.mjs "https://YOUR_WORKER.workers.dev"
```

Replace the Worker URL with the `WORKER_URL` value in the production environment or the Worker
URL shown in Cloudflare. Confirm `/health`, `/health/db`, Mini App auth rejection, and the current
static app bundle in the smoke output.

If schema verification reports missing objects, or the restored timestamp predates a destructive
migration, stop before resuming normal traffic or applying pending migrations. In particular,
reapplying migration 0089 drops the pre-v2 tables again. Compare the restored migration tracker,
the selected Worker revision, and the required data before deciding on a forward migration or
another restore.

### 5. Close the incident

Record the selected and previous bookmarks, data-loss window, schema-check output, smoke result,
and follow-up changes. Protect or securely delete the exported SQL file according to the
incident's data-handling requirements.
