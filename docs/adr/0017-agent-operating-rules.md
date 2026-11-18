# ADR-0017: how agents work in this repository

Status: accepted, 2026-11-18

## Context

Most of the repository is changed in sessions with a Claude agent, with one owner who reads the
results in Russian between other things. The same few mistakes cost the most time:

- **Unclear who decides.** The agent asked about things the code could answer, or did something
  irreversible (a merge, a deploy, a force-push) on a guess. CLAUDE.md has the rules ("irreversible
  production actions need an explicit yes") but nothing made them hard to forget.
- **Wrong model, wrong place.** Long log reading and whole-repo searches filled the main conversation;
  hard design and security questions were answered by whatever model was running.
- **A full context.** Long sessions lost standing orders ("one PR", "merge only on my word") after a
  compaction, and acted on a summary instead of the state.
- **Silent file loss.** `.gitignore` ignored `.claude/`, so skills written for the repository never
  reached the PR and CI failed on a missing folder.

## Decision

1. **Three skills** in `.claude/skills/`, loaded on demand so CLAUDE.md stays short:
   `decide-or-ask` (what to do alone, what to ask, how to ask), `model-routing` (which Claude model and
   effort for which job), `subagents-and-context` (when to launch a subagent, how to brief it, how to
   keep the context small, what to write down before compaction).
2. **Three project subagents** in `.claude/agents/`, each with a pinned model alias and the fewest tools
   that do the job: `repo-scout` (Haiku, `Read`/`Grep`/`Glob` only), `ci-triage` (Sonnet), `risk-reviewer`
   (Opus, read-only). Aliases (`haiku`, `sonnet`, `opus`) follow the current model version.
3. **Four hooks** in `.claude/hooks/`, wired in `.claude/settings.json`:
   - `guard-bash` (PreToolUse, Bash): asks before a remote D1 migration, a secret change, a deploy, a
     force-push, a push to main, a merge, destructive git, printing a secret, `rm -rf` outside scratch
     folders, piping a download into a shell; denies `git rm -f`.
   - `guard-edit` (PreToolUse, Write/Edit): refuses to edit a migration already on main (forward-only)
     and to write a secret into a file (`.dev.vars` excepted).
   - `lint-after-edit` (PostToolUse): runs `biome lint --error-on-warnings` on the file just written, the
     same check CI runs, and returns the findings to the agent.
   - `session-start`: prints the branch, how far it is from `origin/main`, and the standing rules.
4. `.gitignore` keeps `.claude/*` private but now tracks `skills/`, `agents/`, `hooks/` and
   `settings.json`. Personal settings stay in the ignored `settings.local.json`.

## Why these choices

- **Hooks only for what is mechanical and rare to be wrong about.** A hook cannot judge whether a design
  is good, so decisions stay in the skills; the hooks cover the commands where a wrong guess cannot be
  undone.
- **The command parser ignores quotes and heredocs.** The first version matched on raw text and blocked
  its own commit message. The rules now look at the commands that would run (`parseCommands`).
- **No Stop hook.** A hook that blocks the end of a turn can loop; CI and `lint-after-edit` already
  catch what it would.
- **No network in any hook.** `session-start` reads the `origin/main` the checkout last fetched.
- **Model advice is a table with a date.** Prices and names move; the skill says where to re-check.

## Consequences

- Hooks run code in every session on this repository. They are plain Node scripts of about 100 lines
  each, tested in `test/agent-hooks.test.ts`, and a session asks the user to trust the folder before
  project hooks run. To switch one off, remove its entry from `.claude/settings.json`.
- A false positive (a harmless command that asks) costs one confirmation; add a case to the test and
  fix the rule. A false negative (a risky command that passes) is possible: the skill, not the hook,
  is the rule.
- `model-routing` must be re-read when a new model family appears.
