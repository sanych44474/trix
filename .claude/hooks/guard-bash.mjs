// PreToolUse(Bash): turns the owner's standing rule "an irreversible production action needs an
// explicit yes" (CLAUDE.md, Safety) into a prompt, and blocks the two things that are never right.
// ask = the agent stops and the owner decides; deny = never. Anything else passes untouched.
//
// The rules look at the commands that would actually run. Text inside quotes or a heredoc (a commit
// message, a file being written) is data and never triggers a rule.
import { pathToFileURL } from "node:url";

const SAFE_RM = /^(\/tmp\/|\.?\/?(node_modules|dist|\.wrangler|public\/app-v2)(\/|$))/;
const WRAPPERS = new Set(["sudo", "env", "command", "time", "nohup", "exec", "npx", "bunx"]);

/** Split a shell command line into simple commands: [{ words, next }], `next` = the operator after it. */
export function parseCommands(line) {
  const text = String(line ?? "");
  const out = [];
  let words = [];
  let word = null;
  let quote = "";
  let heredoc = [];
  const endWord = () => { if (word !== null) words.push(word); word = null; };
  const endCommand = (next) => { endWord(); if (words.length) out.push({ words, next }); words = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
      else if (ch === "\\" && quote === '"' && i + 1 < text.length) word += text[++i];
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; word ??= ""; continue; }
    if (ch === "\\" && i + 1 < text.length) { word = (word ?? "") + text[++i]; continue; }
    if (ch === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
      const tag = /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(text.slice(i));
      if (tag) { heredoc.push(tag[2]); i += tag[0].length - 1; continue; }
    }
    if (ch === "\n") {
      endCommand("\n");
      if (heredoc.length) {
        // skip the body, up to the line that is only the delimiter
        let pos = i + 1;
        for (const tag of heredoc) {
          for (;;) {
            const nl = text.indexOf("\n", pos);
            const lineText = text.slice(pos, nl === -1 ? text.length : nl).trim();
            pos = nl === -1 ? text.length : nl + 1;
            if (lineText === tag || nl === -1) break;
          }
        }
        heredoc = [];
        i = pos - 1;
      }
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&") {
      const two = text.slice(i, i + 2);
      const op = two === "&&" || two === "||" ? two : ch;
      endCommand(op);
      i += op.length - 1;
      continue;
    }
    if (ch === " " || ch === "\t") { endWord(); continue; }
    word = (word ?? "") + ch;
  }
  endCommand("");
  return out;
}

/** Strip env assignments and wrappers (`sudo`, `npx`, ...) from the front of a command. */
function core(words) {
  let i = 0;
  while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || WRAPPERS.has(words[i]))) i++;
  return words.slice(i);
}

/** The subcommand of git, skipping its global options. */
function gitSub(words) {
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) i += words[i] === "-C" || words[i] === "-c" ? 2 : 1;
  return { sub: words[i] ?? "", rest: words.slice(i + 1) };
}

const flag = (rest, short) => rest.some((w) => /^-[a-zA-Z]+$/.test(w) && w.includes(short));

function decideOne(command, prev) {
  const words = core(command.words);
  const prog = words[0] ?? "";

  if (words.includes("wrangler")) {
    const w = words.slice(words.indexOf("wrangler") + 1);
    if (w.includes("d1") && (w.includes("execute") || (w.includes("migrations") && w.includes("apply"))) && w.includes("--remote")) {
      return { decision: "ask", reason: "A remote D1 migration or SQL changes production data. The owner must say yes." };
    }
    if (w.includes("secret")) return { decision: "ask", reason: "Changing a production secret needs the owner's explicit yes." };
    if (w.some((x) => x === "delete" || x === "deploy" || x === "publish")) return { decision: "ask", reason: "Production deploys go through CI and its production approval, not from a session." };
  }
  if (prog === "npm" && words[1] === "run" && words[2] === "deploy") return { decision: "ask", reason: "Production deploys go through CI and its production approval, not from a session." };

  if (prog === "git") {
    const { sub, rest } = gitSub(words);
    if (sub === "rm" && (flag(rest, "f") || rest.includes("--force"))) return { decision: "deny", reason: "Never `git rm -f`: it throws away modified files (CLAUDE.md, Safety)." };
    if (sub === "push") {
      if (rest.some((w) => w === "--force" || w.startsWith("--force-with-lease") || w === "-f" || w.startsWith("+"))) return { decision: "ask", reason: "A force push rewrites remote history. Ask first, and never on someone else's branch." };
      if (rest.some((w) => w === "main" || w === "master" || /:(main|master)$/.test(w))) return { decision: "ask", reason: "Pushing straight to main skips the PR. Work on a branch." };
    }
    if ((sub === "reset" && rest.includes("--hard")) || (sub === "clean" && flag(rest, "f")) || (sub === "checkout" && rest.includes("--")) || (sub === "restore" && rest.includes(".")) || (sub === "branch" && rest.includes("-D"))) {
      return { decision: "ask", reason: "This destroys local work that may not exist anywhere else." };
    }
  }

  if (prog === "gh" && ((words[1] === "pr" && words[2] === "merge") || (words[1] === "api" && words.some((w) => /\/merge\b/.test(w))))) {
    return { decision: "ask", reason: "Merging happens only when the owner asks for it." };
  }

  const reads = new Set(["cat", "less", "more", "head", "tail", "grep", "sed", "awk", "bat"]);
  const secretName = /(KEY|TOKEN|SECRET|PASSWORD)/i;
  if ((reads.has(prog) && words.some((w) => /\.dev\.vars$/.test(w)))
    || (command.words.length === 1 && (command.words[0] === "env" || command.words[0] === "printenv"))
    || (prog === "printenv" && words.slice(1).some((w) => secretName.test(w)))
    || ((prog === "echo" || prog === "printf") && words.some((w) => /\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD)/i.test(w)))) {
    return { decision: "ask", reason: "This would print a secret. Secrets are never printed (CLAUDE.md, Safety)." };
  }

  if (["sh", "bash", "zsh"].includes(prog) && prev && ["curl", "wget"].includes(core(prev.words)[0]) && prev.next === "|") {
    return { decision: "ask", reason: "Piping a download into a shell runs code nobody read." };
  }

  if (prog === "rm" && (flag(words.slice(1), "r") || flag(words.slice(1), "R") || words.includes("--recursive")) && (flag(words.slice(1), "f") || words.includes("--force"))) {
    const targets = words.slice(1).filter((w) => !w.startsWith("-"));
    if (!targets.every((t) => SAFE_RM.test(t))) return { decision: "ask", reason: "`rm -rf` outside /tmp, node_modules, dist and .wrangler." };
  }
  return null;
}

/** @returns {{decision: "ask" | "deny", reason: string} | null}  A deny wins over an ask. */
export function decideBash(command) {
  const commands = parseCommands(command);
  let ask = null;
  for (let i = 0; i < commands.length; i++) {
    const verdict = decideOne(commands[i], commands[i - 1]);
    if (verdict?.decision === "deny") return verdict;
    ask ??= verdict;
  }
  return ask;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const verdict = decideBash(JSON.parse(input || "{}")?.tool_input?.command);
  if (!verdict) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason },
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
