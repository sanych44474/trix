# ADR-0015: reminders, squad recaps and global jobs run only in Durable Objects

- Status: accepted
- Date: 2026-11-10
- Completes the scheduler part of [ADR-0001](0001-v2-seams-and-staged-cutover.md). Related:
  [ADR-0002](0002-no-do-rest-timer.md), [ADR-0011](0011-rest-notification-has-one-owner.md).

## Context

The hourly work had two implementations that ran side by side:

- The cron (`src/scheduler.ts`) looped over every onboarded user in one invocation, posted the
  squad recaps and ran the global jobs.
- Three Durable Objects (`src/durable/`) ran the same functions per user, per squad and once
  globally. Until a `scheduler_cutover_<type>` flag in `v2_settings` was `1`, a Durable Object
  ran against a shadow database and a logging sender, and wrote what it would have done to
  `scheduler_dryrun_log`.

Three flags decided which side acted for real. The `Scheduler cutover` workflow flipped them and
was also the rollback.

All three flags are on in production. The workflow run of 2026-11-10 15:16 UTC read
`scheduler_cutover_user = 1`, `scheduler_cutover_squad = 1` and `scheduler_cutover_global = 1`.
The squad flag was enabled on 2026-10-06 and the user flag on 2026-10-14. The workflow logs do
not show when the global flag was enabled.

With the flags on, the cron's user pass, its squad recap sweep, its global jobs call and the
whole dry-run mode were code that production never ran, and every user was still loaded once an
hour by a loop that then skipped them.

## Decision

The Durable Objects are the only scheduler for this work. The flags and the dry-run mode are
removed.

<table>
<tr><th>Work</th><th>Runs in</th></tr>
<tr><td>Per-user reminders (<code>processUser</code>)</td><td><code>UserSchedulerDO</code> alarm, hourly at hh:01</td></tr>
<tr><td>Weekly squad recap</td><td><code>SquadSchedulerDO</code> alarm, from 09:00 UTC</td></tr>
<tr><td>Owner alerts, leaderboard cache, stale drafts, pruning, daily rollup</td><td><code>GlobalSchedulerDO</code> alarm, hourly</td></tr>
<tr><td>Outbox retries, rest timers, onboarding recovery, R2 and knowledge-base upkeep, Strava import, buddy duels, comeback openers</td><td>The cron, unchanged</td></tr>
<tr><td>Arming the Durable Object of a user or squad that was never woken, and keeping the global one armed</td><td>The cron, unchanged</td></tr>
</table>

Removed:

- `src/durable/cutover.ts`, `dryRunEnv.ts` and `shadowDb.ts`, and the dry-run branch of each
  Durable Object.
- The cron's `processUser` loop, `postSquadRecaps` and its `runGlobalJobs` call.
- `.github/workflows/scheduler-cutover.yml`, `docs/scheduler-do-cutover-runbook.md` and
  `scripts/verify-scheduler-dryrun.mjs`.
- The table `scheduler_dryrun_log` (`migrations/0108_drop_scheduler_dryrun_log.sql`), its weekly
  prune and the per-account and per-squad deletes. Its rows held message texts.

Kept:

- `processUser`, `buildSinglePass` and the reminder list stay in `src/scheduler.ts`. Moving them
  is a separate change.

## Consequences

- There is no flag to send the work back to the cron. A rollback is a revert of this change and
  a redeploy. The three `scheduler_cutover_*` rows in `v2_settings` are no longer read.
- A database with no flags set (local, tests, a new environment) now sends reminders from the
  Durable Objects. Before, it sent them from the cron.
- The cron no longer loads every active plan and a day of workout logs each hour.
- A Durable Object that is never armed never fires. The cron's wake sweep is the only thing that
  arms a user who was onboarded without a wake, so it must stay.
- The deploy applies migrations before it deploys the Worker. Between those two steps the old
  Worker still names `scheduler_dryrun_log` in the account-delete and squad-delete batches, so a
  delete in that window fails as a whole and has to be repeated. A revert to a Worker older than
  this change has the same failure until the table is recreated.
- `squadsDueForRecap` (`adapters/d1/v2Gamification.ts`) has no caller left outside its tests.

## Follow-up

Delete the three `scheduler_cutover_*` rows from `v2_settings`. They are no longer read.
