# Chat eval

A small harness for verifying every change to `/api/chat` (the AI Assistant) actually makes things better.

## One-time setup

1. Sign into the app in your browser (e.g. `http://localhost:3000` after `npm run dev`).
2. Open DevTools → Application → Cookies → copy the **entire** `Cookie` header value (or copy each Supabase cookie and join with `; `).
3. Add to `.env.local`:

   ```bash
   CHAT_EVAL_URL="http://localhost:3000"
   CHAT_EVAL_COOKIE="sb-...=...; sb-...-auth-token=..."
   ```

Cookies expire — refresh them when runs start failing with HTTP 401.

## Run a labeled eval

```bash
npm run dev                                       # in another terminal
npm run chat-eval -- --label baseline             # before your change
# ... make your change ...
npm run chat-eval -- --label after-<change-name>
npm run chat-eval -- --compare baseline after-<change-name>
```

Each run writes `scripts/chat-eval/results/<label>.md` with response, latency, and token/cache stats per prompt.

## Adding prompts

Edit `prompts.json`. **Append, don't replace** — old prompts catch regressions.

Each prompt:

```json
{
  "id": "kebab-case-id",
  "category": "db_lookup | tool_use | memory | multi_step | edge_case",
  "text": "What the user types",
  "expects": "Plain-English description of a correct answer"
}
```

## Reading results

The markdown report shows per-prompt:

- **Latency** — wall-clock time from request to final SSE event
- **Tokens** — `input` / `output` / `cache_create` / `cache_read`
  - High `cache_read` on later prompts = caching is working
  - High `cache_create` on every prompt = system prompt is unstable, cache is being invalidated
- **Tool calls** — which tools the AI invoked (read tools execute, write tools become proposed_actions)
- **Response** — the streamed text reply

## Interpreting the comparison

`--compare` prints deltas in totals. Look for:

- ✅ Lower latency, lower input tokens, higher cache_read: your change made the chat faster/cheaper
- ⚠️ Same tokens, different responses: quality may have changed — read the per-prompt diffs
- ❌ More failures, more tool calls without clarification: regression
