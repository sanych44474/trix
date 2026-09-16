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
  macros: { targets?: { calories: number; protein: number; fats: number; carbs: number }; days: { date: string; kcal: number; p: number; f: number; c: number; training: boolean }[] };
  gamification?: { level: number; xp: number; intoLevel: number; needed: number; streak?: number };
  todayStats?: { waterMl: number; waterGoal: number; steps: number; stepsGoal: number };
  logForm?: { exercises: string[] };
  trainer?: { clients: { id: number; name: string; workoutPct: number; nutritionPct: number; atRisk: boolean; flagged: boolean }[] };
  owner?: { funnel: { total: number; onboarded: number; active7: number; active30: number }; ai: { provider: string; calls: number; fallbacks: number; avgLatencyMs: number; tokens: number }[] };
}

export interface WorkoutToday {
  date: string;
  weekday: number;
  title?: string;
  exercises: Array<{ index: number; name: string; metric: "reps" | "time" | "distance"; sets: number; setsDone?: Array<{ weight: number; reps: number; seconds?: number; meters?: number }>; rpe?: number; completed?: boolean }>;
  alreadyLogged?: boolean;
}

export interface Plan {
  owner: { id: number; name: string };
  version: string;
  days: Array<{ weekday: number; name: string; muscleGroup: string; exercises: Array<{ index: number; name: string; sets: string; startWeight: string; metric: string; technique?: string }> }>;
}

export interface Nutrition {
  date: string;
  meals: Array<{ index: number; desc: string; kcal: number; protein: number; fats: number; carbs: number; grams?: number | null }>;
  totals: { kcal: number; protein: number; fats: number; carbs: number };
  targets?: { calories: number; protein: number; fats: number; carbs: number };
  mealPlan?: { days: unknown[] } | null;
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
