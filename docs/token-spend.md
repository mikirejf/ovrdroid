# Token spend: where the quota goes and what is in place

Start here for any work on prompt cache cost. Settled 2026-09-19, updated as patches landed. The
account is a Claude Max subscription through DroidProxy, so the unit is the 5 hour usage meter, not
API dollars.

## What a token costs on the meter

Measured with `probe quota` ([cache-lifetime.md](cache-lifetime.md)):

- **A cache write costs 1.25x plain input.** A 1h write and a 5m write cost the same.
- **A cache read is nearly free**: under 1/9 of a write and under 1/71 of plain input.
- **DroidProxy forces every write to 1h.** Since 1h costs nothing extra here, that is the right
  setting. Its 1h entry usually lives past 54 minutes, not always.

So the only lever is **writes**, and the costly write is a **bust**: a request that rewrites a
prefix that was already cached.

## Where the writes came from

Four days, 2,539 Claude requests, 84 sessions, 17.3M tokens written:

| Source                          | Share | Status                                                         |
| :------------------------------ | ----: | :------------------------------------------------------------- |
| Tool results (Read, Grep, Exec) |  ~43% | Agent behaviour, not mechanics: read fewer lines, use limits   |
| Per-session fixed context       |  ~25% | 7.7k tokens per session: skills list 3.1k, AGENTS.md pair 3.1k |
| Cache busts (tools array grew)  |  ~19% | Closed, see [cache-busts.md](cache-busts.md)                   |
| Compaction, model switch, other |  ~13% | Compaction now reads the cache, see below                      |

## What is in place

Settings:

- `blockOnMcpLoad: true` at the **root** of `~/.factory/settings.json`. Under a `general` wrapper it
  is silently ignored. The first-turn gate keeps stock's 60s cap, so a slow MCP server cannot join
  on turn two and bust the cache.
- `disabledSkills` hides built-in skills the model never uses. The skills list is rebuilt each
  session, so each removed name saves its description on every first turn.

Patches:

- `gate-first-turn-on-ide-connect`, `web-fetch-always-loaded`, `web-search-always-loaded`: stop the
  tools array from growing after turn one ([cache-busts.md](cache-busts.md)).
- `cache-usage-log`: one line per request in `~/.factory/ovrdroid/cache-usage.jsonl`.
- `custom-openai-shared-cache-key`: new GPT sessions and subagents read the prefix an earlier one
  wrote.
- `cache-warm-*`: while subagents run, re-send the parent's last request after 45 minutes on
  Anthropic (27 otherwise) so its cache survives.
- `compaction-reuse-*`: compaction summarises over the cached conversation instead of rewriting it.

The last four are described in [cache-patches.md](cache-patches.md).

## Not worth doing

TTL predictors, 5m-or-1h policies and promotion timers. They all rest on the API's 1h price premium,
which the meter does not charge. The full story of that question is in
[ttl-choice.md](ttl-choice.md).

## Claims and evidence

A claim is **documented** when Anthropic, OpenAI or Droid says so, and **measured** when a probe in
this repo produced the number and a file in `docs/` records the run. DroidProxy sits between Droid
and the API and can rewrite anything, so a documented claim is not trusted until it is measured.
Nothing is built on an open claim.

## Next

1. **Log prefix identity per request.** Add the tools array hash and the breakpoint positions to
   `cache-usage-log`, so a bust can be blamed without joining transcripts.
2. **Re-run `probe quota` after any Anthropic plan or pricing change.** Use `claude-opus-5`. Avoid
   Fable: it has its own weekly cap that the 5h header does not report.
3. **Read `input_tokens_details.cache_write_tokens`**, so GPT-5.6+ write cost stops being invisible
   ([openai-cache.md](openai-cache.md)).

## Open claims

- Any deferred tool other than WebFetch and WebSearch, loaded mid-session, still busts the cache on
  custom models.
- Whether the 20-block lookback ever misses a cache that exists.
- What the uncached 7.5% of GPT input is ([openai-cache.md](openai-cache.md)).
- Whether a skill's text lands in a message or in the system prompt.
- Whether a fork reads the parent's cache. A reopened session mostly does: 133 of 162 read their
  full history ([cache-reopens.md](cache-reopens.md)).
- Why 19 of the reopens that missed did so.
