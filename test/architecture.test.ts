// Architecture fitness tests: the dependency rules of docs/adr/0010-layering.md and
// docs/adr/0014-layering-covers-every-folder.md, checked on every
// run. Existing violations are listed in KNOWN below as a ratchet: the list may only shrink -- a
// new violation fails, and so does a listed one that has been fixed (delete its line then).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const rel = (p: string) => relative(ROOT, p).replaceAll("\\", "/");
/** Top-level folder under src/ ("(root)" for src/*.ts). */
const layerOf = (file: string) => {
  const r = relative(SRC, file).replaceAll("\\", "/");
  return r.includes("/") ? r.split("/")[0] : "(root)";
};

/** Runtime (non-type-only) relative imports and re-exports of a file, resolved to src paths. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+"(\.[^"]+)"/gms)) {
    if (m[1]) continue; // `import type` is erased at build time
    out.push(rel(normalize(join(dirname(file), m[2]))));
  }
  return out.filter((t) => t.startsWith("src/")); // a relative path into node_modules is a package
}

// Root modules every layer may import, the pure ones included: shared types and the release notes.
const ROOT_SHARED = new Set(["src/types", "src/releaseNotes"]);
// The Worker entry and the cron entry: nothing below the interfaces imports them at runtime.
const ENTRY = new Set(["src/index", "src/scheduler"]);
const INFRASTRUCTURE = ["adapters", "ai"];
const APPLICATION = ["features", "notify", "knowledge", "schedulerJobs"];
const INTERFACES = ["bot", "webapp", "durable"];

/** The rules: which layer may not import which (docs/adr/0014-layering-covers-every-folder.md). */
function violates(from: string, to: string): boolean {
  const a = layerOf(join(ROOT, from));
  const b = layerOf(join(ROOT, `${to}.ts`));
  // Pure layers name what they MAY import, so a new folder or root file is closed to them by default.
  const only = (...layers: string[]) => !(b === "(root)" ? ROOT_SHARED.has(to) : layers.includes(b));
  if (a === "locales" || a === "contracts") return only(a);
  if (a === "domain") return only("domain", "locales"); // also bundled into the Mini App: no I/O
  if (a === "render") return only("render", "domain", "locales");
  if (a === "(root)") {
    if (from === "src/index.ts") return false; // the composition root wires everything
    if (from === "src/scheduler.ts") return ["bot", "webapp"].includes(b);
    return only("domain", "locales"); // types, log, releaseNotes, appVersion
  }
  if (ENTRY.has(to)) return a !== "durable"; // the user DO runs the cron's per-user pass
  if (INFRASTRUCTURE.includes(a)) return [...APPLICATION, ...INTERFACES].includes(b);
  if (APPLICATION.includes(a)) return INTERFACES.includes(b);
  if (a === "bot") return b === "webapp";
  // The Mini App API is an interface too: only the composition root (index.ts) wires it in.
  if (a === "webapp") return b === "bot";
  if (a === "durable") return ["bot", "webapp"].includes(b);
  return true; // a folder with no rule: add it to a layer above
}

// Every module lives in a layer folder. src/ itself holds the two entries and the shared modules.
const ROOT_ALLOWED = new Set(["src/index.ts", "src/scheduler.ts", "src/types.ts", "src/log.ts", "src/releaseNotes.ts", "src/appVersion.ts"]);

test("src/ root holds only the entries and the shared modules (new code goes in a layer folder)", () => {
  const rootFiles = sourceFiles().map(rel).filter((f) => layerOf(join(ROOT, f)) === "(root)");
  const stray = rootFiles.filter((f) => !ROOT_ALLOWED.has(f));
  assert.deepEqual(stray, [], "put these in a layer folder (docs/adr/0014-layering-covers-every-folder.md)");
});

// Each line is "<file> -> <module>"; remove lines as they get fixed. The 2026-10-13 baseline
// (ADR-0010) reached zero; these are the edges the wider rules of ADR-0014 found on 2026-11-10.
const KNOWN = new Set<string>([]);

test("layering: no new cross-layer imports (and fixed ones leave the baseline)", () => {
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    for (const target of runtimeImports(file)) {
      if (violates(rel(file), target)) found.add(`${rel(file)} -> ${target}`);
    }
  }
  const added = [...found].filter((v) => !KNOWN.has(v));
  const fixed = [...KNOWN].filter((v) => !found.has(v));
  assert.deepEqual(added, [], `new layering violations (see docs/adr/0014-layering-covers-every-folder.md):\n${added.join("\n")}`);
  assert.deepEqual(fixed, [], `these are fixed -- delete them from KNOWN in test/architecture.test.ts:\n${fixed.join("\n")}`);
});

// A scan of our own source text, not URL validation. Assembled from parts so code scanning does
// not mistake the literal for a host check.
const BOT_API_HOST = ["api", "telegram", "org"].join(".");

test("transport: only adapters/telegram/rawApi.ts builds Bot API URLs (it embeds the token)", () => {
  const offenders = sourceFiles()
    .filter((f) => rel(f) !== "src/adapters/telegram/rawApi.ts")
    .filter((f) => readFileSync(f, "utf8").includes(BOT_API_HOST))
    .map(rel);
  assert.deepEqual(offenders, []);
});

// Re-exports hide where a symbol lives. The two allowed: the Worker entry (must export the Durable
// Object classes) and the prompt namespace read as `P`.
const REEXPORT_ALLOWED = new Set(["src/index.ts", "src/ai/prompts.ts"]);

test("no re-export shims: import from the module that declares the symbol", () => {
  const offenders = sourceFiles()
    .filter((f) => !REEXPORT_ALLOWED.has(rel(f)))
    .filter((f) => /^export\s+(\*|(type\s+)?\{[^}]*\})\s+from\s+"/m.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("every grammY Bot is built with the bounded client timeout (grammY's own default is 500 s)", () => {
  const unbounded = sourceFiles()
    .filter((f) => /new Bot(<[^>]*>)?\((?![^)]*botClientOptions)/.test(readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(unbounded, []);
});
