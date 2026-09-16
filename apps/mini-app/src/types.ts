export interface V2Envelope<T> {
  data: T;
  meta?: { version: 2; requestId?: string };
}

export interface V2Failure {
  error: { code: string; message: string; requestId?: string };
}

export interface Dashboard {
  viewer: { id: number; role: "solo" | "trainer" | "client"; onboarded: boolean };
  lang: "uk" | "en";
  today: string;
  name?: string;
  weight: { points: { date: string; kg: number }[]; goal?: number; projection?: { slopePerWeek: number; etaWeeks?: number; onTrack: boolean; reached: boolean } };
  calendar: { days: { date: string; s: "done" | "missed" | "rest" }[]; split: { weekday: number; group: string; n: number }[]; logs: { date: string; done: boolean; ex: { n: string; s: number }[] }[] };
  volume: { group: string; sets: number; mev: number; mav: number; zone: string }[];
  conditioning: { sessions: number; minutes: number; meters: number; zone: string };
  recovery: { score: number; label: string; factors: string[] };
  measurements?: { key: string; points: { date: string; v: number }[] }[];
  exercises: { name: string; group: string; points: { date: string; e1rm: number }[] }[];
  macros: { targets?: { calories: number; protein: number; fats: number; carbs: number }; days: { date: string; kcal: number; p: number; f: number; c: number; training: boolean }[] };
  gamification?: { level: number; xp: number; intoLevel: number; needed: number; streak?: number };
  todayStats?: { waterMl: number; waterGoal: number; steps: number; stepsGoal: number };
  logForm?: { exercises: string[] };
  trainer?: { clients: { id: number; name: string; workoutPct: number; nutritionPct: number; atRisk: boolean; flagged: boolean; missedDates?: [string, string] }[] };
  owner?: { funnel: { total: number; onboarded: number; active7: number; active30: number }; ai: { provider: string; calls: number; fallbacks: number; avgLatencyMs: number; tokens: number }[] };
}

export interface WorkoutToday {
  date: string;
  weekday: number;
  title?: string;
  restDay?: boolean;
  muscleGroup?: string;
  exercises: Array<{
    index: number;
    name: string;
    metric: "reps" | "time" | "distance";
    sets: number;
    reps?: number;
    weightKg?: number;
    planSets?: string;
    planWeight?: string;
    technique?: string;
    videoUrl?: string;
    videoTitle?: string;
    last?: Array<{ w: number; r: number; sec: number; m: number }>;
    ssGroup?: string;
    wmode?: "total" | "perSide" | "perHand";
    setsDone?: Array<{ weight: number; reps: number; seconds?: number; meters?: number; rpe?: number }>;
    rpe?: number;
    completed?: boolean;
    restSec?: number;
  }>;
  saved?: Array<{ name: string; rpe?: number; sets: Array<{ w: number; r: number; sec: number; m: number }> }>;
  recentDates?: string[];
  alreadyLogged?: boolean;
}

export interface Plan {
  owner: { id: number; name: string };
  editable: boolean;
  version: string;
  days: Array<{ weekday: number; name: string; muscleGroup: string; exercises: Array<{
    index: number;
    name: string;
    sets: string;
    startWeight: string;
    metric: string;
    technique?: string;
    videoUrl?: string;
    videoTitle?: string;
    ssGroup?: string;
    wmode?: "total" | "perSide" | "perHand";
  }> }>;
}

export interface Nutrition {
  date: string;
  meals: Array<{ index: number; desc: string; kcal: number; protein: number; fats: number; carbs: number; grams?: number | null; query?: string | null }>;
  totals: { kcal: number; protein: number; fats: number; carbs: number };
  targets?: { calories: number; protein: number; fats: number; carbs: number };
  // True when today's targets are the plan's lower-carb/calorie rest-day macros rather than the
  // regular training-day target (server picks whichever applies -- see dayTargets() in
  // src/webapp/nutritionApi.ts).
  isRestDay?: boolean;
  mealPlan?: { days: Array<{ label: string; meals: Array<{ name: string; items: Array<{ food: string; grams: number }>; kcal: number; protein: number }> }> } | null;
  recent?: Array<{ ri: number; desc: string; kcal: number; protein: number }>;
}

export interface WorkoutHistoryItem {
  date: string;
  title: string; // first few exercise names, comma-joined, for the picker
  n: number; // exercise count
}

export interface WorkoutCopySet {
  w: number;
  r: number;
  sec: number;
  m: number;
}

export interface WorkoutCopyExercise {
  name: string;
  metric: "reps" | "time" | "distance";
  sets: WorkoutCopySet[];
  rpe: number;
}

export interface FoodSearchItem {
  name: string;
  brand?: string;
  per100: { kcal: number; p: number; f: number; c: number };
}

export interface WeekCardStats {
  since: string;
  until: string;
  done: number;
  planned: number;
  totalSets: number;
  volumeKg: number;
  prs: number;
  streak: number;
  level: number;
  xp: number;
}

export interface WeekCardResponse {
  card: string | null;
  stats: WeekCardStats | null;
  name: string;
}

export interface PlatesResponse {
  plan: { loaded: number; perSide: number[]; leftover: number } | null;
  ramp: Array<{ weight: number; reps: number; pct?: number }>;
}

export interface LibraryProgram {
  code: string;
  name: string;
  takenCount: number;
}

export interface LibraryResponse {
  role: "solo" | "trainer" | "client";
  programs: LibraryProgram[];
}

export interface ProfilePhoto {
  id: number;
  takenAt: string;
}

export interface SquadEntry {
  name: string;
  workouts: number;
  me: boolean;
  medal: string;
}

export interface SquadInfo {
  title: string | null;
  memberCount: number;
  entries: SquadEntry[];
  total: number;
  silent: number;
}
