// Build the Mini App static shell: assemble src/webapp/client/* (plain .css/.html/.js files —
// no inertness constraints, write normal JS with template literals if you like) into
// public/app.html, which wrangler [assets] serves at GET /app. Run before every deploy and
// before `wrangler dev` (see package.json). Uses tsx so the locale JSON imports TS directly.
//
// Assembly: shell.html carries five markers —
//   /*__VIEW_CSS__*/  <!--__VIEW_HTML__-->  /*__VIEW_JS__*/  "__WA_I18N__"  "__WA_BOT__"
// replaced with the concatenated per-view fragments (VIEWS order matters: trainer.js defines
// `var WA` and ccFetch used by the others), the locale JSON and the bot username. Replacements
// use functions so `$&`-style sequences inside fragment content can never be misread as
// replace patterns.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";
import { WA_I18N_JSON } from "../src/webapp/webappStrings.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = join(root, "src", "webapp", "client");
const read = (f) => readFileSync(join(clientDir, f), "utf8");

// Bot username for the t.me links the app builds client-side. Comes from the environment in CI
// (deploy workflow passes vars.BOT_USERNAME) and from .dev.vars locally, so no deployment's
// identity is baked into the source tree.
function botUsername() {
  if (process.env.BOT_USERNAME) return process.env.BOT_USERNAME.replace(/^@/, "");
  try {
    const m = readFileSync(join(root, ".dev.vars"), "utf8").match(/^\s*BOT_USERNAME\s*=\s*"?([^"\r\n]*)"?/m);
    if (m?.[1]) return m[1].replace(/^@/, "");
  } catch {}
  return "";
}

const VIEWS = ["trainer", "logger", "plan", "profile", "nutrition", "longtail", "owner"];
const css = VIEWS.map((v) => read(v + ".css")).join("\n");
const html = VIEWS.map((v) => read(v + ".html")).join("\n");
const js = VIEWS.map((v) => read(v + ".js")).join("\n");

let page = read("shell.html");
for (const [marker, content] of [
  ["/*__VIEW_CSS__*/", css],
  ["<!--__VIEW_HTML__-->", html],
  ["/*__VIEW_JS__*/", js],
  ['"__WA_I18N__"', WA_I18N_JSON],
  ['"__WA_BOT__"', JSON.stringify(botUsername())],
]) {
  if (!page.includes(marker)) throw new Error(`marker ${marker} missing from shell.html`);
  page = page.replace(marker, () => content);
}

// ZXing barcode decoder ships as a SEPARATE static file (public/zxing.js), loaded lazily only
// when the user opens the scanner — so app.html stays small and most users never download the
// 336KB library. Served same-origin (CSP script-src 'self'), cached immutable.
if (!page.includes("<!--__ZXING__-->")) throw new Error("marker <!--__ZXING__--> missing from shell.html");
page = page.replace("<!--__ZXING__-->", () => "");

// Minify the app's own inline <script> (the FIRST/only <script> WITHOUT a marker attribute) and
// <style>. Identifier renaming is off so cross-fragment globals + error reports stay intact.
const rawLen = page.length;
try {
  page = page.replace(/<script>([\s\S]*?)<\/script>/, (_m, code) => {
    const out = transformSync(code, { loader: "js", minifyWhitespace: true, minifySyntax: true, target: "es2017" });
    return `<script>${out.code}</script>`;
  });
  page = page.replace(/<style>([\s\S]*?)<\/style>/, (_m, css2) => {
    const out = transformSync(css2, { loader: "css", minify: true });
    return `<style>${out.code}</style>`;
  });
} catch (e) {
  console.warn("minify skipped:", e.message);
}

const outDir = join(root, "public");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "app.html"), page);
// Emit the barcode lib as its own cacheable asset (lazy-loaded by the scanner).
const zxing = readFileSync(join(root, "node_modules", "@zxing", "library", "umd", "index.min.js"), "utf8");
writeFileSync(join(outDir, "zxing.js"), zxing);
console.log(`built public/app.html (${page.length} bytes, raw ${rawLen}) + zxing.js (${zxing.length} bytes)`);
