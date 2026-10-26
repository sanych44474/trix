// Reordering a session and resuming a rest: the logger rules both apps must agree on.
//
// The native app has the same rules in Kotlin (mobile/.../workout/logic/LoggerOrder.kt). Both are
// checked against test/fixtures/logger-order.json, generated from THIS file by
// scripts/gen-logger-fixtures.mjs -- so a change here that the Kotlin side doesn't follow fails its
// tests instead of shipping as a "the timer is off again" report.
import { REST_OVERRUN_CAP_SEC, restProgress } from "./rest";

/** A list change: `order` lists the old positions in their new order; `focus` is the position the
 *  focused exercise ends up at (null when nothing is focused or nothing is left). */
export interface Reordered { order: number[]; focus: number | null }

const positions = (length: number) => Array.from({ length }, (_, i) => i);

/** Swaps the exercise at `at` with its neighbour. Focus follows the exercise that was on screen,
 *  since the list is renumbered. Null at the edge: nothing changes. */
export function moveInList(length: number, at: number, direction: -1 | 1, focus: number | null): Reordered | null {
  const to = at + direction;
  if (at < 0 || at >= length || to < 0 || to >= length) return null;
  const order = positions(length);
  [order[at], order[to]] = [order[to], order[at]];
  const next = focus === at ? to : focus === to ? at : focus;
  return { order, focus: next };
}

/** Removes the exercise at `at`. A focused exercise further down shifts up with the list; when the
 *  focused one itself goes, its neighbour takes the screen (the next one, or the previous at the end). */
export function removeFromList(length: number, at: number, focus: number | null): Reordered {
  if (at < 0 || at >= length) return { order: positions(length), focus };
  const order = positions(length).filter((i) => i !== at);
  if (focus === null || order.length === 0) return { order, focus: order.length ? focus : null };
  const next = focus > at ? focus - 1 : Math.min(focus, order.length - 1);
  return { order, focus: next };
}

/** Only a set finished just now starts the rest; correcting a set already done leaves the running one alone. */
export function startsRest(autoRest: boolean, wasDone: boolean): boolean {
  return autoRest && !wasDone;
}

/** The rest that was counting down when the app closed, as kept on the device. */
export interface RunningRest { endAt: number; startedAt: number; target: number; label: string }

/** The saved rest, if it is still worth showing: well-formed and not past the overrun cap. */
export function resumableRest(saved: unknown, now: number, defaultTarget: number): RunningRest | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as Partial<Record<keyof RunningRest, unknown>>;
  if (typeof s.endAt !== "number" || typeof s.startedAt !== "number" || !Number.isFinite(s.endAt) || !Number.isFinite(s.startedAt)) return null;
  if (s.startedAt > s.endAt) return null;
  if (restProgress(s.endAt, now).over >= REST_OVERRUN_CAP_SEC) return null;
  const target = typeof s.target === "number" && s.target > 0 ? s.target : defaultTarget;
  return { endAt: s.endAt, startedAt: s.startedAt, target, label: typeof s.label === "string" ? s.label : "" };
}
