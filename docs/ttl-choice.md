# The 5m or 1h question, and why it is closed

2026-09-18 and 2026-09-19. Read this before you propose a TTL policy, a TTL predictor, or a patch
that sends `ttl:"5m"`. The answer is no, and this file says how that was reached, including two
wrong turns. The measurements behind it are in [cache-lifetime.md](cache-lifetime.md).

## The answer

On this subscription a 1h write costs the same as a 5m write, and DroidProxy forces 1h anyway. So
there is nothing to choose. What costs quota is busts ([cache-busts.md](cache-busts.md)).

## Who decides the TTL

DroidProxy bundles CLIProxyAPI. For an OAuth Claude credential it upgrades every `cache_control`
block to `ttl:"1h"` (`upgradeClaudeCacheControlTTL`), on both the plain and the streaming path. It
knocks subagent and helper requests back to 5m, and deletes a 1h `ttl` that sits behind a 5m block
rather than return an error.

The `main` source on GitHub skips blocks that already carry a `ttl`, which looked like an escape
hatch. **The bundled backend (`v7.3.3+dirty`) does not.** An explicit `ttl:"5m"` sent through it
comes back as a 1h write. Sent direct to Anthropic it stays 5m.

## What the traffic looks like

Nine months, 7,338 Claude sessions, 317,848 assistant turns, 2025-12-19 to 2026-09-18, read from the
`.settings.json` file beside each transcript:

| Gap to the next request |   Turns | Share |
| :---------------------- | ------: | ----: |
| under 5 minutes         | 306,121 | 98.6% |
| 5 minutes to 1 hour     |   4,076 |  1.3% |
| over 1 hour             |     313 |  0.1% |

Median gap 8.7s, p90 47.6s. Because a read slides the TTL, a fast agent loop never lets the window
close. The long waits are mostly subagents: from 600 sessions, 33% of `TaskOutput` waits and 17% of
`Task` waits passed 5 minutes, against 0.5% of `Execute` waits. That is why the cache warmer exists
([cache-patches.md](cache-patches.md)).

## Wrong turn 1: "there is no 5m cache to optimise"

When `probe ttl` showed the proxy forces 1h, the first reading was that there was nothing to tune.
The second reading reversed it: at API prices the proxy pays a 2x write instead of 1.25x on every
write. A replay of the nine months then said always-5m would cost 21.6% less ($837 a month at list
price), and a perfect predictor would add only 0.23% on top. The plan became "always send
`ttl:"5m"`", and the transcript-mining plan for a TTL rule was dropped.

## Wrong turn 2: the 21.6% was priced in dollars the account never pays

The audit found three errors:

1. **The escape hatch was read from the wrong source.** `probe ttl` never sent an explicit 5m, and
   the cited code was `main`, not the bundled backend. Sent for real, 5m comes back as 1h. The 5m
   patch would have changed nothing.
2. **The replay expired an invented prefix.** It set the expiring prefix to
   `cacheCreationTokens / turns`, a sliver of the real one. A real expiry rewrites everything. On a
   100k prefix with one 10 minute gap the corrected sum favours 1h. The oracle shared that error, so
   0.23% was no ceiling either.
3. **The account pays in quota, not dollars.** On the 5h meter 1h and 5m writes cost the same within
   1.2% ([cache-lifetime.md](cache-lifetime.md)). The API's 1.6x premium does not exist here.

## Lessons

- Read the code that actually runs. The bundled proxy differed from its upstream `main`.
- Measure in the unit the account pays. API list prices answered a question nobody had.
- A replay is only as good as its model of what expires. Check it against one known case first.
