// Mini App strings for the trainer client-card view, picked from the main locale catalogs
// so they stay in one place (en.ts / uk.ts) and typecheck like every other key. Serialized
// once at module load and interpolated into the app HTML as `var WA_ALL = ...`.
import { en, type Dict } from "../locales/en";
import { uk } from "../locales/uk";

// Keys are collected AUTOMATICALLY by prefix from the en catalog — adding a `wa_*` key to
// en.ts/uk.ts is enough (no third manual list to forget; that class of bugs is gone). The
// extra prefixes cover onboarding-form options the app reuses from the bot's wizard.
const WA_PREFIXES = ["wa_", "ob_life_", "ob_sleep_"] as const;
const WA_KEYS = (Object.keys(en) as (keyof Dict)[]).filter((k) =>
  WA_PREFIXES.some((p) => k.startsWith(p)),
);

function pick(d: Dict): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of WA_KEYS) out[k] = String(d[k]);
  return out;
}

// <-escape "<" so the JSON can never terminate the surrounding <script> block.
export const WA_I18N_JSON = JSON.stringify({ en: pick(en), uk: pick(uk) }).replace(/</g, "\\u003c");
