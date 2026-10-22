# Cache busts: what rewrites a cached prefix

A bust is a request that rewrites a prefix that was already cached. On this plan a read is nearly
free and a write is not, so busts are where cache quota goes ([token-spend.md](token-spend.md)).
Measured on Droid 0.222.0, 2026-09-19, with `probe busts` over the logs `probe logs` keeps.

## What the API says invalidates the cache

From Anthropic's
[invalidation table](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache):

| Change                         | What is lost               |
| :----------------------------- | :------------------------- |
| Tool definitions               | everything                 |
| System prompt                  | system and messages        |
| `tool_choice`                  | messages                   |
| Image added or removed         | messages                   |
| Thinking or effort setting     | messages, often everything |
| Model                          | everything, separate cache |
| Any content edit in the prefix | from that point on         |

Thinking blocks are kept by default on Opus 4.5+ and Sonnet 4.6+, so a user message after a thinking
turn does not invalidate.

## Measured: the tools array grows, and that is the bust

Droid's miss detector logs `prompt_cache_miss_detected` with the region that changed. `probe busts`
joined 203 warnings to 3.3M rewritten tokens:

- 199 of 200 warnings in the first window broke at `tools.N`, on both Anthropic and OpenAI.
- Every one was `segment_changed` with a **growing** segment count (33 to 45, 31 to 65). Tools are
  appended, never reordered: the registry keeps insertion order.

| Cause                    | Busts | Rewritten | What was appended                                              |
| :----------------------- | ----: | --------: | :------------------------------------------------------------- |
| Session start, first 30s |   169 |     1.94M | MCP servers connect ~0.2s after turn one, VS Code ~0.9s        |
| Mid-session              |    34 |     1.40M | `ToolSearch select:FetchUrl[,WebSearch]` loads a deferred tool |

The providers differ. Anthropic omits unloaded deferred tools from the array, so an MCP connect only
busts Opus when a non-deferred tool arrives (the two VS Code tools). OpenAI keeps deferred tools in
the array with `defer_loading`, so any MCP connect busts GPT.

## The fixes

Proven on a patched copy with a subagent started from a VS Code folder: turn two read the whole
prefix, zero busts.

- `blockOnMcpLoad: true` at the root of `~/.factory/settings.json`. The JSON-RPC worker then logs
  `[JsonRpc] Gating agent turn on MCP readiness` (60s cap, `FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS`).
  Plain `droid exec` blocks in `mcp_init` instead, with the same effect.
- `gate-first-turn-on-ide-connect`: the gate also waits for the VS Code connection (5s cap). The
  stock gate waits for MCP only.
- `web-fetch-always-loaded` and `web-search-always-loaded`: these two tools are no longer deferred.
  They cost 296 and 422 tokens per request, against a median 15k-token bust.

The gate's cap matters. A shorter cap lets a slow MCP server join on turn two, so the 15s cap patch
was dropped ([first-message.md](first-message.md)).

## Still open

- `MidConversationToolChanges` never applies to custom (DroidProxy) models, so any other deferred
  tool loaded mid-session still busts.
- These Droid events are suspected busts and were never measured one by one: a skill activating
  (depends on where its text lands), compaction (now reads the cache, see
  [cache-patches.md](cache-patches.md)), a pasted image, a fork, a spec-mode toggle. Reopened
  sessions are measured in [cache-reopens.md](cache-reopens.md). `probe busts` can split by event
  once the log carries prefix identity.
- An effort change mid-conversation does not bust on Claude. `probe effort-switch <binary> --yes`
  presses Tab in a real session and reads the cache numbers Droid logs. On Droid 0.242.0,
  `sonnet-5-5` through DroidProxy, High to Medium (the transcript confirms the reply ran at
  `medium`): the turn after the switch read 25,001 of 25,001 cached tokens and wrote 23, with no
  not-append-only warning. One run, one model, one direction; Opus and thinking off are not
  measured.
- An effort change mid-conversation busts on GPT, in stock Droid too. On Droid 0.247.0, `gpt-6-luna`
  through DroidProxy, High to Medium: stock's control turn read 11,904 and the switched turn read 0,
  3 of 3 runs. Patched, the control read 14,336 and the switched turn 7,680 or 0, 5 of 5 runs; the
  7,680 is the system and tools prefix the shared cache key keeps warm, so the conversation is lost
  every time. Droid logged no not-append-only warning: OpenAI busts on a changed request-level
  `reasoning.effort` by default. On GPT-6 an appended `configuration_update` input item changes
  effort and keeps the prefix (https://developers.openai.com/api/docs/guides/prompt-caching); Droid
  does not send one. The check judges GPT against what the control turn read, because Droid logs 0
  cache writes for GPT ([openai-cache.md](openai-cache.md)).
- The 57.4M of ordinary incremental writes are new tails, not waste.
