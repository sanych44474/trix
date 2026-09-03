// Leaderboards + badges: board assembly from aggregate queries and badge rendering. Extracted
// from bot.ts — consumed by the bot (/records), the scheduler (weekly nudges + hourly cache)
// and the Mini App (/api/boards). No imports from ../bot, so this module is cycle-free.
import { InlineKeyboard } from "grammy";
import {
  BADGES,
  consistencyBoard,
  mostImprovedBoard,
  relativeStrengthBoard,
  totalWorkoutsBoard,
  weekStartStr,
  type BoardEntry,
  type Competitor,
} from "../domain/records";
import { localParts } from "../domain/progression";
import {
  competitorBodyweights,
  competitorStrength,
  competitorWorkoutDates,
  listCompetitors,
} from "../db/repos";
import { t } from "../locales/i18n";
import type { Lang, UserProfile } from "../types";

export function isoDateMinus(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// alias "" = anonymous, non-empty = custom, undefined = fall back to profile name.
export function competitorName(alias: string | undefined, profileName?: string): string {
  if (alias === "") return ""; // anonymous → localized at render
  return alias || profileName || "";
}

export interface BoardsResult {
  competitors: Map<number, Competitor>;
  consistency: BoardEntry[];
  improved: BoardEntry[];
  relative: BoardEntry[];
  total: BoardEntry[];
}

// Build all leaderboards in a handful of aggregate queries (no per-user fan-out).
// `tz` anchors "today"/week-start to the VIEWER's timezone — with a fixed UTC boundary,
// users east/west of UTC got a shifted consistency week (workouts logged late Sunday
// local time fell into the wrong week).
export async function computeBoards(db: D1Database, tz?: string): Promise<BoardsResult> {
  const today = localParts(tz ?? "UTC").date;
  const weekStart = weekStartStr(today);
  const cutoff7 = isoDateMinus(today, 7);
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
  };
}

export function recordsTabs(lang: Lang, optedIn: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(lang, "tab_weekly"), "rec:weekly")
    .text(t(lang, "tab_prs"), "rec:prs")
    .row()
    .text(t(lang, "tab_hall"), "rec:hall")
    .text(t(lang, "tab_badges"), "rec:badges")
    .row();
  if (!optedIn) kb.text(t(lang, "records_join"), "set:compete").row();
  kb.text(t(lang, "menu_open"), "menu:open");
  return kb;
}

export function badgeLabel(lang: Lang, code: string): string {
  return t(lang, `badge_${code}` as Parameters<typeof t>[1]);
}

export function renderBadges(lang: Lang, earned: string[]): string {
  const have = new Set(earned);
  const lines = BADGES.map((c) => `${have.has(c) ? "✅" : "🔒"} ${badgeLabel(lang, c)}`);
  return `${t(lang, "badges_header", { n: earned.length, total: BADGES.length })}\n${lines.join("\n")}`;
}
