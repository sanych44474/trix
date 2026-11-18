// PostToolUse(Write|Edit|MultiEdit): CI runs `biome lint --error-on-warnings`, so a warning is a red
// build. Lint the one file that was just written and hand the findings straight back to the agent
// (exit 2 puts stderr in front of it). Silent when the file is not linted code or biome is missing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const LINTED = /^(src\/.*\.ts|apps\/mini-app\/src\/.*\.tsx?|test\/.*\.ts|scripts\/.*\.(mjs|ts))$/;

export function shouldLint(file, cwd) {
  const rel = isAbsolute(file) ? relative(cwd, file) : file;
  return LINTED.test(rel.replaceAll("\\", "/")) ? rel : null;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const data = JSON.parse(input || "{}");
  const cwd = data?.cwd || process.cwd();
  const rel = shouldLint(data?.tool_input?.file_path ?? "", cwd);
  if (!rel || !existsSync(join(cwd, rel)) || !existsSync(join(cwd, "node_modules/.bin/biome"))) return;
  const run = spawnSync(join(cwd, "node_modules/.bin/biome"), ["lint", "--error-on-warnings", "--max-diagnostics=10", rel], { cwd, encoding: "utf8", timeout: 20_000 });
  if (run.status === 0 || run.status === null) return;
  process.stderr.write(`biome lint failed on ${rel} (CI treats warnings as errors):\n${(run.stdout + run.stderr).split("\n").slice(0, 40).join("\n")}\n`);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
