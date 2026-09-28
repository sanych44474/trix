// Strava -> trix cardio mapping. Pure and unit-tested (test/strava.test.ts); the HTTP and storage
// live in src/features/strava/. Names match the bot's own cardio menu (bot/survey.ts), so an
// imported run and a run typed in chat are the same exercise to records and conditioning load.
import type { Lang, LoggedExercise } from "../types";

/** The subset of Strava's SummaryActivity this uses. */
export interface StravaActivity {
  id: number;
  sport_type?: string;
  type?: string; // legacy field, used when sport_type is absent
  start_date_local: string; // "2026-09-25T18:03:11Z" -- local wall time with a Z (Strava quirk)
  moving_time: number; // seconds
  distance: number; // meters
}

type Kind = "run" | "bike" | "swim" | "walk" | "hike" | "row" | "ellipt" | "other";

const NAMES: Record<Kind, { en: string; uk: string }> = {
  run: { en: "Running", uk: "Біг" },
  bike: { en: "Cycling", uk: "Велосипед" },
  swim: { en: "Swimming", uk: "Плавання" },
  walk: { en: "Walking", uk: "Ходьба" },
  hike: { en: "Hiking", uk: "Похід" },
  row: { en: "Rowing", uk: "Веслування" },
  ellipt: { en: "Elliptical", uk: "Еліптичний" },
  other: { en: "Cardio", uk: "Кардіо" },
};

// Strength sessions are logged in trix itself; importing Strava's "WeightTraining" would only
// duplicate them as a set-less entry. Yoga/stretching etc. are not conditioning load either.
const SKIP = new Set(["WeightTraining", "Crossfit", "Yoga", "Pilates", "Workout"]);

export function activityKind(a: Pick<StravaActivity, "sport_type" | "type">): Kind | null {
  const t = a.sport_type || a.type || "";
  if (SKIP.has(t)) return null;
  if (/Run$/.test(t)) return "run"; // Run, TrailRun, VirtualRun
  if (/Ride$/.test(t) || t === "Velomobile" || t === "Handcycle") return "bike"; // Ride, VirtualRide, GravelRide, MountainBikeRide, EBikeRide...
  if (t === "Swim") return "swim";
  if (t === "Walk") return "walk";
  if (t === "Hike") return "hike";
  if (t === "Rowing" || t === "VirtualRow" || t === "Canoeing" || t === "Kayaking") return "row";
  if (t === "Elliptical" || t === "StairStepper") return "ellipt";
  return t ? "other" : null;
}

export function activityDate(a: StravaActivity): string {
  return a.start_date_local.slice(0, 10);
}

/** One activity -> one logged cardio exercise (a single set: time + distance), or null to skip. */
export function activityToExercise(a: StravaActivity, lang: Lang): LoggedExercise | null {
  const kind = activityKind(a);
  if (!kind) return null;
  const seconds = Math.round(a.moving_time || 0);
  const meters = Math.round(a.distance || 0);
  if (seconds < 60 && meters < 100) return null; // an accidental start/stop
  const name = lang === "uk" ? NAMES[kind].uk : NAMES[kind].en;
  return {
    name,
    skipped: false,
    setsDone: [{ reps: 0, weight: 0, ...(seconds > 0 ? { seconds } : {}), ...(meters > 0 ? { meters } : {}) }],
  };
}

/** Groups new activities by local date, already mapped; activities already imported are dropped. */
export function planImport(
  activities: StravaActivity[],
  alreadyImported: Set<number>,
  lang: Lang,
): Map<string, Array<{ activityId: number; exercise: LoggedExercise }>> {
  const byDate = new Map<string, Array<{ activityId: number; exercise: LoggedExercise }>>();
  for (const a of [...activities].sort((x, y) => (x.start_date_local < y.start_date_local ? -1 : 1))) {
    if (alreadyImported.has(a.id)) continue;
    const exercise = activityToExercise(a, lang);
    if (!exercise) continue;
    const date = activityDate(a);
    byDate.set(date, [...(byDate.get(date) ?? []), { activityId: a.id, exercise }]);
  }
  return byDate;
}
