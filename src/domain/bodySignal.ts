// Body signal in a coach chat message: turns two Clef reads (is the writer reporting pain, and how
// serious is it) into a single optional hint for the Mini App. Pure; the caller passes plain values.
// Only a clear report of pain with a clear severity produces a signal: mild soreness and low
// confidence never do, so the card stays rare and the coach reply itself is never changed.
// test/body-signal.test.ts.

export type BodySignal = { kind: "injury" | "urgent" };

export const PAIN_MIN = 0.75;
export const INJURY_MIN_CONFIDENCE = 0.6;
export const URGENT_MIN_CONFIDENCE = 0.5;

/** `pain` is the probability the message reports pain (null when Clef gave no answer). */
export function bodySignalFrom(pain: number | null, severity: { choice: string; confidence?: number } | null): BodySignal | null {
  if (pain === null || pain < PAIN_MIN || !severity || severity.confidence === undefined) return null;
  if (severity.choice === "injury" && severity.confidence >= INJURY_MIN_CONFIDENCE) return { kind: "injury" };
  if (severity.choice === "urgent" && severity.confidence >= URGENT_MIN_CONFIDENCE) return { kind: "urgent" };
  return null;
}
