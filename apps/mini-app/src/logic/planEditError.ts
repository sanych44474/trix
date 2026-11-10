// What the plan editor says when the server refuses an edit. An exercise that loads an active
// injury directly comes back as 409 "injury:<area>" (features/plan/planEdits.ts); the editor names
// the injury instead of "Something went wrong".
const AREAS = new Set(["shoulder", "elbow", "wrist", "lower_back", "knee", "hip", "ankle", "neck"]);

/** The injured area an edit was refused for, or null when it was refused for another reason. */
export function injuryRefusalArea(err: unknown): string | null {
  const message = err instanceof Error ? err.message : "";
  const m = message.match(/^injury:([a-z_]+)$/);
  return m && AREAS.has(m[1]) ? m[1] : null;
}
