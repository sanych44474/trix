// PreToolUse(Write|Edit|MultiEdit): two rules from CLAUDE.md that are cheap to enforce here.
//  - Migrations are forward-only: a migration already on origin/main is never edited.
//  - A secret is never written into a file that can be committed.
import { execFileSync } from "node:child_process";
import { isAbsolute, relative } from "node:path";
import { pathToFileURL } from "node:url";

const SECRETS = [
  [/sk-or-v1-[A-Za-z0-9]{20,}/, "an OpenRouter key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google API key"],
  [/\b\d{6,}:[A-Za-z0-9_-]{35}\b/, "a Telegram bot token"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "a GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
];

/** The text a tool call would write. */
export function writtenText(toolInput) {
  const t = toolInput ?? {};
  return [t.content, t.new_string, ...(Array.isArray(t.edits) ? t.edits.map((e) => e?.new_string) : [])].filter((s) => typeof s === "string").join("\n");
}

/** @returns {{decision: "deny", reason: string} | null} */
export function decideEdit({ path, text, onMain }) {
  const p = String(path ?? "");
  if (/(^|\/)migrations\/\d+[^/]*\.sql$/.test(p) && onMain) {
    return { decision: "deny", reason: "Migrations are forward-only: this one is already on main. Add a new migration with the next number." };
  }
  if (!/(^|\/)\.dev\.vars$/.test(p)) {
    for (const [re, what] of SECRETS) {
      if (re.test(text)) return { decision: "deny", reason: `This text contains ${what}. Secrets never go into files that can be committed. If the owner pasted it, do not store it and advise rotating it.` };
    }
  }
  return null;
}

function existsOnMain(cwd, file) {
  const rel = isAbsolute(file) ? relative(cwd, file) : file;
  for (const ref of ["origin/main", "HEAD"]) {
    try {
      execFileSync("git", ["cat-file", "-e", `${ref}:${rel}`], { cwd, stdio: "ignore", timeout: 3000 });
      return true;
    } catch { /* not there, try the next ref */ }
  }
  return false;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const data = JSON.parse(input || "{}");
  const path = data?.tool_input?.file_path ?? "";
  const cwd = data?.cwd || process.cwd();
  const onMain = /(^|\/)migrations\/\d+[^/]*\.sql$/.test(path) && existsOnMain(cwd, path);
  const verdict = decideEdit({ path, text: writtenText(data?.tool_input), onMain });
  if (!verdict) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason },
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
