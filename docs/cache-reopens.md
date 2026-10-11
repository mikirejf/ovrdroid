# Reopened sessions and the midnight date note

Measured 2026-10-01 with `bun run probe reopens`, which reads `cache-usage.jsonl` and the `resume`
`SessionStart` rows in the transcripts and sends nothing. Read this before you chase a cache miss
after a reopen or after a long idle. The full evidence is in `RESUME_CACHE.md`.

## A reopened session mostly reads its history from the cache

A reopen counts when the first request after it came 1 to 60 minutes after the last one before it. A
full read is a cache read of at least 90% of what the last request before the reopen held.

**133 of 162 real reopens read the full history (82.1%).** The log grows, so a rerun prints slightly
larger counts.

| Gap, minutes | All models | Claude |   GPT |
| :----------- | ---------: | -----: | ----: |
| under 5      |      68/76 |  34/36 | 34/40 |
| 5 to 10      |      20/25 |   6/11 | 14/14 |
| 10 to 20     |      24/33 |  17/26 |   7/7 |
| 20 to 40     |      15/21 |  14/17 |   1/4 |
| 40 to 60     |        6/7 |    4/5 |   2/2 |

Claude reads less past 5 minutes (41 of 59), but gaps of 20 to 60 minutes still mostly hit. Since
2026-09-20 it is a little better: 124 of 147.

Three controlled recordings, live against reopened, were byte-identical in the shared prefix except
that reopened tool results carried `"is_error": false`. Droid only writes that key for messages
loaded from disk. `tool-result-omit-false-is-error` now writes it only when true. The cache hit with
the key present, so this is a cleanup, not the cause of the misses.

The probe sorts the 29 misses by cause:

1. **Crossed midnight (4).** The last request before and the first after fell on different local
   days. See below.
2. **Setup changed (6).** Another session of the same provider started within 10 minutes and read
   the same amount, so the reopen got only what a new Droid process could share at that moment.
3. **Unexplained (19).** They read more than a new session would, or read a common fresh-session
   amount with no new session nearby. Explaining them needs the request bodies as sent.

## The proxy's date note flips at local midnight

CLIProxyAPI puts "Today's date is YYYY-MM-DD." as the first block of the first user message of every
Claude request, in the proxy's time zone (`Europe/Ljubljana` here). At local midnight `messages[0]`
changes, so everything after the tools and system prompt misses. This hits idle live sessions too,
not only reopens
([source, v8.0.5](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.5/internal/runtime/executor/claude_executor_cloaking.go#L1157)).

Claude request pairs in one session, gap 3 to 55 minutes, previous request at least 40k tokens:

| Pair                    | Read the full history |
| :---------------------- | --------------------: |
| both on one local day   |  1,489 of 1,599 (93%) |
| crossing local midnight |          1 of 13 (8%) |

GPT is not hit: 2 of 3 GPT reopens across midnight read in full. `probe reopens --time-zone` flags
the crossing, for Claude only. Midnight explains 4 reopen misses, but not every small read on
2026-09-30. Three of those came 24 to 50 minutes after midnight and one in the afternoon. Why a
reopen shortly after the flip still misses is not known.

## Fixed upstream in CLIProxyAPI 8.0.12

Issue [#6282](https://github.com/router-for-me/CLIProxyAPI/issues/6282) was fixed in v8.0.12
(2026-10-02). The first request of a session saves the date and later requests reuse it
([`PinClaudeSessionDate`](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.12/internal/runtime/executor/helps/claude_diagnostics.go)).
The pin lives only in the proxy's memory: a restart (a Homebrew upgrade restarts it) forgets it, and
it expires one hour after the session's last request.

Droid sends no `x-session-id` on BYOK requests, so the proxy guesses the session from a hash of the
system prompt start, the first user message and the first reply
([`extractMessageHashIDs`](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.12/sdk/cliproxy/auth/selector.go)).
That hash changes once, between turn 1 and turn 2, so a session started just after midnight can
still miss once on turn 1. A patch that adds `x-session-id` to BYOK requests would close that gap;
not done
([the proxy reads the header](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.12/sdk/cliproxy/session/info.go)).

Homebrew installed cliproxyapi 8.0.20 here on 2026-10-08, and `probe reopens` found no midnight miss
from then to 2026-10-10.
