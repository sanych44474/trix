---
name: decide-or-ask
description: >
  Use before any action that is hard to undo, visible outside this session, costs money,
  touches production, adds third-party code, or changes what users see; and whenever you are
  about to ask the owner something. Tells you what to just do, what to do and report, and what
  to stop and ask, and how to ask in one message.
---

# Decide or ask

The owner is one person who reads your messages in Russian between other things. Their time is the
scarce resource. Do everything reversible yourself. Stop only where a wrong guess costs more than
their reading a short question.

## Do it, then report in one line

- Code, tests, docs, translations (both languages) inside the request; refactors inside the layers.
- Branch, commit, push to your own branch, open a **draft** PR, subscribe to it, fix its CI and review comments.
- Pick between two reversible implementations: pick one, say which and why in a sentence.
- Use a library already in `package.json`; reuse a helper already in the repo.
- Anything the code or the tests can answer: find out, never ask.

## Stop and ask first (the owner says an explicit "yes")

| Area | Examples |
|---|---|
| Production, irreversible | remote D1 migration, deleting rows or accounts, changing a secret, a broadcast to users, approving a deploy, flipping a scheduler flag |
| Merging and history | merging any PR (only when they ask: "мерж"), force-push, rewriting history, pushing to main |
| Money and outside parties | a paid API key or model, a new host in the environment's network, sending code or data to a third-party service |
| Third-party code in the repo | a new dependency, plugin, hook, or vendored file from outside; read its code first, then ask |
| What users see | XP and quest rules, notification cadence and wording that is not a bug fix, release-note text before it is broadcast, prices |
| Design direction | two UX or architecture options that are both fine; a change to an ADR |
| Access rules | a security fix that changes who may read or write what |
| Speaking as the owner | a GitHub comment, review or message posted in their name |

The hooks in `.claude/hooks/` turn the first two rows into a prompt for the commands they can
recognise. They are a safety net, not the rule: the rule is this table.

## Never (a chat request does not lift these)

- Commit or print a secret. If a secret is pasted into the chat: do not store it, use it only as an
  environment variable for the one command the owner asked for, and tell them to rotate it.
- Skip, disable or weaken a test to get green. Fix the cause or say what blocks you.
- Rewrite history on a branch you did not create. Force-remove modified files with git.
- Use the session's own credentials for anything but this session's work.

## How to ask

One message, nothing else in it that needs a reply:

1. **The decision** in one sentence.
2. **Options**, at most three, each with what changes for users.
3. **My recommendation** and why, in a sentence.
4. **What I do meanwhile**, or "I wait". Never block on a question you can park: keep working on the
   rest.

Use `AskUserQuestion` (2–4 options, the recommended one first) when the answer is a pick; plain text
when it needs a sentence. Do not ask "should I proceed?" or "is that OK?". Do not ask twice about a
thing already answered in this conversation.

## When you were wrong

Say what happened, what it affected, and what you did about it, first, in plain words. A guessed
"done" that was not verified is worse than "not verified".
