// The Mini App runs in Telegram's in-app browser, which on iPhones before iOS 16.4 can't parse a regex
// lookbehind. One in the entry bundle is a SyntaxError for the whole file: a blank screen, phones only
// (2026-10-21, src/domain/exerciseMuscles.ts). Vite can't transpile regex syntax, so the source must not use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const LOOKBEHIND = /\(\?<[=!]/;

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Mini App files plus every server module they import (relative imports, followed transitively). */
function bundledSources(): string[] {
  const seen = new Set<string>();
  const queue = sourcesUnder(join(ROOT, "apps/mini-app/src"));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
      const base = resolve(dirname(file), m[1]);
      const hit = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => {
        try { return statSync(p).isFile(); } catch { return false; }
      });
      if (hit) queue.push(hit);
    }
  }
  return [...seen];
}

test("nothing the Mini App bundles uses a regex lookbehind (iOS < 16.4 can't parse it)", () => {
  const files = bundledSources();
  assert.ok(files.some((f) => f.endsWith(join("src", "domain", "exerciseMuscles.ts"))), "follows imports into src/domain");
  const offenders = files.filter((f) => LOOKBEHIND.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
  assert.deepEqual(offenders, []);
});
