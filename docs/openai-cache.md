# OpenAI prompt caching

Measured on Droid 0.222.0, 2026-09-18 and 2026-09-19. Read this before you reason about GPT cache
numbers, because the obvious field reads zero for reasons that are not misses. The shared cache key
patch is in [cache-patches.md](cache-patches.md).

## GPT traffic is the best-cached traffic here

An earlier note said GPT models wrote no cache at all. That read a field wrong.

| Model        | Sessions | Fresh input | Cache write | Cache read | Hit rate |
| :----------- | -------: | ----------: | ----------: | ---------: | -------: |
| gpt-5.6-sol  |    1,045 |       88.9M |       92.8k |     955.0M |    91.5% |
| gpt-5.6-luna |      532 |       56.9M |           0 |     846.3M |    93.7% |
| gpt-5.4      |       66 |       20.9M |        5.4M |     279.3M |    91.4% |
| gpt-5.5      |       88 |        5.5M |           0 |      53.1M |    90.6% |
| gpt-6-astra  |       48 |        3.4M |           0 |      38.2M |    91.8% |

Across 1,801 GPT sessions, 92.5% of 2.45B input tokens were cache reads.

## Why the write column reads zero

1. **OpenAI charges no write below GPT-5.6**, so there is no field to report. From GPT-5.6 a write
   costs 1.25x
   ([model differences](https://developers.openai.com/api/docs/guides/prompt-caching#summary-of-model-differences)).
2. **Droid reads only one of two field spellings.** It reads `prompt_tokens_details.cached_tokens`
   and never `input_tokens_details.cache_write_tokens`, which the Responses API returns on GPT-5.6.
   The proxy handles both, so the number exists and Droid drops it. Reported cost is understated;
   caching works.

**Rule: when a metric reads zero, check whether the thing did not happen or nobody read the field.**

## Anthropic against OpenAI

| Behaviour    | Anthropic                   | OpenAI GPT-5.6+                 |
| :----------- | :-------------------------- | :------------------------------ |
| Default      | off without a marker        | on, implicit breakpoints        |
| Breakpoints  | 4, all explicit             | implicit, plus up to 4 explicit |
| Write charge | 1.25x at 5m, 2x at 1h (API) | 1.25x, no TTL tiers             |
| Read charge  | 0.1x                        | 0.1x                            |
| Lifetime     | 5m or 1h, sliding           | 30m only, sliding               |
| Minimum      | 4,096 tokens on Opus        | 1,024 tokens                    |
| Routing      | not exposed                 | `prompt_cache_key`              |

There is no TTL choice on OpenAI: `"30m"` is the only value and already the default.

## How other proxies handle it

- **pi** (`earendil-works/pi`) maps `cached_tokens` to reads the same way, sends a stable
  `prompt_cache_key` per session with `store: false`, and keeps timestamps out of serialised
  messages, which is the most common way a prefix breaks.
- **vibeproxy** parses and re-serialises JSON when a request has `cache_control`, which can reorder
  keys and kill every later hit. DroidProxy edits the string in place to avoid exactly that.
- **CLIProxyAPI** strips `previous_response_id`, `prompt_cache_retention`, `safety_identifier` and
  `stream_options`, then injects a stable `prompt_cache_key` and mirrors it as `Session-Id`. Its
  `identity-confuse` setting remaps the key per credential. It is off here, and turning it on would
  cost hit rate.

## Open: the uncached tail

The 92.5% average does not prove there is nothing left. Three things were never measured:

1. **78 of the first 200 logged busts were `openai_responses.tools.N`.** Group them by session and
   by the event before them, and measure the prefix lost each time. The tools fixes in
   [cache-busts.md](cache-busts.md) may already cover most of them.
2. **Droid sends no explicit breakpoints.** OpenAI's implicit one sits at the end of the latest
   message. Explicit breakpoints help when a thread forks, which is the subagent case. The shared
   cache key patch covers part of this.
3. **The uncached 7.5% was never broken down.** It could be new content, busts, fork misses, or
   requests under 1,024 tokens. Compare each request's fresh input with the tail appended since the
   last request: about equal means new content, much larger means a bust.
