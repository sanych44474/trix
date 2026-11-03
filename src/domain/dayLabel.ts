// A training day's label (PlanDay.muscleGroup): the "Chest/Triceps" line every client shows above
// the day's exercises, and the {group} in workout reminders. The plan builder writes it; the
// rename edit lets the athlete or their trainer replace it when the exercises no longer match.
//
// It stays free text rather than a pick from DAY_GROUPS: real labels combine groups
// ("Груди/Трицепс", "Upper A") and the AI writes them that way too. Renderers escape it, so the
// only rules here are shape: one line, no control characters, a length that fits a button.

/** Longest label kept. Bot keyboards cut "<weekday> — <label> (n)" at 56 characters. */
export const DAY_LABEL_MAX = 40;

/** The label to store, or null when nothing usable is left after cleaning. */
export function normalizeDayLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // Cut by code point, so an emoji or other astral character is never split in half.
  const chars = Array.from(cleaned);
  return chars.length > DAY_LABEL_MAX ? chars.slice(0, DAY_LABEL_MAX).join("").trimEnd() : cleaned;
}

/** The editor's group chips: add `group` to a draft label as "A/B", skipping one already in it. */
export function addGroupToLabel(draft: string, group: string): string {
  const parts = draft.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.includes(group) ? draft : [...parts, group].join("/");
}
