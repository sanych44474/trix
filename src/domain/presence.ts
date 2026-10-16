// "Was this person here?" - the one definition. Until now two things stood in for it and both were
// wrong in different ways:
//  - the owner report and the daily DAU/WAU/MAU counted accounts by `updatedAt`, which every write
//    bumps (a reminder, a quest close, a cron sweep), so a sleeping user looked active;
//  - `lastSeenAt` was written by the bot only, and the chat is retired, so for anyone who lives in the
//    Mini App it stopped moving.
// Presence is now recorded by BOTH surfaces through recordPresence() (adapters/d1/v2Presence.ts) and
// every "active" count reads `lastSeenAt`. Pure; test/presence.test.ts.

/** A gap wider than this between two interactions opens a new session (docs/slos.md section 2). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/** `lastSeenAt` is rewritten at most this often. The Mini App makes several requests a minute while
 * it is open; one write per minute keeps the value within a minute of the truth (so the session
 * boundary above is exact to a minute) without a write on every request. */
export const PRESENCE_WRITE_GAP_MS = 60 * 1000;

export interface PresenceStep {
  /** Write `lastSeenAt = now`. */
  write: boolean;
  /** This interaction opens a new session (log `session_started`). */
  newSession: boolean;
}

export function presenceStep(prevSeen: Date | undefined, nowMs: number): PresenceStep {
  const prev = prevSeen ? prevSeen.getTime() : 0;
  const gap = nowMs - prev;
  return { write: gap >= PRESENCE_WRITE_GAP_MS, newSession: gap > SESSION_IDLE_MS };
}
