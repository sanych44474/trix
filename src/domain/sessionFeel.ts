// "How did it go?" after a workout, as the effort the progression already reads. Each exercise
// of the session without its own RPE takes the session's: easy (6.5) lets the weekly progression
// take a double step (nextTarget treats RPE <= 7 as easy), ok (8) a normal one, hard (9.5) holds
// the load like a missed rep would. Pure; test/session-feel.test.ts.
export type SessionFeel = "easy" | "ok" | "hard";

export const FEEL_RPE: Record<SessionFeel, number> = { easy: 6.5, ok: 8, hard: 9.5 };

export function parseFeel(v: unknown): SessionFeel | null {
  return v === "easy" || v === "ok" || v === "hard" ? v : null;
}
