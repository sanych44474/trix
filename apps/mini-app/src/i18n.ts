// Mini App i18n: plain string lookup + {var} interpolation. Deliberately simpler than the
// bot's src/locales/i18n.ts (no HTML/markdown post-processing) -- this app renders plain text.
export type Lang = "uk" | "en";
import type { en } from "./i18n/en";

export type Key = keyof typeof en;
type Dictionary = Record<Key, string>;

// Each language is its own chunk (i18n/en.ts, i18n/uk.ts): main.tsx loads the person's language
// before the first render, and setLang in App loads another before switching to it. t() stays
// synchronous; a key from a language that isn't loaded yet falls back to one that is.
const dictionaries: Partial<Record<Lang, Dictionary>> = {};
const loaders: Record<Lang, () => Promise<Dictionary>> = {
  en: () => import("./i18n/en").then((m) => m.en),
  uk: () => import("./i18n/uk").then((m) => m.uk),
};

export function hasLang(lang: Lang): boolean {
  return Boolean(dictionaries[lang]);
}

export async function loadLang(lang: Lang): Promise<void> {
  if (!dictionaries[lang]) dictionaries[lang] = await loaders[lang]();
}

export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const template = dictionaries[lang]?.[key] ?? dictionaries.uk?.[key] ?? dictionaries.en?.[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Best-guess language before the dashboard (which carries the authoritative `lang`) has
 * loaded, from Telegram's own client language hint. Same normalize-to-"uk" convention as the
 * backend's normalizeLang (src/locales/i18n.ts): only an exact "en" maps to English, everything
 * else (missing, "ru", "uk", anything else) defaults to Ukrainian -- most real users are
 * Ukrainian-speaking, so that's the safer unknown-language default, not "en". */
export function guessLang(): Lang {
  const code = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  return code === "en" ? "en" : "uk";
}
