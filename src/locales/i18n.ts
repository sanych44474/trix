import type { Lang } from "../types";
import { en, type Dict } from "./en";
import { uk } from "./uk";

const dicts: Record<Lang, Dict> = { en, uk };

/**
 * Coerce a language code of unknown provenance into a supported one.
 *
 * The single place where a `lang` value enters the system from outside — a database row, a
 * client payload — so that no unsupported code can reach `t()`, where it would resolve to an
 * undefined dictionary and throw on every string. Anything unrecognised falls back to `uk`,
 * which is what discontinued locales were closest to.
 */
export function normalizeLang(v: unknown): Lang {
  return v === "en" ? "en" : "uk";
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// AI models sometimes emit LaTeX like "\times" for "×". In JSON, "\t" parses to a
// literal TAB, so "4 \times 8-12" arrives as "4 <TAB>imes 8-12". Normalize that
// artifact and strip leftover control chars. Applied on both write and render so
// plans stored before this fix display correctly too.
export function cleanAi(s: string | undefined): string {
  if (!s) return s ?? "";
  return s
    .replaceAll(/\times/g, " × ")
    .replaceAll(/[\x00-\x1F]/g, " ")
    .replaceAll(/ {2,}/g, " ")
    .trim();
}

// Convert our controlled template markers (*bold*, _italic_) to Telegram HTML.
// Templates are author-controlled with balanced, non-nested markers and no raw <>&.
export function mdToHtml(s: string): string {
  return s
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/_([^_\n]+)_/g, "<i>$1</i>");
}

export function t(
  lang: Lang,
  key: keyof Dict,
  vars?: Record<string, string | number>,
): string {
  let s = mdToHtml(dicts[lang][key] ?? en[key]);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, escapeHtml(String(v)));
    }
  }
  return s;
}

export const LANG_NAME: Record<Lang, string> = {
  en: "English",
  uk: "Українська",
};
