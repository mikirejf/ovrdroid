# Prompt cache patches

Measured on Droid 0.222.0 to 0.233.0. Read this before you change the cache usage log, the shared
GPT cache key, the cache warmer or compaction reuse. How long a cached prefix lives, and what a
write or read costs, is in [cache-lifetime.md](cache-lifetime.md).

## Shipped: `cache-usage-log`

Droid never wrote per-request token usage to disk. `commitTurnTokenUsage` runs once per finished,
non-aborted LLM request and only adds into session sums. The patch appends one line per call to
`~/.factory/ovrdroid/cache-usage.jsonl`:

```
{"t":1789735449729,"s":"13a0a153-...","m":"claude-opus-5","in":2,"cr":0,"cw":26108,"out":4,"th":0}
```

It writes only when the directory exists, uses `appendFileSync` in a try/catch, and never throws
into a turn. `cache-usage-log-promote` adds a `promote` line when Droid's built-in 1h promotion
timer fires (it only fires in JSON-RPC mode or an agent process).

Droid's stream reducer reads `cache_creation_input_tokens` and `cache_read_input_tokens` only. It
never reads the 5m and 1h split, so that split needs `probe ttl` against the API.

### The rotating logs

`probe logs` copies `~/.factory/logs/droid-log-single.log*` to `~/.factory/ovrdroid/logs/`, because
Droid keeps them about 3 days. The first copy (2026-09-14 to 2026-09-18): 11,794 `Streaming result`
lines across 405 sessions, and 190 `prompt_cache_miss_detected` warnings. 189 of those 190 broke at
a `tools.N` segment. **When the prefix breaks, the tools array changed.**

Two limits of that log: `callingSessionIdPresent` is `"false"` on every line, so subagent requests
cannot be told from the parent's. And OpenAI models report `cache written 0`, because OpenAI bills
no write. That is not a miss.

## Shipped: `custom-openai-shared-cache-key`

Droid sent OpenAI a `prompt_cache_key` equal to the session id. OpenAI reuses a cached prefix only
within one key, so every new session and subagent on a custom GPT model started cold. In
`cache-usage.jsonl` (5.9 days, 192 GPT sessions), first requests read 0 at the median and made up
16.4% of all uncached GPT input. Claude already read ~10.8k on 63% of first requests.

The patch uses the key `ovrdroid` for every custom model. Built-in models keep the session id. A
prefix only matches a cache written by the same model, so one key cannot mix caches. The idea came
from Cursor's post on token efficiency (https://cursor.com/blog/improved-token-efficiency).

Checked through DroidProxy 1.8.148 (CLIProxyAPI v7.3.15):

- **The proxy passes the key on** as `Session-Id`. Two keys against one prefix both missed first and
  read 28,416 second, so the key really gates reuse.
- **The proxy's per-key reasoning cache does not apply.** It is on only for Claude-format input, and
  Droid talks to custom GPT in the Responses format.
- **Parallel sessions on one key are fine.** Four parallel requests on a warm key all read 26,368 of
  ~27,200. OpenAI may overflow traffic over ~15 requests/min per key to other machines
  (https://developers.openai.com/api/docs/guides/prompt-caching). That can cost a read, never
  correctness.

`bun run probe cachekey <stock> <patched> -m custom:droidproxy:gpt-6-luna -r 8`: stock median cache
read 0, patched 10.8k of ~10.9k on all 8. Time to first token did not resolve. The saving is
uncached input, not speed.

## Shipped: the cache warmer (`cache-warm-*`)

While a subagent runs longer than the TTL, the parent's prefix would expire. The warmer re-sends the
parent's last request so it reads the prefix and slides its clock. Warm bodies were captured with a
`--bodies` probe build and compared with `probe bodies <file>`, which says where each request stops
extending the one it replays.

What a warm must match, each found by a capture that failed:

1. **The same thinking and effort as the turn it replays.** On `opus-5-5`, a warm with thinking off
   wrote its own 10,130-token entry and never refreshed the parent's. With the same thinking and
   effort it read 24,384 and wrote 0. GPT showed the same with `reasoning` and `include`. The
   earlier `probe effort-cache` result (thinking off still read) does not hold in real sessions, and
   why is not pinned down.
2. **The same tool list.** The first GPT warm diverged at `tools[11]`: the one-shot client skipped
   the tool-search resolver and sent 17 plain tools, while the real turn sent 50 entries. Building
   the warm with `createLLMStreamingCore`, the agent loop's own client, fixed it.
3. **`max_tokens:1`.** On Claude the thinking-config builder overwrote the warm's override with the
   model's `maxOutputTokens` (128,000). `cache-warm-max-tokens` passes `maxOutputTokens` only when
   the caller set no override. Anthropic accepts `max_tokens:1` with adaptive thinking. Live on
   `sonnet-5-5`, both warms read 20,798 and wrote 0, and the parent's next request read 20,798.

The warmer fires at 45 minutes on Anthropic ([cache-lifetime.md](cache-lifetime.md) says why).
`OVRDROID_WARM_DELAY_MS` overrides the delay for tests.

pi warms only direct Anthropic, never OpenAI (pi issue #9810), and keys OpenAI's cache per session,
so its forks miss (#8348).

## Shipped: compaction reuse (`compaction-reuse-*`)

Stock compaction sent a summary request that shared nothing with the conversation: its own system
prompt, no tools, and the transcript flattened into one user message. It read 0 from cache and wrote
the whole transcript each time, about $0.89 at 178k tokens on Opus.

Droid stores a snapshot of every main-agent request (system, prepared history, tools, model, effort)
for four minutes, and has a helper that appends one user message to it.

- `compaction-reuse-exports` publishes the snapshot lookup, the append helper and the `extend`
  helper as `globalThis.__odReuse`, because the summarizer chunk imports none of them.
- `compaction-reuse-extender` stores `odExtend(ask)` on each snapshot (see below).
- `compaction-reuse-prefix` makes the first summary attempt over the snapshot.

The first attempt:

1. Uses the snapshot only when its model is the compaction model.
2. Sends the snapshot's system, history, tools, model and effort, plus the summarizer prompt (and
   any `/compress` instructions) as the appended message, with stock's output cap. It sets no
   `tool_choice`, because that would change the request head.
3. Checks the abort signal first. The helper drops the aborted flag, and an aborted Responses stream
   can return partial text that would be saved as the summary.
4. Accepts a reply with text and no tool call. Every other outcome falls back to the stock request
   once. An abort is never turned into a fallback.

Each outcome logs a `cache-usage.jsonl` line with `compact` set to `reuse`, `reuse-extended`,
`no-snapshot`, `other-model`, `prefix-mismatch`, `unseen-messages`, `tool-call`, `empty` or `error`.

### Messages the snapshot missed

The snapshot is the last request, so it misses that request's reply and tool results. Manual
`/compress` summarises every stored message, so the first version lost the last reply and listed an
answered question as pending.

`odExtend(ask)` reruns the agent loop's own request conversion on the live history plus the summary
instruction, with the reminders and summary captured with the snapshot. The instruction must go in
as the extra user message, because the conversion strips trailing assistant messages. `extend`
accepts the rebuild only when:

1. Every message up to the snapshot's length matches the snapshot's role and content, ignoring
   `cache_control`. Otherwise `prefix-mismatch`. The conversion is not a pure append: it drops
   orphaned tool uses and old images across the list.
2. Every missed message with content is in the rebuilt tail. Otherwise `unseen-messages`. Empty
   rows, such as `SessionStart` hook rows, are skipped, because the loop never sends them.

The request then carries the snapshot's own message objects, so the cached prefix matches byte for
byte, followed by the rebuilt tail.

### Measured on 0.233.0

- `sonnet-5-5`, three trivia turns then `/compress`: the summary read 26,026 of 26,030 and logged
  `reuse-extended`. The summary lists the last question as answered.
- `gpt-6-luna`: four of five summaries read 14,848 of ~15,720. One read 7,680, and the next
  identical run read 14,848 again, so that looks like OpenAI routing.
- Automatic compaction on Sonnet (limit 26,000) fired twice and read 30,063 of 30,065 and 38,319 of
  38,323, both `reuse`.

### The instruction leak

Stock's summary format asks for the user's latest message, which in the reuse path is the summary
request. Luna wrote "the latest user message asks for a conversation summary". The summary line now
says to use the last user message before the request. All four runs after that named the real last
question.

One difference remains: the summary covers the whole conversation, including the messages compaction
keeps, where stock summarises only the part it drops.
