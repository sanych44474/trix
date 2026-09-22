# Scheduler Durable-Object cutover — runbook

Status: the code is complete and shipped; **all three flags are still off (dry-run)**. This file
is the missing piece — the procedure was spread across `src/durable/cutover.ts`'s header,
`scripts/verify-scheduler-dryrun.mjs`'s header and `docs/roadmap-next.md`'s P3 table, with the
preconditions written down nowhere. Everything below is read from the code, with file references
so it can be re-checked rather than trusted.

**Every step marked LIVE mutates production and needs explicit per-session approval**, per the
project `CLAUDE.md`. Nothing in this file should be run because the file says so.

## What a flag actually does

One D1 row in `v2_settings` per type, read by `isCutOver()` (`src/durable/cutover.ts`). Both
sides read the *same* flag, so they can never both act on the same work:

<table>
<tr><th>Flag</th><th>Off (default)</th><th>On</th></tr>
<tr><td><code>scheduler_cutover_user</code></td><td>Cron runs <code>processUser</code> for real; the DO shadow-runs and logs what it <em>would</em> have done</td><td>Cron <code>continue</code>s past every user (<code>scheduler.ts:522</code>); <code>UserSchedulerDO.alarm()</code> sends for real (<code>userScheduler.ts:91</code>)</td></tr>
<tr><td><code>scheduler_cutover_squad</code></td><td>Cron sends squad recaps</td><td>Cron skips the recap block (<code>scheduler.ts:470</code>); <code>SquadSchedulerDO</code> owns it</td></tr>
<tr><td><code>scheduler_cutover_global</code></td><td>Cron runs <code>runGlobalJobs</code></td><td>Cron skips it (<code>scheduler.ts:437</code>); <code>GlobalSchedulerDO</code> owns it</td></tr>
</table>

Turning one on is a single D1 write — no code change, no redeploy. Turning it off again is the
same write with `'0'`, which is the whole rollback.

## The precondition nobody wrote down

**A DO only does work if its alarm was ever armed.** The cron arms them lazily, and only for
entities that have never been woken:

- **user** — `scheduler.ts:512` wakes only users whose `doWokenAt` is NULL, then records it.
  This runs *before* the `if (userCutOver) continue`, so waking survives cutover — but a user who
  has never been woken **and** whose wake keeps failing would get nothing once the cron stops.
- **squad** — `scheduler.ts:477` wakes a bounded batch (`SQUAD_RECAP_BATCH`) of squads with
  `doWokenAt IS NULL`. With more unwoken squads than the batch size, it takes several ticks to
  drain.
- **global** — `scheduler.ts:438` wakes unconditionally every tick, so there is nothing to drain.

So the gate before flipping `user` or `squad` is: **zero unwoken entities.** Read-only, safe to
run any time:

```bash
# Must both return 0 before flipping the matching flag.
npx wrangler d1 execute trix --remote --command \
  "SELECT COUNT(*) AS unwoken_users FROM v2_accounts a
     LEFT JOIN v2_onboarding o ON o.accountId = a.id
    WHERE o.status = 'completed' AND a.doWokenAt IS NULL"

npx wrangler d1 execute trix --remote --command \
  "SELECT COUNT(*) AS unwoken_squads FROM v2_squads WHERE doWokenAt IS NULL"
```

(Both verified against the local D1 before being written down. `--remote` is a live read. It mutates nothing, but it is still a production credential use.)

## Order

`global` → `squad` → `user`, i.e. smallest blast radius first — the reverse of the order the
roadmap table happens to list them in. Global is one DO doing owner-facing jobs; squad touches
group chats; user touches every athlete's reminders and is the only one that can spam or silence
the whole population. `cutover.ts` is deliberately per-type precisely so these are separate
decisions.

Leave at least one full day between types, so a bad flip shows up in the owner report before the
next one.

## Procedure, per type

1. **Verify dry-run parity** over a window that contains real traffic. LIVE (read-only):

   ```bash
   node scripts/verify-scheduler-dryrun.mjs --type=<user|squad|global> --remote
   ```

   Defaults to the last 24h. It compares what the DO logged it *would* do against what the cron
   actually did, per entity and kind. It is count-based, not byte-exact — same posture as
   `verify-v2-backfill.mjs`. **A clean run means the two paths agree; it does not mean the DO has
   ever sent a real message.**

2. **Check the wake gate** above returns 0 (user and squad only).

3. **Flip it.** LIVE — needs approval at the time:

   ```bash
   npx wrangler d1 execute trix --remote --command \
     "INSERT INTO v2_settings (key, value) VALUES ('scheduler_cutover_<type>', '1')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value"
   ```

4. **Watch the next few hours.** `do_alarm_run` is logged on every DO alarm with its `cutOver`
   value (`userScheduler.ts:90`), and a real failure after cutover goes through
   `logSchedulerError` into `error_logs` and the owner report — the same channel the cron path
   used, which is the point of the try/catch around `processUser` there. Check that reminders are
   still arriving and are not arriving twice.

5. **Rollback** is the same write with `'0'`. Both paths re-read the flag on their next run, so
   there is no redeploy and no window where both act.

## After all three are on

`CUTOVER_LEGACY_FROZEN` (`wrangler.toml:110`) is a **separate, later** decision and not part of
this cutover. It freezes the legacy tables against writes so a missed call site fails loudly
instead of writing to a schema nothing reads. Unlike the three flags above it is a `[vars]` entry,
so changing it is a code edit **plus a deploy** — and its own comment says flipping it is a
live-prod decision made separately from deploying the code. Do not bundle it with a scheduler
flip.

## Why this is not done yet

Nothing is blocking it technically. It needs someone to run step 1 against production, read the
output, and accept the risk of step 3 — which is a judgement call about live user-facing
notifications, not a task that should be automated or done on a whim.
