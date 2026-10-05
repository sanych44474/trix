// Block periodization (mesocycles): an OVERLAY on the existing adaptive engine, not a rewrite.
// A plan optionally carries a block phase + week counter; the scheduler advances it weekly, the
// UI surfaces it, and AI plan-regen is told the target phase. The per-phase guidance below is
// what the coach/AI aims for — the concrete set/rep math stays in the progression engine.

export type MesoPhase = "hypertrophy" | "strength" | "peak" | "deload";

export interface Mesocycle {
  phase: MesoPhase;
  weekInBlock: number; // 1-based week within the current phase
  blockLength: number; // weeks per phase before advancing (deload is always 1 week)
  /** During a deload: the training phase it follows, so the next block can alternate. */
  after?: MesoPhase;
}

// Build muscle → unload → build strength → unload → repeat: a deload after every block (every
// blockLength+1 weeks, the usual 4–6), not once per 13 weeks. "peak" (1–3 reps near failure) is
// no longer entered automatically — it is a competition taper, not something a general gym-goer
// should spend a month in; a plan already in it gets one more week at most, then a deload.
const PEAK_MAX_WEEKS = 1;

export function defaultMesocycle(blockLength = 4): Mesocycle {
  return { phase: "hypertrophy", weekInBlock: 1, blockLength };
}

/** Advance one week. Returns the next state; deload lasts exactly one week regardless of
 * blockLength (an unload week, then back to hypertrophy). */
export function advanceMesocycle(m: Mesocycle): Mesocycle {
  const len = m.phase === "deload" ? 1 : m.phase === "peak" ? PEAK_MAX_WEEKS : Math.max(1, m.blockLength);
  if (m.weekInBlock < len) return { ...m, weekInBlock: m.weekInBlock + 1 };
  const { after: _after, ...rest } = m;
  if (m.phase !== "deload") return { ...rest, phase: "deload", weekInBlock: 1, after: m.phase };
  return { ...rest, phase: m.after === "hypertrophy" ? "strength" : "hypertrophy", weekInBlock: 1 };
}

/** This week of a plan: deload or not, and the block phase when the plan has one. The ONE
 *  answer to "is this a deload week?" — the bot's today card, the Monday deload notice and the
 *  weekly recap all read it, so they can't disagree. A plan with a mesocycle deloads in its
 *  deload phase; one without deloads every `deloadInterval` (default 4) weeks since it started. */
export function trainingWeek(
  plan: { mesocycle?: Mesocycle; generatedAt: Date | string; deloadInterval?: number },
  today: string,
): { deload: boolean; phase?: MesoPhase; weekInBlock?: number; blockLength?: number } {
  if (plan.mesocycle) {
    const m = plan.mesocycle;
    return { deload: m.phase === "deload", phase: m.phase, weekInBlock: m.weekInBlock, blockLength: m.phase === "deload" ? 1 : m.blockLength };
  }
  const start = typeof plan.generatedAt === "string" ? plan.generatedAt : plan.generatedAt.toISOString();
  const days = (Date.parse(today) - Date.parse(start.slice(0, 10))) / 86_400_000;
  const weeks = days < 0 ? 0 : Math.floor(days / 7);
  const interval = plan.deloadInterval && plan.deloadInterval > 0 ? plan.deloadInterval : 4;
  return { deload: weeks > 0 && weeks % interval === 0 };
}

/** Per-phase programming guidance — rep range, intensity cue, and an emoji for the UI. */
export function phaseGuidance(phase: MesoPhase): { reps: string; intensity: string; emoji: string } {
  switch (phase) {
    case "hypertrophy":
      return { reps: "8–12", intensity: "RPE 7–8", emoji: "🧱" };
    case "strength":
      return { reps: "3–6", intensity: "RPE 8–9", emoji: "🏋️" };
    case "peak":
      return { reps: "1–3", intensity: "RPE 9–10", emoji: "🔺" };
    case "deload":
      return { reps: "8–10", intensity: "RPE 5–6 (light)", emoji: "🌙" };
  }
}

/** i18n key for the phase name (both catalogs define meso_phase_*). */
export function phaseKey(phase: MesoPhase): string {
  return `meso_phase_${phase}`;
}

/** Hold the weekly progression: this week is a deload, or the week that just ended was one (its
 *  logs are light on purpose). Mesocycle state is advanced first on Monday (scheduler
 *  "meso_advance"), so week 1 of a training block means last week was its deload. */
export function deloadProgressionHold(
  plan: { mesocycle?: Mesocycle; generatedAt: Date | string; deloadInterval?: number },
  today: string,
): boolean {
  const m = plan.mesocycle;
  if (m) return m.phase === "deload" || (m.weekInBlock === 1 && (m.phase === "hypertrophy" || m.phase === "strength"));
  const lastWeek = new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10);
  return trainingWeek(plan, today).deload || trainingWeek(plan, lastWeek).deload;
}

