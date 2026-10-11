# Prompt cache lifetime and cost

Measured 2026-09-18 to 2026-09-29 with `probe ttl` and `probe quota`. Read this before you reason
about cache TTLs, cache warming, or what a cache write costs. What this means for token spend is in
[token-spend.md](token-spend.md), and the patches are in [cache-patches.md](cache-patches.md).

Two endpoints appear below. **Through DroidProxy** means the local proxy (CLIProxyAPI on
`localhost:8317`). **Direct** means `https://api.anthropic.com/v1/messages` with the subscription
OAuth token (`--direct`).

## Summary

1. DroidProxy turns every Anthropic cache write into a 1 hour write, whatever TTL the request asks.
2. On the subscription meter a 1h write and a 5m write cost the same. Both cost 1.25x plain input. A
   cache read is at least 9x cheaper than a write.
3. The TTL is a sliding idle window. Each read of the same prefix pushes expiry a full TTL past that
   read, and the window counts from request start.
4. Only a read of the whole prefix keeps it warm. Other traffic on the account does not.
5. So what costs quota is busts (rewrites of a cached prefix), not TTL choice.

## DroidProxy forces 1 hour

`probe ttl price --prompt-tokens 8000` through DroidProxy, plus repeats with 22k-token prompts:

| Request asked for             | `cache_creation` came back             |
| :---------------------------- | :------------------------------------- |
| `{type:"ephemeral"}`          | `ephemeral_5m: 0, ephemeral_1h: 22136` |
| `{type:"ephemeral",ttl:"5m"}` | `ephemeral_5m: 0, ephemeral_1h: 22140` |
| `{type:"ephemeral",ttl:"1h"}` | `ephemeral_5m: 0, ephemeral_1h: 27136` |

Sent direct, `ttl:"5m"` comes back as `ephemeral_5m_input_tokens`, so Anthropic honours it and the
bundled proxy (`cli-proxy-api v7.3.3+dirty`) overrides it. Timed runs agree: a plain ephemeral write
through the proxy was still read after 12 minutes.

Consequences:

- Through DroidProxy, `probe ttl cliff` and `refresh` measure the 1h cache. Use `--direct` to see a
  5 minute clock.
- DroidProxy forwards no `anthropic-ratelimit-*` headers, so quota is only visible direct or through
  `/api/oauth/usage`.
- A `user-agent` older than `claude-cli/2.1.251` is rejected for Fable with
  `claude_code_version_too_old`.
- The `3.5 chars/token` filler estimate runs ~29% low, and a 146-token prompt cached nothing.

## The subscription meter: write and read cost

Method (`probe quota`): send fresh prompts of one kind until
`anthropic-ratelimit-unified-5h-utilization` rises 1%, and count the tokens between rises. Arms run
interleaved (ABAB) in one shell loop so drift hits both. Sends are logged to
`~/.factory/ovrdroid/quota-runs.jsonl`.

Controlled run, 2026-09-19, `claude-opus-5`, direct, 700 sends, other sessions idle:

| Kind of token         | Sends | Spans | Tokens per 1% of 5h quota |     vs plain |
| :-------------------- | ----: | ----: | ------------------------: | -----------: |
| 1h cache write        |   222 |     8 |            776,667, sd 5% |       1.245x |
| 5m cache write        |   176 |     6 |            786,094, sd 3% |       1.230x |
| plain input, no cache |   102 |     3 |            966,776, sd 1% |       1.000x |
| cache read            |   200 |     0 |     never moved the meter | below 0.014x |

- 1h and 5m differ by less than their own noise (t = 0.60). The API's 1.6x premium for 1h does not
  apply to this meter.
- Writes cost 1.25x plain input, the API's write multiple.
- 200 reads of a 35,550-token prefix (7.1M tokens) did not move the meter once. A read is at least
  9x cheaper than a write and 71x cheaper than plain input. The bound is one-sided: the probe hit
  its 200-send cap first. `probe quota read` reports "0 crossings" in that case, which is the
  result, not a failure.
- The run cost about 19% of one 5 hour window.

Why Opus and not Fable: `/api/oauth/usage` showed a `weekly_scoped` limit bound to Fable that the
unified 5h header does not show, so a Fable send spends a cap the probe cannot see. Opus also packs
~3.7x more tokens per percent, which is what gave the spans enough resolution.

An earlier Fable run (2026-09-18) gave the same answer with wider error, and its read arm is void:
the meter fell mid-run as older usage aged out. The probe now flags a falling meter.

This run is what closed the 5m or 1h question. How it was first misread, twice, is in
[ttl-choice.md](ttl-choice.md).

## The TTL slides with each read

`probe ttl refresh --direct --prompt-tokens 20000`, `claude-opus-5`, 25,538 cached tokens, 5m TTL:

| Send | Gap | Age of entry | Result             |
| ---: | :-- | :----------- | :----------------- |
|    1 | 0   | 0m           | read (from set-up) |
|    2 | 4m  | 4m           | read               |
|    3 | 4m  | 8m           | read               |
|    4 | 4m  | 12m          | read               |
|    5 | 6m  | 18m          | **write**, missed  |

The entry lived 12 minutes on a 5 minute TTL. So the gap between requests decides a bust, never the
age of the entry. Against the real traffic (median gap 8.7s, 98.6% of turns under 5 minutes), an
active session's window effectively never closes.

## The clock starts at request start

`probe ttl clock-start --direct`: send 1 took 161.2s to answer, then a 4 minute gap, then send 2.
Send 2 missed. 161s plus 240s is past the 300s TTL, while the gap alone is under it. So a slow turn
spends its own TTL while it answers, and a 20 minute agent turn on a 5m TTL busts its own prefix.

`clockTestDecides` refuses a verdict unless the answer plus the gap exceeds the TTL while the gap
alone stays under it. The first attempt answered in 39s, so both clock theories predicted a read.

## Only the same prefix keeps itself warm

`claude-opus-5`, direct, 5m TTL, sends at 0m, 4m and 6m:

| Probe                   | Send 2 (4m)             | Send 3 (6m), the first prefix again |
| :---------------------- | :---------------------- | :---------------------------------- |
| `probe ttl unrelated`   | unrelated prompt, write | read 0, full write                  |
| `probe ttl shared-head` | same first 6,437 tokens | read 6,437, write 19,134            |

Activity on the account refreshes nothing. A shared head keeps only the head warm. A warm request
must carry the whole prefix.

## The proxy's 1 hour is not a reliable hour

Through DroidProxy, `claude-opus-5-5`:

- `probe ttl hour-refresh` (gaps of 54m and 54m): the first entry was gone at 54m, the second
  survived 54m.
- `probe ttl hour-cliff` (gap of 66m): gone.

So the lifetime is usually past 54 minutes, not always. That is why the warmer fires at 45 minutes
on Anthropic: a read is nearly free, and a warm after the entry died is a full rewrite.

## Open items

- A series with gaps of 40, 45, 50 and 56 minutes through the proxy was still running.
- Whether DroidProxy bills a 2x write rate or absorbs it is not measured.
