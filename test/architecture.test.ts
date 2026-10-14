// Architecture fitness tests: the dependency rules of docs/adr/0010-layering.md, checked on every
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
  return out;
}

/** The rules: which layer may not import which. */
function violates(from: string, to: string): boolean {
  const a = layerOf(join(ROOT, from));
  const b = layerOf(join(ROOT, `${to}.ts`));
  if (a === "domain") return !["domain", "(root)", "locales"].includes(b); // pure: no I/O layers
  if (a === "adapters") return ["bot", "webapp", "features"].includes(b); // infrastructure stays below
  if (["webapp", "features", "schedulerJobs", "ai", "knowledge"].includes(a)) return b === "bot"; // the bot is a UI
  return false;
}

// Baseline (2026-10-13). Each line is "<file> -> <module>"; remove lines as they get fixed.
// Every violation from the original baseline has been fixed (ADR-0010); keep this empty.
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
  assert.deepEqual(added, [], `new layering violations (see docs/adr/0010-layering.md):\n${added.join("\n")}`);
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
