---
name: subagents-and-context
description: >
  Use when a task needs reading much code or logs, when you are about to launch a subagent, when the
  conversation is getting long, before and after context compaction, and when handing work to another
  session.
---

# Subagents and the context window

A bigger window is not free. Every turn re-sends the history (cached reads are about a tenth of the
price, still not zero), a long context is slower, and early instructions get lost in it. Keep the main
conversation for **decisions, the owner, and the final integration**. Put bulk reading elsewhere.

## Launch a subagent when

- The answer is a conclusion, not the material: a repo-wide search, a whole-repo audit, 300+ lines of
  CI log, reading more than about five files to answer one question.
- The work is independent and can run beside other work (three directories to audit).
- You want an independent opinion: a review by a different model than the author.

## Do not launch one when

- You know the file and the change: just edit it.
- It needs the owner's decision or your conversation history.
- It would take more words to brief than to do.

Every subagent starts cold: it costs a full brief. A *fork* inherits your context (cheap to brief,
expensive in tokens); a *fresh* agent inherits nothing (cheap to run, needs a complete brief).

## The brief (five lines)

1. **Goal:** the question to answer, not the area to browse.
2. **Where:** files or folders; what is out of scope.
3. **Constraints:** read-only unless it must edit; the repo rules that matter (CLAUDE.md applies to it).
4. **Output:** the format and a length cap ("at most 15 findings, each `file:line` + one sentence + the
   concrete failing case").
5. **Evidence rule:** no finding without a quoted line or a command output.

## After it returns

A report is a claim, not a fact. Open the two or three findings that matter and confirm them against
the code before you act or repeat them to the owner. Say in your answer what you verified and what you
took from the report.

## Parallel work

- Parallel only what is independent. Three or four at once is plenty.
- Writers get disjoint files or their own worktree; two agents never edit the same file.
- Do not poll or `sleep`: background work wakes you when it finishes.

## Keeping the main context small

- Never `Read` whole: `migrations/0017_plan_bank.sql` (9 MB), `packages/contracts/openapi.yaml`,
  `package-lock.json`, generated `public/app-v2`, `BodyMapFigures.kt`. `grep` them.
- Test runs: `npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"`. It takes about six minutes locally:
  run it in the background, not in the foreground.
- CI logs: download with `gh api repos/<owner>/<repo>/actions/jobs/<id>/logs > file`, then `grep -n "not ok"`.
  The log tool truncates the start of a long log, where the failure is.
- Use `offset` and `limit` on large reads. Write scratch output to the scratchpad, not into the repo.

## Before compaction, and after

Context is summarised when it fills up; what is not written down can be lost. When the conversation is
long (many PRs, many decisions), keep one **standing list** in your own words, and refresh it:

- the branch and PR numbers in play, and each one's state;
- what is waiting for the owner (approvals, decisions), and what is blocked on what;
- standing orders from the owner (language, "one PR", "merge only on my word");
- anything dangerous you were told not to touch.

After a compaction or a restart, **re-verify before you act**: `git status`, the PR's head and checks.
The summary is a memory, not the state.

## Handing work to another session

Write the handoff as if the reader has nothing: goal, current state (branch, last commit, what passes
and what does not), the next three steps, what is deliberately left alone, and what needs the owner.
