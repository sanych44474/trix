---
name: model-routing
description: >
  Use when choosing a Claude model, effort level or subagent model for a task, when the owner asks
  what a model costs or which to use, and before launching expensive or long-running work.
---

# Which model for which job

Numbers below come from the Claude API reference cached on 2026-11-03. Prices change: before you
quote one to the owner, re-check with the `claude-api` skill (Models API). Every current model has a
1M-token context window except Haiku 4.5 (200K).

| Model | Alias | $/1M tokens in / out | Use it for |
|---|---|---|---|
| Haiku 5.5 | `haiku` | 0.10 / 0.50 | Mechanical, high-volume work whose result you can check at a glance: find where X is used, list files, pull failing test names out of a log, summarise a diff, classify, check that a string exists in both locales. No judgment calls. |
| Sonnet 5.5 | `sonnet` | 2 / 10 | The default workhorse: implementing a specified change, writing tests, refactors in known patterns, CI triage, docs, release notes, Android and Mini App UI work. |
| Opus 5.5 | `opus` | 4 / 20 | Where a mistake is expensive and hard to see: architecture and ADRs, security review, concurrency and data integrity (idempotency, races, migrations), debugging with an unknown cause, review of a risky diff. |
| Fable 5.2 | `fable` | 8 / 40 | The hardest long-horizon, cross-cutting work, or a second attempt after Opus failed. Twice Opus's price: an escalation, never a default. |

## Rules

1. **The cheapest model whose answer you can verify cheaply.** Reading and searching: Haiku. A result
   you cannot check (a design, a security verdict): do not save money there.
2. **Escalate a model after the second failed attempt, not the fifth.** The same model repeating the
   same approach is the expensive path.
3. **Never use a cheaper model for:** security findings, migrations, anything that deletes or rewrites
   user data, access rules.
4. **Review risky changes with a stronger model than the one that wrote them** (`risk-reviewer` is Opus).
5. **Effort:** start at `high` for coding and agent work, `medium` for routine edits, `low` for
   subagents doing a simple lookup. `xhigh` only where a measurement shows it helps; `max` only to find
   a model's ceiling. Opus 5.5 and Haiku 5.5 default to `medium`, so set it on purpose.
6. **Cost per finished task, not per request.** A cheap model that needs three retries is not cheaper.
7. **Do not switch models in the middle of a conversation to save tokens:** caches are per model, so a
   switch pays for the whole history again. Give a different model its own subagent instead.
8. A subagent's model is set in its file (`.claude/agents/*.md`) or in the `model` argument when
   you launch it. Use the aliases above so it follows the current version.

## Quick pick

- "Where is this called?" → `repo-scout` (Haiku).
- "Why did CI fail?" → `ci-triage` (Sonnet).
- "Is this diff safe to merge?" → `risk-reviewer` (Opus).
- "Design the fix for a race / a data bug" → Opus yourself or in a subagent.
- Not sure which → Sonnet, and say in the answer what you would raise it to and why.
