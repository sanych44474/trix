// When a scheduler Durable Object's next hourly alarm fires. `setAlarm(Date.now() + 1h)` measured
// from whenever the alarm happened to run, so each hour landed a little later than the last, and
// slots that must hit an exact local hour (water every N hours from 09:00) were eventually skipped.
// The alarm instead targets the next hh:01: a minute past the hour, after the cron's :00 tick.

const HOUR_MS = 3_600_000;
/** A minute past the hour: clear of the cron's own :00 tick. */
const OFFSET_MS = 60_000;

export function nextHourlyAlarm(nowMs: number): number {
  const thisSlot = Math.floor(nowMs / HOUR_MS) * HOUR_MS + OFFSET_MS;
  return thisSlot > nowMs ? thisSlot : thisSlot + HOUR_MS;
}
