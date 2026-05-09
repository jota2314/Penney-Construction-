---
name: chat-improve
description: Use when the user wants to make the AI chat (the main /api/chat assistant or /api/email-chat) smarter. Walks through a one-change-at-a-time workflow with measurable before/after evals so every improvement is verified, not guessed.
---

# Chat Improvement Workflow

The user wants the AI chat (`src/app/api/chat/route.ts` and `src/app/api/email-chat/route.ts`) to keep getting smarter. The rule is: **every change must be tested with concrete questions before and after**. No shipping unverified vibes.

## When to use this skill

Trigger on any of:
- "Make the chat smarter"
- "Improve the AI assistant"
- "Better prompts / tools / memory / caching"
- "Why is the chat doing X?"

## The workflow

For every improvement, follow these six steps in order. Don't skip the eval steps.

### 1. Pick exactly one change

One thing at a time. Examples (rough ROI order):
1. **Prompt caching** — cuts latency ~50%, cost ~80%
2. **Tool error self-correction** — when a tool fails, give the AI structured retry hints
3. **Extended thinking on hard turns** — `thinking` mode for proposals, off for chitchat
4. **Smarter memory** — per-entity memory with relevance retrieval
5. **Retrieval over DB dump** — embed subs/customers/projects, inject only the relevant rows
6. **Tool descriptions audit** — clearer schemas, better usage hints
7. **Model routing** — Opus for hard turns, Sonnet for routine

If the user picks something not on this list, that's fine — just confirm scope before starting.

### 2. Define test questions

Before writing code, write 5-10 prompts that exercise the area you're changing. Save them to `scripts/chat-eval/prompts.json` (append, don't replace — old prompts become regression tests).

A good prompt:
- Has a definite right/wrong answer (not "what do you think about X")
- Tests one capability (DB lookup, drafting, memory recall, tool use)
- Reflects how Jorge actually talks (short, direct, sometimes ambiguous)

Example seeds:
- "How many active projects do we have?" (DB lookup)
- "Who are our HVAC subs?" (filtered list)
- "Draft an email to Brad asking for an update on the Cleary kitchen" (tool use + lookup)
- "Remember Howie prefers texts not emails" (memory write)
- "Compare plumbing quotes on Cleary" (multi-step reasoning)

### 3. Run baseline eval

```bash
npm run chat-eval -- --label baseline
```

Requirements (one-time setup): **either** auth mode works (see `scripts/chat-eval/README.md` for full setup):

- **Preferred:** `CHAT_EVAL_SECRET` set in `.env.local` matching the Vercel env var; runs against `/api/eval/chat` on a preview URL. Doesn't expire.
- **Alt:** `CHAT_EVAL_COOKIE` from a signed-in browser session; runs against `/api/chat`. Cookies expire.

The script writes `scripts/chat-eval/results/baseline.md` with each prompt's response, token counts, cache hits, and latency. Commit this so the diff is visible later.

**For the agent (you):** if `CHAT_EVAL_SECRET` is set in this repo's local env, you can run evals from the chat directly. Otherwise, ask the user to run them and paste the result file contents.

### 4. Implement the change

Keep the diff narrow. If a change wants to grow into a refactor, stop and reset scope.

### 5. Run the new eval

```bash
npm run chat-eval -- --label after-<change-name>
```

Then compare:

```bash
npm run chat-eval -- --compare baseline after-<change-name>
```

The compare prints a side-by-side: latency delta, token delta, response diff. Look for regressions, not just wins.

### 6. Show the user, then commit

Tell the user:
- What you changed (1-2 sentences)
- The 3 questions where the chat got better and how (be specific — "now uses tool X instead of guessing", "answer is 60% shorter and correct", etc.)
- Any regressions you spotted

If they approve, commit both code and eval results so the improvement trail is preserved.

## What this skill does NOT do

- Doesn't decide priority — always confirm with the user which improvement to tackle next.
- Doesn't replace manual app testing. After the eval passes, the user should still try a few prompts in the deployed app.
- Doesn't run automated CI evals (yet). The script is a developer tool, not a gate.

## Files this skill touches

- `scripts/chat-eval/run.mjs` — the runner (don't edit unless improving the harness itself)
- `scripts/chat-eval/prompts.json` — the test prompts (append over time)
- `scripts/chat-eval/results/*.md` — committed eval outputs (one per labeled run)
- `src/app/api/chat/route.ts` — main chat
- `src/app/api/email-chat/route.ts` — email triage chat
- `src/lib/ai/prompts/*` — system prompt builders
- `src/lib/ai/shared-tools.ts` / `shared-tool-handlers.ts` — tools

## House rules

- One change per commit. Each commit should pair a code change with its `results/after-*.md` file.
- Never delete a prompt from `prompts.json` — only add. Old prompts catch regressions.
- If the eval script breaks, fix the script before continuing the improvement.
