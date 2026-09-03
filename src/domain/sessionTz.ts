// Pure timezone math for trainer↔client sessions. A session stores the (date, hour) in the
// booker's IANA zone (`sessions.tz`); the other party may live in a different zone, so their
// view converts the wall time. tz = NULL keeps the v1 same-city assumption (no conversion).

/** Offset of `tz` from UTC (ms) at the given UTC instant. */
function tzOffsetMs(tz: string, atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = dtf.formatToParts(new Date(atUtcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return asUtc - atUtcMs;
}

/** Convert a session's wall time expressed in `fromTz` to the viewer's `toTz`.
 * Missing/equal zones return the stored time unchanged. */
export function sessionTimeFor(
  date: string,
  hour: number,
  fromTz: string | null | undefined,
  toTz: string | null | undefined,
): { date: string; hour: number } {
  if (!fromTz || !toTz || fromTz === toTz) return { date, hour };
  try {
    // UTC instant of `${date} ${hour}:00` in fromTz: start from the naive-UTC guess, then
    // correct by the zone offset (second pass handles a DST boundary near the instant).
    const naive = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
    let utc = naive - tzOffsetMs(fromTz, naive);
    utc = naive - tzOffsetMs(fromTz, utc);
    // Round to the NEAREST hour (the model stores whole hours): a :30/:45-offset zone
    // (India, Iran, Nepal) would otherwise truncate and show up to 45 minutes early.
    const target = new Date(Math.round((utc + tzOffsetMs(toTz, utc)) / 3_600_000) * 3_600_000);
    return { date: target.toISOString().slice(0, 10), hour: target.getUTCHours() };
  } catch {
    return { date, hour }; // bad zone id → show as stored
  }
}
