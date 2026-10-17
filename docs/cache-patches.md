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
   model's `maxOutputTokens` (128,000). Since 0.242.0 stock clamps the override to that limit
   instead, so the warm's 1 token survives without a patch. Anthropic accepts `max_tokens:1` with
   adaptive thinking. Live on `sonnet-5-5`, both warms read 20,798 and wrote 0, and the parent's
   next request read 20,798.

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
4. Accepts a reply that has text, calls no tool and is a summary (see below). Every other outcome
   falls back to the stock request once. An abort is never turned into a fallback.

Each outcome logs a `cache-usage.jsonl` line with `compact` set to `reuse`, `reuse-extended`,
`no-snapshot`, `other-model`, `prefix-mismatch`, `unseen-messages`, `tool-call`, `empty`,
`not-summary` or `error`. A `not-summary` line also keeps the first 600 characters of the rejected
reply as `head`, so a real refusal can be read later; Droid's own logs never hold that text.

### A reply that is not a summary

Haiku 5.5 subagents often answer the summary request with a refusal or with their final task report.
A reply counts as a summary only when it names at least three of the stock section headings
(`SUMMARY_SECTIONS` in `src/patch/summary-format.ts`). Any other reply logs `not-summary` and falls
back to the stock request. The payload builds its check from the same constants as `isSummary`, so
the rule has one source. The stock request's own reply is not checked.

`probe summaries` runs the check over every stored summary. Since 2026-10-11 it flags 37 of 398,
every one from the reuse path and from a Haiku subagent. A heading written as a bullet
(`• Approach`) counts, because one real replayed summary used that style.

### Why Haiku refuses, measured on 0.242.0

`probe compaction-rebuild` rebuilds a past compaction request from the session file. It reproduced
four captured requests byte for byte and the fifth up to one cache mark. `probe compaction-replay`
sends a request again as captured (reuse), as stock would build it (stock), and with another wording
(alt). Haiku 5.5 through DroidProxy:

1. Five ordinary compactions from a live grunt run: reuse wrote a summary 30 of 30 times, stock 30
   of 30.
2. Six rebuilt grunt refusals: only one still refused on replay, and it refused 13 of 26 times on
   reuse. Eight of those also called a tool to keep working.
3. Stock refused 0 of 56 times across the six cases. It wrote its own layout 21 times, once spent
   the whole output cap on thinking and returned nothing, and several times told the files the grunt
   had read as if they were the session's own threads.
4. An alt wording that calls the summary a step in the task, without "do not mention it", refused 2
   of 26 times on the refusing case.

On reuse the request arrives as one more user message inside the grunt's working conversation, and
Haiku sometimes sets it aside to keep working. Stock sends the summarizer prompt as the system
prompt and the conversation as quoted text, so there is no task to go back to.

### Claude models get the ask without "so do not mention it", measured on 0.242.0

`probe compaction-variants` replays each rebuilt case under one change at a time and prices every
reply with the cache the arm's first request met (stock is priced cold, as in a real session).
`probe compaction-reasons` sorts the refusals by the reason Haiku's thinking gives. Haiku 5.5
through DroidProxy, on the refusing case, 40 runs per arm:

| ask                                            |  refused | 95% range | $ per compaction |
| ---------------------------------------------- | -------: | --------: | ---------------: |
| as shipped before (reuse)                      | 19 of 40 |    33-63% |          $0.0134 |
| without "so do not mention it" (no-mention)    |  0 of 40 |      0-9% |          $0.0038 |
| without the "system request" claim             | 12 of 40 |    18-45% |          $0.0096 |
| as a mid-conversation system message, no tools |  0 of 40 |      0-9% |          $0.0039 |
| stock                                          |  0 of 40 |      0-9% |          $0.0219 |

1. The clause "so do not mention it" causes the refusals; the "system request" claim does not (p =
   0.17 against as shipped). Most refusals say the task comes first. One says outright: "Your
   request asks me to hide that I'm making it, and I'd rather not do that."
2. On the five cases that did not refuse, no-mention also refused 0 of 40, read 99% from cache and
   cost $0.0046 against $0.0051.
3. The system message refused 4 of 40 there, three of them empty replies that spent the whole output
   cap on thinking. Its first request missed the cache on four of the five cases (29% read), and it
   cannot follow an assistant turn, so `/compress` after a reply returns 400. It was dropped.
4. The 84-file digest task, run live on Haiku and graded by `probe digest-grade` against a key
   computed from the files: no-mention 5.22 of 6 and as shipped 5.14 over 15 runs each (p = 0.73),
   stock 4.82 over 5. The fallback caught 1 non-summary in 58 no-mention compactions and 2 in 53 as
   shipped; nothing stored was a refusal.
5. Sonnet 5.5 and Opus 5.5 reuse requests captured live: no-mention wrote a summary 10 of 10 times
   each. Its summaries ran 124 output tokens longer on Sonnet and 43 on Opus (means of 10). The
   replayed old wording also read its own ask from cache, which a real compaction cannot, so the
   replay cost gap ($0.0224 against $0.0180 on Sonnet) overstates the difference.
6. Live, both wordings read 99.2-99.3% from cache on a `reuse` compaction and about 72% on a
   `reuse-extended` one. The extended request must also send the tool results that arrived after the
   last request, which were never cached, so 95% holds only for the plain path.

`compaction-reuse-prefix` sends the no-mention line when the model id matches
`claude|haiku|sonnet|opus` (Droid's own test for Anthropic model names) and the old line to every
other model, which was not measured. The fallback stays for both.

### GPT keeps the old ask, measured on 0.242.0

GPT 6 Luna through DroidProxy. I captured one reuse compaction live with
`probe compaction-capture --model-id custom:droidproxy:gpt-6-luna`: a main session that read 8
digest files, then `/compress`. I replayed it 40 times per arm. As shipped (reuse) wrote a summary
40 of 40 times, and no-mention wrote one 40 of 40 times. There were no tool calls and no empty
replies, and both arms read 100% of the input from cache.

This was an ordinary main-session case, not a subagent in the middle of a task like Haiku's
refusals. It shows that Luna does not need the change. It does not show that Luna never refuses
there. `compaction-replay` reads the Responses-format bodies that Droid sends to GPT models for
this, and replays only the reuse, no-mention and no-claim arms for them.

### A subagent's summary carries its parent's brief

The parent reads only a subagent's final reply, and the subagent's own summary loses the task it was
given. `compaction-parent-brief` appends to the summary the summarizer returns, after the todos, on
the reuse path and the stock path alike:

1. A lead line, the parent's task word for word (the first user text block that is not a
   `<system-reminder>`), and a fixed note that the parent never saw the summary.
2. The note alone when no such block exists.

Three live grunt runs on 0.242.0 compacted 13 times between them, all on reuse. Each stored summary
ended with the note, and each next request carried the lead, the Task prompt word for word and the
note.

A main session has no calling session, so its summary is returned as stock returns it. If reading
the session fails, the summary is returned without the brief, because losing the compaction is worse
than losing the brief.

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
