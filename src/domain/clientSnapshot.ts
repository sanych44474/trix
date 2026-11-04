// What a trainer needs to see next to a client's message: how this week is going against the
// plan, the last few workouts with their best sets, and the week's quests. Before this a routed
// question reached the trainer with one number ("N workouts in 14 days") and the "client finished
// a workout" ping named only how many exercises were logged, so every reply started with the
// trainer opening the client card to find out what actually happened.
//
// Pure: callers fetch the rows (features/trainer/clientSnapshot.ts) and render it per surface.
// The same snapshot feeds the AI reply draft (snapshotPromptLines), the trainer's Telegram
// notifications and the Workspace inbox in the Mini App and on Android.
import type { QuestProgress } from "./quests";
import { bestSetForMetric, formatSetEntry, metricOfSets } from "./setFormat";
import type { LoggedExercise, Weekday } from "../types";

/** How far back "recent workouts" reaches. Older sessions say little about how a client is doing now. */
export const SNAPSHOT_DAYS = 14;
/** Recent workouts kept, newest first. */
export const SNAPSHOT_RECENT = 3;
/** Best sets named per workout. */
const TOP_SETS = 2;

interface SnapshotLog {
  date: string;
  weekday: Weekday;
  exercises: LoggedExercise[];
  completed: boolean;
  durationSec?: number;
}

interface SnapshotDay {
  weekday: number;
  muscleGroup: string;
  exercises: unknown[];
}

export interface WorkoutBrief {
  date: string;
  weekday: Weekday;
  /** The plan day's label for that weekday, when the plan has one ("Груди/Трицепс"). */
  label: string | null;
  completed: boolean;
  /** Exercises with at least one logged set. */
  done: number;
  /** Exercises the plan day holds; null when that weekday is not a plan day. */
  planned: number | null;
  durationMin: number | null;
  /** Highest session RPE logged on any exercise, when one was. */
  rpe: number | null;
  /** Up to TOP_SETS "Exercise 80x8" lines, in logging order. */
  top: string[];
}

export interface QuestBrief {
  code: string;
  kind: QuestProgress["kind"];
  muscle?: QuestProgress["muscle"];
  current: number;
  target: number;
  done: boolean;
}

export interface ClientSnapshot {
  /** Completed workouts dated in the current Monday-to-Sunday week. */
  weekDone: number;
  /** Planned sessions this week (0 = no plan or no training days set). */
  weekPlanned: number;
  /** Whole days since the newest logged workout; null when none in the window. */
  daysSinceLast: number | null;
  recent: WorkoutBrief[];
  questsDone: number;
  quests: QuestBrief[];
}

export interface SnapshotInput {
  /** The client's local date, YYYY-MM-DD. */
  today: string;
  /** Monday of the client's current week, YYYY-MM-DD. */
  weekStart: string;
  /** Workout logs; any range, the window is applied here. */
  workouts: SnapshotLog[];
  split?: SnapshotDay[];
  plannedDays: number;
  quests: QuestProgress[];
}

const dayMs = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

function loggedExercises(log: SnapshotLog): LoggedExercise[] {
  return log.exercises.filter((e) => !e.skipped && e.setsDone.length > 0);
}

function brief(log: SnapshotLog, split: SnapshotDay[] | undefined): WorkoutBrief {
  const day = split?.find((d) => d.weekday === log.weekday);
  const logged = loggedExercises(log);
  const rpes = log.exercises.map((e) => e.rpe).filter((r): r is number => typeof r === "number" && r > 0 && r <= 10);
  const top: string[] = [];
  for (const ex of logged) {
    if (top.length >= TOP_SETS) break;
    const metric = metricOfSets(ex.setsDone);
    const best = bestSetForMetric(ex.setsDone, metric);
    if (!best) continue;
    // Bodyweight reps read as "BWx12", as records do (formatRecordBest), not "0x12".
    top.push(`${ex.name} ${metric === "reps" && !best.weight ? `BWx${best.reps}` : formatSetEntry({ ...best, rpe: undefined })}`);
  }
  return {
    date: log.date,
    weekday: log.weekday,
    label: day?.muscleGroup?.trim() || null,
    completed: log.completed,
    done: logged.length,
    planned: day ? day.exercises.length : null,
    durationMin: log.durationSec && log.durationSec > 0 ? Math.max(1, Math.round(log.durationSec / 60)) : null,
    rpe: rpes.length ? Math.max(...rpes) : null,
    top,
  };
}

export function buildClientSnapshot(input: SnapshotInput): ClientSnapshot {
  const windowStart = new Date(Date.parse(`${input.today}T00:00:00Z`) - (SNAPSHOT_DAYS - 1) * dayMs).toISOString().slice(0, 10);
  // A log with nothing in it (opened, nothing entered) is not a workout the trainer can talk about.
  const real = input.workouts
    .filter((w) => w.date >= windowStart && w.date <= input.today && loggedExercises(w).length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const weekDone = new Set(real.filter((w) => w.completed && w.date >= input.weekStart).map((w) => w.date)).size;
  const quests = input.quests.map((q) => ({
    code: q.code,
    kind: q.kind,
    ...(q.muscle ? { muscle: q.muscle } : {}),
    current: Math.min(q.current, q.target),
    target: q.target,
    done: q.done,
  }));
  return {
    weekDone,
    weekPlanned: Math.max(0, input.plannedDays),
    daysSinceLast: real.length ? daysBetween(real[0].date, input.today) : null,
    recent: real.slice(0, SNAPSHOT_RECENT).map((w) => brief(w, input.split)),
    questsDone: quests.filter((q) => q.done).length,
    quests,
  };
}

/** The snapshot as plain English lines for an AI prompt (the reply draft a trainer can send). */
export function snapshotPromptLines(s: ClientSnapshot): string {
  const lines = [
    `This week: ${s.weekDone} of ${s.weekPlanned || "?"} planned workouts done; weekly quests ${s.questsDone}/${s.quests.length} done.`,
  ];
  if (!s.recent.length) lines.push(`No workouts logged in the last ${SNAPSHOT_DAYS} days.`);
  for (const w of s.recent) {
    const parts = [
      `${w.date}${w.label ? ` (${w.label})` : ""}: ${w.completed ? "completed" : "unfinished"}`,
      `${w.done}${w.planned !== null ? `/${w.planned}` : ""} exercises`,
      ...(w.durationMin ? [`${w.durationMin} min`] : []),
      ...(w.rpe ? [`RPE ${w.rpe}`] : []),
      ...(w.top.length ? [`best sets: ${w.top.join(", ")}`] : []),
    ];
    lines.push(`- ${parts.join(", ")}`);
  }
  if (s.daysSinceLast !== null && s.daysSinceLast >= 4) lines.push(`Last workout was ${s.daysSinceLast} days ago.`);
  return lines.join("\n");
}
