# ADR-0002: keep the cron-based rest timer, do not build a Durable Object

- Status: accepted
- Date: 2026-09-17

## Context

`docs/feature-audit-v2.md` listed "a real server-push (Durable Object alarm) timer delivery" as
the one remaining long-tail item for the Mini App's guided workout logger. That framing turned
out to be inaccurate: the rest timer already has real server-side delivery.

`POST /api/v2/workout/rest` (`src/webapp/workoutApi.ts`) persists a due timestamp into
`v2_rest_timers` via `setRestTimer` (`src/adapters/d1/v2Admin.ts`). The existing per-minute cron
(`crons = ["* * * * *"]` in `wrangler.toml`, `src/scheduler.ts`) polls `dueRestTimers` every tick
and sends a real Telegram "rest done" message, then clears the row via `deleteRestTimers`. The
Mini App's client-side countdown (`apps/mini-app/src/TrainView.tsx`) is a local, resilient-to-
backgrounding *display* of the same deadline — it is not the only delivery mechanism, and losing
it (app closed, phone locked) does not lose the notification.

The actual gap is **precision**: because the cron polls once per minute, delivery can lag up to
~60 seconds behind the exact moment the rest period ends. A dedicated Durable Object with its own
alarm, addressed per active rest timer, would deliver within a second instead.

## Decision

Do not build a rest-timer Durable Object. Keep the existing minute-cron + `v2_rest_timers` path.

Closing this precision gap "properly" would mean: a new DO class (the existing
`UserSchedulerDO` already owns one alarm purpose — an hourly reminder cadence — and a one-shot,
30–900-second, cancelable rest timer is a different enough lifecycle that overloading its single
alarm slot is not a good fit), its own `wrangler.toml` binding and migration entry, and — to stay
consistent with how the other three DOs in this codebase are rolled out — its own dry-run/cutover
safety layer (`src/durable/cutover.ts`, `shadowDb.ts`) and tests mirroring
`test/vitest/user-scheduler-do*.test.ts`.

That is a real amount of new, permanent infrastructure to shave at most 60 seconds off a
notification for a rest period that itself lasts minutes. The cost is not proportional to the
benefit.

## Consequences

- `docs/feature-audit-v2.md`'s workout-logging row now describes the rest timer accurately
  (real push exists, ~60s worst case) instead of implying delivery is missing.
- If a future need for sub-second timer precision emerges (e.g. a feature that depends on exact
  timing, not just "soon"), revisit this decision explicitly rather than silently reopening it.
- No code changes; this ADR only corrects the record.
