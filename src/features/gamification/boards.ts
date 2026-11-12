
import {
  consistencyBoard,
  mostImprovedBoard,
  recentPrBoard,
  relativeStrengthBoard,
  streakBoard,
  totalWorkoutsBoard,
  weekStartStr,
  type BoardEntry,
  type Competitor,
} from "../../domain/records";
import { localParts } from "../../domain/localTime";
import {
  competitorBodyweights,
  competitorStrength,
  competitorWorkoutDates,
  listCompetitors,
} from "../../adapters/d1/v2Gamification";
import { t } from "../../locales/i18n";
import type { Lang, UserProfile } from "../../types";

export function isoDateMinus(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// alias "" = anonymous, non-empty = custom, undefined = fall back to profile name.
function competitorName(alias: string | undefined, profileName?: string): string {
  if (alias === "") return ""; // anonymous → localized at render
  return alias || profileName || "";
}

export interface BoardsResult {
  competitors: Map<number, Competitor>;
  consistency: BoardEntry[];
  improved: BoardEntry[];
  relative: BoardEntry[];
  total: BoardEntry[];
  streak: BoardEntry[];
  recentPrs: BoardEntry[];
}

// Build all leaderboards in a handful of aggregate queries (no per-user fan-out).
// `tz` anchors "today"/week-start to the VIEWER's timezone — with a fixed UTC boundary,
// users east/west of UTC got a shifted consistency week (workouts logged late Sunday
// local time fell into the wrong week).
export async function computeBoards(db: D1Database, tz?: string): Promise<BoardsResult> {
  const today = localParts(tz ?? "UTC").date;
  const weekStart = weekStartStr(today);
  const cutoff7 = isoDateMinus(today, 7);
  const cutoff30 = isoDateMinus(today, 30);
  const [rows, bw, dates, strength] = await Promise.all([
    listCompetitors(db),
    competitorBodyweights(db),
    competitorWorkoutDates(db),
    competitorStrength(db),
  ]);
  const competitors = new Map<number, Competitor>();
  for (const r of rows) {
    const profile = JSON.parse(r.profile || "{}") as UserProfile;
    competitors.set(r.userId, {
      userId: r.userId,
      name: competitorName(r.alias ?? undefined, profile.name),
      sex: profile.sex,
      weightKg: bw.get(r.userId) ?? profile.weightKg,
    });
  }
  return {
    competitors,
    consistency: consistencyBoard(competitors, dates, weekStart),
    improved: mostImprovedBoard(competitors, strength, cutoff7),
    relative: relativeStrengthBoard(competitors, strength),
    total: totalWorkoutsBoard(competitors, dates),
    streak: streakBoard(competitors, dates, today),
    recentPrs: recentPrBoard(competitors, strength, cutoff30),
  };
}

export function badgeLabel(lang: Lang, code: string): string {
  return t(lang, `badge_${code}` as Parameters<typeof t>[1]);
}
