// SessionStart: the three facts that were wrong most often in this repo's sessions, up front.
// No network: ahead/behind uses the origin/main this checkout last fetched.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const git = (cwd, ...args) => {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
};

export function sessionNotes({ branch, ahead, behind, dirty }) {
  const lines = [`trix: branch ${branch || "(detached)"}, ${ahead} ahead / ${behind} behind origin/main (as last fetched)${dirty ? ", uncommitted changes" : ""}.`];
  if (branch === "main") lines.push("You are on main: work on a branch, never push to main.");
  else if (behind > 0 && ahead === 0) lines.push("Nothing here is ahead of main. If this branch's PR was merged, restart from origin/main before new work.");
  else if (behind > 0) lines.push(`This branch is ${behind} commit(s) behind main: merge origin/main before pushing a PR.`);
  lines.push("Rules: answer the owner in Russian; one PR for everything unless told otherwise; checks before every push (CLAUDE.md); skills: decide-or-ask, model-routing, subagents-and-context.");
  return lines.join("\n");
}

function main() {
  const cwd = process.cwd();
  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  const [behind = 0, ahead = 0] = git(cwd, "rev-list", "--left-right", "--count", "origin/main...HEAD").split(/\s+/).map(Number);
  process.stdout.write(`${sessionNotes({ branch, ahead, behind, dirty: git(cwd, "status", "--porcelain") !== "" })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
