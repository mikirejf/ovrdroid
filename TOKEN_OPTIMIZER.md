# Token optimizer: mining past sessions for cache patterns

## Settled: what is known and what to do (2026-09-19)

Read this first. Everything below it is the record of how these rules were reached, including the
plans that were wrong and the retractions that corrected them.

The account is a Claude Max subscription through DroidProxy, so the unit is the 5 hour meter, not
API dollars. Measured on that meter, `probe quota`, ABAB over 700 sends on Opus 5:

- **A cache write costs 1.25x plain input.** 1h and 5m writes cost the same (1.2% apart, t=0.60).
  The API's 1.6x premium for 1h does not exist on this plan.
- **A cache read is near free.** Under 1/9 of a write, under 1/71 of plain input, one-sided bound;
  200 sends and 7.11M read tokens never moved the meter.
- **DroidProxy forces every `ttl` to 1h.** A client-sent 5m is rewritten. Since 1h is free here,
  that is the right setting and there is nothing to optimise about TTL. Zero TTL expiries were seen
  in a four day window.

So the only lever is **writes**. Over four days (2,539 Claude requests, 84 sessions) 17.3M tokens
were written. Where they came from and what was done:

| source                          | share | status                                                           |
| :------------------------------ | ----: | :--------------------------------------------------------------- |
| tool results (Read, Grep, Exec) |  ~43% | behaviour, not mechanics: read fewer lines, `head_limit`, `tail` |
| per-session fixed context       |  ~25% | 7.7k tokens per session: skills list 3.1k, AGENTS.md pair 3.1k   |
| cache busts (tools array grew)  |  ~19% | **closed**: see "Busts closed" at the end                        |
| compaction, model switch, other |  ~13% | model switch is a new cache by definition; rewind keeps it       |

What is in place:

- `blockOnMcpLoad: true` at the **root** of `~/.factory/settings.json` (a `general` wrapper is
  silently ignored). Patch `mcp-gate-timeout-15s` caps the wait (measured MCP loads: median 0.4s,
  worst 12.2s). Patch `gate-first-turn-on-ide-connect` also waits for VS Code (up to 5s).
- Patches `web-fetch-always-loaded` and `web-search-always-loaded`, so `ToolSearch` never grows the
  tools array mid-session. Cost 700 tokens per request against a median 15k bust.
- `cache-usage-log` writes one line per request to `~/.factory/ovrdroid/cache-usage.jsonl`;
  `probe busts` joins the miss warnings to it and reports loss per cause.
- Patch `custom-openai-shared-cache-key` gives every custom OpenAI model one `prompt_cache_key`
  instead of the session id, so a new GPT session or subagent reads the ~10.7k prefix an earlier one
  wrote instead of sending it uncached. `probe cachekey` measures it; see FINDINGS.md.
- `disabledSkills` in `settings.json` hides built-in skills the model never invokes; the skills list
  is rebuilt per session, so every name removed saves its description on every first turn.

What is not worth doing: TTL predictors, 5m-vs-1h policies, promotion timers. All rest on the API
premium that the meter does not charge.

A plan for turning every past Droid session on disk into a table, then letting scripts find the
situations where a 1 hour prompt cache would have beaten the 5 minute default. No hand analysis. The
scripts produce the findings; the findings pick the rule; the rule becomes a patch.

Two questions, in this order:

1. **What kills the cache, exactly.** Time is one killer. Content changes are another. Until both
   are pinned down, no pattern in the timing data can be trusted.
2. **Which situations predict a long pause.** Tool calls, skills, subagent fan-out, reply length,
   time of day. Which of them mark a request whose cache entry will sit idle for more than 5 minutes
   and then be needed again.

## The rule: nothing is assumed, everything is measured

Every claim in this document is one of three things:

- **Documented**: Anthropic or Droid says so. Still not trusted until a probe in this repo has
  reproduced it against the real proxy, because DroidProxy sits between Droid and Anthropic and may
  strip, rewrite or ignore anything.
- **Measured**: a `probe` command in `src/probe/` produced the number, and the number is in
  `FINDINGS.md` with the command that made it and the date.
- **Open**: nobody has measured it yet. An open claim is never an input to another number.

The ledger at the end of this document lists every claim with its status. The plan is done when the
ledger has no open rows and every documented row has a measured row backing it.

Every measurement is a tool in this repo, not a scratch script. A live probe against the API is a
`probe` subcommand with the endpoint, model, wait times and prompt size as arguments. A transcript
walk is a `probe` subcommand with the sessions directory as an argument. The reading half of each is
pure and tested from fixtures, per `AGENTS.md`. When a Droid release changes a field name, the
fixture breaks first and says so.

## The economics

Anthropic prices prompt cache as multiples of the base input price. Read from the pricing table on
the prompt caching page. **Documented, not measured.** `probe ttl` (below) confirms each multiple by
reading real `usage` fields back through DroidProxy before any dollar figure is trusted.

| operation      | multiple of input price           |
| -------------- | --------------------------------- |
| 5 minute write | 1.25x                             |
| 1 hour write   | 2.0x                              |
| read, any TTL  | 0.1x, but **0.025x** on Fable 5.1 |
| miss, re-send  | 1.0x plus a fresh write           |

Choosing 1 hour costs `0.75x` extra at write time. It saves `1.15x` (or `1.225x` on Fable 5.1) each
time a pause longer than 5 minutes would otherwise force a rewrite.

Breakeven is **0.65 rescues per cache write** (0.61 on Fable 5.1). The read multiple is per model
and must come from the price table, never a hardcoded 0.1.

Three rules from Anthropic's documentation that the replay depends on. Each is documented today and
each gets its own live measurement in `probe ttl` before the replay uses it:

- **A read refreshes the TTL** at no cost. One write can rescue many pauses.
- **The clock starts at the request start**, not at the end of the response. A 4 minute reply leaves
  1 minute of cache life. Long replies are themselves a cause of misses.
- **1 hour blocks must come before 5 minute blocks** in the same request. Mixed TTLs are allowed, up
  to 4 breakpoints, and billing splits into read tokens, 1 hour write tokens and 5 minute write
  tokens by position.

## `probe ttl`: the live measurement tool

One command that talks to the real endpoint the way Droid does and reads `usage` back. It is the
only way to turn a documented claim into a measured one, and it lives in `src/probe/ttl.ts` with a
pure reader that turns a list of `usage` objects into a verdict.

Arguments: endpoint, model, prompt size in tokens, a schedule of steps. A step is "send", "wait N
seconds", or "send with ttl 1h". Output: one line per send with `cache_read`, `cache_creation` and
the `ephemeral_5m` and `ephemeral_1h` split, then the verdict the schedule was built to answer.

Schedules it ships with, each answering one ledger row:

| schedule      | steps                                                             | answers                                                     |
| ------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `cliff`       | send, wait N, send, for N in 3 to 12 minutes                      | where the 5 minute cache actually expires through the proxy |
| `refresh`     | send, wait 4m, send, wait 4m, send, wait 4m, send                 | whether a read extends the TTL                              |
| `clock-start` | send a prompt that takes minutes to answer, wait 4m, send         | whether the clock starts at request start                   |
| `one-hour`    | send with 1h, wait 20m, send                                      | whether `ttl:"1h"` survives the proxy at all                |
| `promote`     | send, wait 3m, re-send with 1h and no tools, wait 20m, send       | whether a 1h re-send of a cached prefix extends the TTL     |
| `mixed`       | send with 1h on the head and 5m on the tail, wait 20m, send       | whether mixed TTLs work and how the write is split          |
| `price`       | one send per kind, compare `usage` with the per-model price table | that the multiples are what the table says                  |

Each run costs real tokens. The command prints the cost estimate before it starts and takes `--yes`.
Results go into `FINDINGS.md` with the model, endpoint, date and the exact command.

Any schedule that turns on the 5 minute TTL needs `--direct`, which swaps the proxy for
`api.anthropic.com` and the OAuth token. DroidProxy rewrites every `ttl` to 1h, so a 5 minute
schedule sent through it silently measures the 1 hour cache and every gap under an hour reads.
`--direct` also makes `--model` an API model id (`claude-opus-5`) instead of a `customModels` entry,
and prepends the Claude Code system block the OAuth endpoint requires, uncached and ahead of the
cached prefix so the thing being measured is unchanged.

## What a first look showed

600 recent sessions, 13,097 assistant-to-assistant gaps.

| gap       | share |
| --------- | ----- |
| under 1m  | 93.4% |
| 1m to 5m  | 5.2%  |
| 5m to 60m | 1.36% |
| over 1h   | 0.02% |

This number is per request, not per cache write, and it counts every step of a tool loop as a gap.
So it understates the case for 1 hour, and it is not yet a fair comparison against the 0.65
breakeven. It is enough to say "always 1 hour" is not the answer and that the answer, if one exists,
is situational.

Tool waits from the same sample:

| tool       | n     | median | p90   | over 5m |
| ---------- | ----- | ------ | ----- | ------- |
| TaskOutput | 184   | 113s   | 10.4m | 33%     |
| Task       | 246   | 2.4s   | 8.9m  | 17%     |
| AskUser    | 40    | 67s    | 4.3m  | 8%      |
| Execute    | 6,302 | 0.2s   | 14s   | 0.5%    |

One in three subagent waits crosses 5 minutes. That is the lead.

## What Droid already ships

The binary ships a **prompt cache promotion** feature (hooks listed under "Where the code lives").
After each turn, a 4.5 minute timer arms. If the user has not replied by then, Droid re-sends the
last prompt with every `cache_control` swapped to `ttl:"1h"`, no tools, no retry. It is gated off
for terminal users and on behind a feature flag in the IDE.

This is a real policy and the comparison must include it as `promote-at-4.5m`. It pays nothing on
fast replies, so it beats most guessed rules by construction. Two unknowns about it are on the
investigation list below.

## Data on disk

Checked on 2026-09-18.

| source                                  | what it gives                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.factory/sessions/*/*.jsonl`         | 3.2 GB, 14,531 files in 515 project folders. Messages with `timestamp`, `modelId`, `reasoningEffort`, tool calls, tool results, thinking.     |
| `~/.factory/sessions/*/*.settings.json` | One per session. `tokenUsage`, `inclusiveTokenUsage`, `childInclusiveTokenUsageBySessionId`, `lastCallTokenUsage`, `model`.                   |
| `~/.factory/sessions-index.json`        | 9,773 entries, `createdAt`, `mtime`, `messagesCount`, `cwd`. Fewer than the file count: subagent and fork sessions are files without entries. |
| `~/.factory/logs/droid-log-single.log*` | Per-request `cachedTokensWritten`, `cacheReadInputTokens`, `cacheStatus`, `prompt_cache_miss_detected`. Rotates daily, kept about 3 days.     |
| `https://models.dev/api.json`           | Per-model prices. Cached under `~/.cache/ovrdroid/` like Bun and React.                                                                       |

Transcript shapes that the extractor keys on:

- `session_start` carries `callingSessionId` and `callingToolUseId` for a subagent, `parent` and
  `forkedAtMessageId` for a fork. That is the lineage.
- A `Task` tool result contains `task_id: <uuid>`, the child session id. Both directions link.
- `compaction_state` lines with `summaryText` mark a context rebuild.
- `Skill` tool calls carry `input.skill`, the skill name.
- `ToolSearch` calls load deferred tool schemas.
- Assistant messages carry `modelId` and `reasoningEffort` per message, not per session.
- Thinking blocks carry `durationMs`.

What is missing:

- **Per-request token usage is never written.** `settings.json` holds session sums only. The logs
  hold per-request truth, but only for 3 days. the single hook (`commitTurnTokenUsage`) where a
  `cache-usage-log` patch can write one line per request. Land that patch first so ground truth
  accumulates while the rest is built.
- **No TTL choice is recorded.** `ephemeral_5m_input_tokens` strings do appear in transcripts, but
  only as pasted API output inside messages, never as Droid's own record.
- **Dollars.** Sessions hold token counts. `factoryCredits` is a separate unit. Dollars come from
  joining counts to models.dev on a mapped model id, and an unmapped id fails loudly.

Copy the logs today. They are the only per-request ground truth until the patch lands.

## Where the code lives

This repo, as `probe` subcommands, following `probe idle` and `probe watch`: a pure `*.ts` module, a
`*-report.ts` driver, a registration in `src/probe/probe.ts` with a one-line question it answers,
tests in `src/probe/__tests__/` built from hand-written fixtures. The extractor is the only part
that touches disk or network. Everything downstream reads its table.

Inside Droid, the hooks the patches hang on. Identifiers are minified and change every release;
re-derive them with `probe grep` on the quoted literals.

- `commitTurnTokenUsage(e,t)` on the session state manager: one call per finished LLM request, has
  the model and `this.currentSessionId`, never called for an aborted request. Per-request usage is
  otherwise never written to disk; the `.jsonl` transcript and the hook events carry none.
- Anthropic's `message_start` carries `cache_read_input_tokens` and `cache_creation_input_tokens`;
  the stream reducer copies them into `{cacheCreationInputTokens,cacheReadInputTokens,...}`.
- Droid's own prompt cache promotion (`general.enableOneHourAnthropicCaching`, 4.5 minute timer,
  re-send with `ttl:"1h"` and no tools) is gated on a Factory feature flag and is irrelevant here:
  the proxy already forces 1h.
- The miss detector logs `prompt_cache_miss_detected` with `mismatchRegion`, segment labels and
  hashes; `probe busts` reads those.
- `awaitMcpReadinessBeforeAgentTurnIfEnabled` in the JSON-RPC worker is the first-turn gate; the
  timeout default sits next to `FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS`. Plain `droid exec` does not
  pass through it and blocks in `mcp_init` instead.
- `turn-clock-*` in `src/patch/patches.ts` already tracks per-session `sent`/`done` timestamps and
  renders in the footer; a cache countdown would be one more part in `TURN_CLOCK_PARTS`.

## Part 1: what kills the cache

This comes first because every timing finding depends on it. A miss that was caused by a content
change looks identical to a miss caused by time unless the reason is known.

### What the documentation says

From Anthropic's invalidation table:

| change                              | what dies                  |
| ----------------------------------- | -------------------------- |
| tool definitions change             | everything                 |
| system prompt change                | system and messages        |
| `tool_choice` change                | messages                   |
| image added or removed              | messages                   |
| thinking or effort setting change   | messages, often all        |
| model change                        | everything, separate cache |
| content edit anywhere in the prefix | that point onward          |

Thinking blocks are preserved by default on Opus 4.5+ and Sonnet 4.6+, so a user message after a
thinking turn does not invalidate.

### What Droid does that may map onto those

Each of these is a hypothesis with a mechanical test. The test is the same in every case: find the
event in the transcript, then look at the log's `cachedTokensWritten` for the request right after
it. A write the size of the whole prompt means everything died. A write the size of the tail means
nothing died.

| event in Droid                        | suspected effect                                               | how to find it in the transcript                  |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| `ToolSearch` loads a deferred tool    | tools array changes, everything dies                           | `tool_use` named `ToolSearch`                     |
| `Skill` activates                     | depends where the skill text lands: system prompt or a message | `tool_use` named `Skill`, `input.skill`           |
| `compaction_state`                    | prefix rebuilt, everything dies                                | line type                                         |
| `reasoningEffort` changes mid-session | messages die, maybe all                                        | field differs between adjacent assistant messages |
| `modelId` changes mid-session         | new cache, nothing carries over                                | field differs                                     |
| image pasted                          | messages die                                                   | `image` content block                             |
| MCP server connects or drops          | tools array changes, everything dies                           | tool names appear or vanish between requests      |
| session resume                        | new process, same prefix; should hit if within TTL             | `session_start` after a gap in the same file      |
| fork                                  | separate session, shares prefix up to the fork point           | `parent`, `forkedAtMessageId`                     |
| spec mode toggle                      | cancels promotion in the binary; may edit system prompt        | `interactionMode` field changes                   |

### The subagent question, answered mechanically

The question: the main agent calls `Task`, the subagent runs 12 minutes, the result comes back. Is
the main agent's cache dead?

The documented model, which is the hypothesis and nothing more until measured:

- A subagent is a separate session with its own prefix and its own cache entry. It never touches the
  parent's entry.
- The parent's entry is keyed on the parent's prefix, which ends at the parent's last breakpoint.
  The subagent's result is appended **after** that point. Content-wise, the parent's prefix is
  untouched.
- But time: the parent made no request during those 12 minutes. Nothing refreshed the entry. Under a
  5 minute TTL it expired at minute 5. The parent's next request rewrites the whole prefix.
- So the result would not bust the cache. The wait would. And it is exactly the wait a 1 hour TTL
  covers.
- Parallel fan-out would be worse for 5 minutes and better for 1 hour: five subagents, one parent
  prefix, one idle window as long as the slowest child. One 1 hour write buys all of it.
- `TaskOutput` with `block: true` is the same shape: the parent is idle until the child is done.

Things that could make the model wrong, each of which the measurement has to be able to see:

- Droid may rebuild or reorder the parent's prefix when a child returns, for example by inserting
  the child's report as a system-side block, or by refreshing the tool list.
- Droid may send a request on the parent's behalf while the child runs, which would keep the cache
  warm by accident. The heartbeat, title generation and the promotion timer are candidates.
- The child's own requests might share a cache entry with the parent if they share a prefix and the
  proxy keys on organisation rather than session. The documentation says caches are per workspace,
  which would make that possible.

Three measurements, all in this repo:

- **From history, `probe busts --event task`.** For every parent request that follows a `Task`
  result, the log's `cachedTokensWritten` against the parent's prefix size, split by wait under 5
  minutes and over 5 minutes. Full rewrite over and tail-only under means the model holds. Full
  rewrites under 5 minutes means content is changing and the diff of the two prompts says what.
- **Live, `probe delegate`.** Drives a real Droid through `src/probe/launch.ts` with the
  `cache-usage-log` patch applied: one turn, then a `Task` to a subagent told to sleep N minutes and
  return, then one more turn. Reads the usage log for the parent's write size on the last turn. Runs
  for N in 2, 4, 6, 10, and with 1, 2 and 4 parallel children. Also runs with the built-in promotion
  setting on, to measure whether it fires during a `Task` wait at all.
- **Live, `probe ttl promote`.** The narrow API question underneath: does a 1 hour re-send of a
  fully cached prefix extend the TTL. Anthropic bills 1 hour tokens as `B - A`, where `A` is the
  highest cache hit. If the whole prefix hits, the 1 hour write is zero tokens, and nothing says
  whether a zero-token write refreshes anything.

The promotion gate in the binary is read as part of `probe delegate`, not trusted from an earlier
bundle read: the command dumps the bundle and prints the arming sites it finds, so a Droid release
that moves them shows up in the output.

### Output of Part 1

`probe busts`. For each event type above: how often it happens, how much of the prompt it killed,
and what that cost in dollars. Plus one line per event type saying "kills everything", "kills the
tail", or "harmless", with the count behind it. This is a finding on its own even if no TTL ever
changes: an avoidable full rewrite from a tool list change is money whatever the TTL.

## Part 2: the request table

`probe sessions`. Walks every transcript once and writes one SQLite table, one row per API request.
A request happened before each assistant message. Its context is everything above it.

| column                | source                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `session_id`          | file name                                                                                         |
| `calling_session_id`  | `session_start.callingSessionId`, null for a root session                                         |
| `fork_parent`         | `session_start.parent`                                                                            |
| `project`             | folder name                                                                                       |
| `request_index`       | position within the session                                                                       |
| `request_started_at`  | timestamp of the user or tool-result message that triggered it. This is when the TTL clock starts |
| `response_ended_at`   | timestamp of the assistant message it produced                                                    |
| `model`               | `modelId` on that assistant message                                                               |
| `reasoning_effort`    | on that assistant message                                                                         |
| `prefix_tokens`       | everything above the last breakpoint, estimated                                                   |
| `tail_tokens`         | appended since the previous request, estimated                                                    |
| `output_tokens`       | the assistant message, estimated; `thinking` `durationMs` summed alongside                        |
| `response_seconds`    | `response_ended_at - request_started_at`, the part of the TTL the reply itself consumed           |
| `tools_called`        | names of tool_use blocks in the assistant message                                                 |
| `pending_tool`        | the tool whose result the next request waits for                                                  |
| `skills_active`       | every `Skill` name loaded earlier in the session                                                  |
| `tools_loaded`        | count of `ToolSearch` loads so far, so a tools array change is visible                            |
| `subagents_in_flight` | `Task` calls started and not yet returned, from the `task_id` links                               |
| `bust_reason`         | from Part 1: `compaction`, `tool_list`, `effort`, `model`, `image`, `skill`, or null              |
| `gap_to_next_seconds` | next `request_started_at` minus this `request_started_at`. The number the TTL is compared against |
| `hour_of_day`         | local                                                                                             |
| `concurrent_sessions` | other sessions with a request inside this gap                                                     |

Token estimates start at `characters / 3.5`. `lastCallTokenUsage` in `settings.json` gives one real
prompt size per session to anchor against, and the log gives hundreds of real sizes for the last 3
days. The estimate gets tuned until both agree, and the tuning factor is reported, not hidden.

Subagent sessions get their own rows and their own cache lifetime. They never share a prefix with
the parent.

## Part 3: pattern discovery

`probe stalls`. Pure. Reads the table, no files, no network.

The target for each row is: **did this request's cache entry sit idle for more than 5 minutes and
then get used again before an hour passed.** Call that a rescue candidate. It already accounts for
reads refreshing the TTL, so it is per cache entry, not per request.

The features are the columns above. For each feature value, the script reports:

- how many requests carry it
- what share of them are rescue candidates
- the prefix tokens at stake, summed, and in dollars at the per-model price
- the same for the negatives: how often the feature fires and the next request comes back inside 5
  minutes, because that is the cost side of a 1 hour rule

Then the combinations that matter most, found by the script rather than guessed:

- `pending_tool` alone, and `pending_tool` by `subagents_in_flight` count
- `skills_active` containing each skill, especially the ones that drive a browser or a long loop
- `response_seconds` bucketed, because a long reply eats the TTL
- `output_tokens` bucketed, same reason in a different coat
- `tools_called` containing `AskUser`, or a permission prompt
- `hour_of_day`
- `concurrent_sessions`
- `prefix_tokens` bucketed, because a rescue on a 200k prefix is worth 40 rescues on a 5k prefix
- session length so far, because early turns are cheap and late turns are not

Output: one ranked table. Feature, share of rescue candidates, share of false alarms, dollars
rescued if 1 hour had been used, dollars lost on the false alarms, net. Sorted by net.

Then the concentration view: per session, sorted by net. If a few orchestrator sessions hold most of
the money, the rule is small and targeted. If it is spread thin, the rule is general or there is no
rule.

## Part 4: replay

`probe cache`. Pure. A request list, a policy, a price table in; token counts and dollars out, as a
breakdown per policy, not one number.

| figure                       | unit    |
| ---------------------------- | ------- |
| cache write tokens, 5 minute | tokens  |
| cache write tokens, 1 hour   | tokens  |
| cache read tokens            | tokens  |
| uncached input tokens        | tokens  |
| output tokens                | tokens  |
| cost of each of the above    | dollars |
| total                        | dollars |
| delta against `always-5m`    | dollars |

Baselines:

- `always-5m`: what happened. Must reproduce the `settings.json` sums within the tuning error or the
  extractor is wrong and nothing else counts.
- `always-1h`: the naive alternative.
- `promote-at-4.5m`: what Droid ships. Modelled as: on any gap over 4.5 minutes, one 2x write of the
  whole prefix, then no miss until the hour.
- `oracle`: knows the future. The ceiling. Headroom is oracle minus `always-5m`. Under 5%, stop.
  Over 20%, the rule is worth building.

Candidate rules come **out of Part 3**, not from a list written here in advance. Each one is a
predicate on the row's columns, sees only the past, and is replayed the same way. `split-ttl`, 1
hour on the stable head and 5 minutes on the tail, is the one structural candidate that needs no
prediction and is allowed by the mixed-TTL rule, so it is always in the set.

Validate by holding out the last 30 days, fitting on the rest, and replaying.

## Part 5: what history cost

Needs no simulation. `tokenUsage` sums joined to prices: total dollars by model, by project, by
session, sorted. This is the "where does the money go" report and it stands alone.

## The tools, all in `src/probe/`

| command           | drives                                | reads                                                      | answers                                                    |
| ----------------- | ------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `probe ttl`       | the API through DroidProxy            | `usage` objects                                            | every documented cache rule, one schedule each             |
| `probe delegate`  | a real Droid with a sleeping subagent | the usage log                                              | what a `Task` wait does to the parent's cache              |
| `probe logs`      | nothing; copies `~/.factory/logs/*`   | log lines with cache fields                                | per-request ground truth, kept out of rotation             |
| `probe sessions`  | the transcript walk                   | `.jsonl`, `.settings.json`, the index                      | the request table                                          |
| `probe calibrate` | nothing                               | the request table against `settings.json` sums and the log | whether the token estimate can be trusted, and by how much |
| `probe busts`     | nothing                               | the request table and the log                              | what kills the cache, how often, at what cost              |
| `probe stalls`    | nothing                               | the request table                                          | which situations predict a rescue, ranked by net dollars   |
| `probe cache`     | nothing                               | the request table and the price table                      | what each policy would have cost                           |
| `probe spend`     | nothing                               | `settings.json` and the price table                        | where the money went                                       |
| `probe prices`    | models.dev, cached                    | `api.json`                                                 | the per-model price table, with the id map                 |

Each command has a pure module, a report module, a registration in `src/probe/probe.ts` with the
question it answers, and fixtures in `src/probe/__tests__/`. The live ones print their cost and take
`--yes`. All of them take their paths and endpoints as arguments with defaults, so the next Droid
release or the next machine changes a flag, not the code.

## Order of work

1. `cache-usage-log` patch, so per-request truth starts accumulating. One line per request from
   `commitTurnTokenUsage`, append only, never throws.
2. `probe logs`, run today, before rotation eats the only ground truth there is.
3. `probe prices` and `probe ttl price`, so every dollar downstream rests on a measured multiple.
4. `probe ttl` for the remaining schedules. Cheap, and they decide whether the replay rules are
   right before anything is built on them.
5. `probe sessions` and `probe calibrate`. No other number is reported until calibration passes.
6. `probe busts` and `probe delegate`, Part 1.
7. `probe stalls`, Part 3.
8. `probe cache`, Part 4, with the baselines and the rules Part 3 produced.
9. The patch that applies the winning rule, if the headroom says there is one.

## The ledger

Every claim this plan rests on. Status is `documented`, `measured` or `open`. A row moves to
`measured` only when a command in this repo has produced the number and `FINDINGS.md` records the
run. Nothing downstream may read from an `open` row.

| claim                                                             | status                   | measured by                                  |
| ----------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| 5 minute write is 1.25x input                                     | documented               | `probe ttl price`                            |
| 1 hour write is 2.0x input                                        | documented               | `probe ttl price`                            |
| read is 0.1x, 0.025x on Fable 5.1                                 | documented               | `probe ttl price`                            |
| the 5 minute cache expires at 5 minutes through DroidProxy        | open                     | `probe ttl cliff`                            |
| a read refreshes the TTL                                          | documented               | `probe ttl refresh`                          |
| the TTL clock starts at request start                             | **measured**: 2026-09-19 | `probe ttl clock-start --direct`             |
| `ttl:"1h"` survives DroidProxy                                    | open                     | `probe ttl one-hour`                         |
| a 1 hour re-send of a fully cached prefix extends the TTL         | open                     | `probe ttl promote`                          |
| mixed TTLs work, 1 hour before 5 minute, billed by position       | documented               | `probe ttl mixed`                            |
| a subagent result does not change the parent's prefix             | open                     | `probe busts --event task`, `probe delegate` |
| a subagent wait over 5 minutes forces a full parent rewrite       | open                     | `probe delegate`                             |
| nothing sends on the parent's behalf during a `Task` wait         | open                     | `probe delegate`                             |
| the built-in promotion fires during a `Task` wait                 | open                     | `probe delegate --promotion`                 |
| the built-in promotion arms on turn end, permission, AskUser only | documented (bundle read) | `probe delegate`, bundle dump                |
| `ToolSearch` invalidates the whole cache                          | open                     | `probe busts --event toolsearch`             |
| `Skill` activation lands in a message, not the system prompt      | open                     | `probe busts --event skill`                  |
| compaction invalidates the whole cache                            | open                     | `probe busts --event compaction`             |
| an effort change invalidates the message cache                    | documented               | `probe busts --event effort`                 |
| a model change starts a new cache                                 | documented               | `probe busts --event model`                  |
| an image invalidates the message cache                            | documented               | `probe busts --event image`                  |
| an MCP connect or drop invalidates the whole cache                | open                     | `probe busts --event tools`                  |
| session resume within the TTL hits the cache                      | open                     | `probe busts --event resume`                 |
| a fork shares the parent's cache up to the fork point             | open                     | `probe busts --event fork`                   |
| `characters / 3.5` estimates tokens within X%                     | open                     | `probe calibrate`, which reports X           |
| `always-5m` replay reproduces `settings.json` sums within X%      | open                     | `probe calibrate`                            |
| `factoryCredits` tracks dollars at a constant ratio               | open                     | `probe spend --credits`                      |
| Droid's model ids map onto models.dev ids                         | open                     | `probe prices`, fails on an unmapped id      |
| subagent sessions are files without index entries                 | open                     | `probe sessions`, reports the count          |
| the logs rotate daily and keep about 3 days                       | open                     | `probe logs`, reports what it found          |

## Findings

Everything below was measured after the plan above was written. Two of the plan's starting
assumptions turned out to be wrong, and both retractions are kept in full, because the way each one
went wrong is the reusable part.

Sources for every documented claim in this section:

- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [TTL support](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#ttl-support)
- [1 hour cache duration](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#1-hour-cache-duration)
- [Pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing)
- [What invalidates the cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI model differences](https://developers.openai.com/api/docs/guides/prompt-caching#summary-of-model-differences)

### Retraction: "no 5 minute cache to optimise" had the arrow backwards

`probe ttl` measured that DroidProxy rewrites every cache write to `ttl:"1h"`. The reading taken
from that was "there is no 5 minute cache here, so there is nothing to tune". That is the wrong way
round. The proxy is not giving a 1 hour cache away. It is **buying** one, at 2x instead of 1.25x, on
every single write, whether or not anything will ever read it back.

The question is not "can we reach 1 hour". It is "should we ever pay for it". Measured against nine
months of real traffic, the answer is almost never.

#### Who decides the TTL

Traced in `router-for-me/CLIProxyAPI`, the Go backend bundled inside `anand-92/droidproxy`.

| gate               | file                               | effect                                         |
| :----------------- | :--------------------------------- | :--------------------------------------------- |
| upgrade to 1h      | `claude_executor_execute.go:236`   | `upgradeClaudeCacheControlTTL(body, "1h")`     |
| same on the stream | `claude_executor_stream.go:237`    | identical call                                 |
| who qualifies      | `claude_fingerprint_policy.go:101` | `authIsOAuth \|\| profile == claude-code-cli`  |
| the skip           | `claude_executor_cloaking.go:1548` | blocks that already carry `ttl` are left alone |
| ordering fixup     | `normalizeCacheControlTTL`         | deletes a 1h `ttl` sitting behind a 5m block   |
| knocked back to 5m | `stripClaudeCacheControlTTL`       | subagent and probe or helper requests          |

The full condition is
`cpaOwnsCacheControl && ProfileClaudeCodeCLI && (!isSubagent || subagent1h) && !isProbeOrHelper`.
Credentials in `~/.cli-proxy-api/` are OAuth, so this machine always qualifies.

**The escape hatch is the skip.** `upgradeClaudeCacheControlTTL` walks every `cache_control` block
and leaves alone any block where `ttl` already exists. A client that sends `ttl:"5m"` itself keeps
5m. Nothing has to change in the proxy. Ledger row: `ttl:"1h"` survives the proxy, and so does
`ttl:"5m"`. **Measured.**

#### Five mechanics, corrected

1. **The TTL is a sliding idle window, not a fixed lifetime.** Every read refreshes it, for free. A
   session that talks every 30 seconds holds the same entry all day on a 5 minute TTL. This is the
   single fact that decides the whole question, and the first pass got it wrong. **Measured
   2026-09-19**, not just documented: a 5 minute entry survived three 4 minute gaps, living 12
   minutes, then missed on a 6 minute one. `FINDINGS.md`, "a sliding idle window".
2. **The clock starts at request start**, not at the end of the response. A four minute reply eats
   four minutes of a five minute window. **Measured 2026-09-19**: a 161s answer followed by a 4
   minute gap missed, where the gap alone would have read. `FINDINGS.md`, "the clock starts at
   request start".
3. **Four breakpoints, four independent clocks.** Prefix matching means a request checks the longest
   cached prefix first and walks back, with a 20 block lookback.
4. **1 hour blocks must come before 5 minute blocks.** The proxy enforces it by deleting the
   offending `ttl`, so a badly ordered mixed request quietly loses its 1h and does not error.
5. **Pricing**: 5m write 1.25x, 1h write 2x, read 0.1x, and 0.025x on Fable 5.1. The 1h premium is
   0.75x of the whole prefix, paid on every write.

#### What nine months of traffic actually looks like

7,338 Claude sessions, 317,848 assistant turns, 2025-12-19 to 2026-09-18, 169 active days. Token
counts come from the `.settings.json` sidecar next to each transcript, the same place
`~/dev/agentusage/ingest.py` reads them from.

| gap to the next request |   turns | share |
| :---------------------- | ------: | ----: |
| under 5 minutes         | 306,121 | 98.6% |
| 5 minutes to 1 hour     |   4,076 |  1.3% |
| over 1 hour             |     313 |  0.1% |

Median gap 8.7 seconds, p90 47.6 seconds. An agent loop is a stream of fast turns, and a sliding
window never closes on it.

#### The cost of the 1 hour tax

Replay over the same nine months, sliding window, per model prices:

| policy            | input tokens | head rewrites |     dollars at list |
| :---------------- | -----------: | ------------: | ------------------: |
| always 1h (today) |       7.214B |         7,651 |             $34,928 |
| always 5m         |       5.727B |        11,727 |             $27,396 |
| **difference**    |   **-20.6%** |    **+4,076** | **-$7,531 (21.6%)** |

About **$837 a month**. Dropping to 5m costs 4,076 extra full rewrites over nine months, which is
the 1.3% row in the gap table, and those rewrites are far cheaper than the 0.75x premium paid on
every one of the other 306,121 turns.

Two independent datasets agree. The four day per-request log archive (10,130 Claude requests, 238
sessions, extracted by `probe logs`) gives 16.5% for always-5m and 20.4% for the split policy; the
nine month sidecar walk gives 19.3% and 20.4% on the fixed-lifetime model, 20.6% on the corrected
sliding model. Different code, different source, same answer within a fraction of a point.

#### The adaptive system is not worth building

This was the stated goal: send the right TTL per request. So the ceiling was measured first, with an
oracle that knows the future gap perfectly.

| policy          | input tokens | vs always-5m |
| :-------------- | -----------: | -----------: |
| always 5m       |       5.833B |            — |
| oracle, perfect |       5.819B |    **0.23%** |

The oracle picks 1h on 4,076 of 317,848 turns, 1.28%. A perfect predictor, which cannot exist, is
worth a quarter of one percent. A real predictor would be worse, and the base rates say how much
worse: P(gap>5m) is 1.41%, and P(gap>5m given the previous gap was >5m) is only 6.96%. The strongest
available signal moves the odds from 1 in 71 to 1 in 14. Nothing in the feature list would do
better.

**So the design that follows is: always send `ttl:"5m"` explicitly, and stop.** No model, no
prediction, no state. It captures 21.6%, which is 98.9% of what perfect foresight could capture,
with one field in the request body.

Parts 3 and 4 of the plan above (`probe stalls`, the rule search, the held-out validation) are
therefore cancelled as written. `probe cache` still earns its place as the replay that proves the
patch, but the rule it replays is a constant.

#### Two prizes bigger than anything left in the TTL

The 200 cache busts in the four day log window break down as 121 `anthropic.tools.N`, 78
`openai_responses.tools.N`, 1 other. **199 of 200 busts are the tools array**, on both providers. A
tools array change kills everything, including the system prompt and the entire message history, and
it happens every time `ToolSearch` loads a deferred schema or an MCP server connects or drops. That
is Part 1 of the plan and it is still entirely open. It is very likely worth more than the TTL.

The 20 block lookback is the second one. Whether Droid's request shape ever pushes the last
breakpoint further than 20 blocks back, and so misses a cache that is present, has not been checked.

#### Where the data lives, and three traps in it

| source                                  | span       | has tokens       | trap                                                           |
| :-------------------------------------- | :--------- | :--------------- | :------------------------------------------------------------- |
| `~/.factory/ovrdroid/cache-usage.jsonl` | from today | yes, per request | created by our own patch, so it has no history                 |
| `~/.factory/logs/droid-log-single.log*` | ~4 days    | yes, per request | rotates; copy it before it goes                                |
| `~/.factory/sessions/*/*.jsonl`         | 9 months   | **no**           | timing only; `summaryTokens` appears 23 times and is not usage |
| `~/.factory/sessions/*/*.settings.json` | 9 months   | yes, per session | this is the one; `tokenUsage` lives here                       |

Three mistakes were made reading these, in order, and each cost a full re-run:

- Measured 11 sessions from `cache-usage.jsonl` and called it the history. The file was created that
  morning by our own patch.
- Scanned `sessions/*/*.jsonl` for tokens and found none, because the glob explicitly excluded
  `*.settings.json`, which is the only file that has them.
- Modelled the TTL as a fixed lifetime instead of a sliding idle window, which made the 1.3% figure
  mean the wrong thing and understated the saving.

### Retraction: the GPT models were never failing to cache

An earlier note read "the GPT-family models write no cache at all: 2,347 requests, zero writes, 8.4M
tokens of full-price input". That is a misread field, not a finding. **OpenAI traffic is the
best-cached traffic on this machine.**

| model        | sessions | fresh input | cache write |  cache read | hit rate  |
| :----------- | -------: | ----------: | ----------: | ----------: | :-------- |
| gpt-5.6-sol  |    1,045 |  88,923,000 |      92,759 | 954,984,084 | **91.5%** |
| gpt-5.6-luna |      532 |  56,901,753 |           0 | 846,343,680 | **93.7%** |
| gpt-5.4      |       66 |  20,895,255 |   5,382,450 | 279,321,812 | **91.4%** |
| gpt-5.5      |       88 |   5,483,482 |           0 |  53,120,512 | **90.6%** |
| gpt-6-astra  |       48 |   3,426,668 |           0 |  38,159,616 | **91.8%** |

Across 1,801 GPT sessions: 2.45B input, 2.27B of it (92.5%) cache reads.

#### Why the write column reads zero

Two reasons, both correct behaviour.

**OpenAI charges no write below GPT-5.6.** The model comparison table says "no additional
cache-write charge" through GPT-5.5, and 1.25x only from GPT-5.6. No charge, no field, nothing to
report. Anthropic bills writes as a separate line, so `cache_creation_input_tokens` always exists
there.

**Droid reads only one of the two field spellings.** From `probe grep` on the 0.222.0 bundle:

```js
n.usage.cacheReadInputTokens = t.usage.prompt_tokens_details?.cached_tokens || 0;
n.usage.inputTokens = Math.max(0, (t.usage.prompt_tokens || 0) - n.usage.cacheReadInputTokens);
```

`input_tokens_details.cache_write_tokens`, which is what the Responses API returns on GPT-5.6, is
not read anywhere. The proxy handles both spellings in `helps/usage_helpers.go:828-830`, so the
number exists upstream and is dropped at the Droid end. The consequence is that the reported cost is
understated, not that the caching is broken.

#### Anthropic against OpenAI

| behaviour    | Anthropic                            | OpenAI GPT-5.6+                           |
| :----------- | :----------------------------------- | :---------------------------------------- |
| default      | off, nothing caches without a marker | **on by default**, implicit breakpoints   |
| breakpoints  | 4, all explicit                      | implicit, plus up to 4 explicit           |
| write charge | 1.25x at 5m, 2x at 1h                | 1.25x, no TTL tiers                       |
| read charge  | 0.1x                                 | 0.1x                                      |
| lifetime     | 5m or 1h, sliding, free refresh      | **30m only**, sliding, free refresh       |
| minimum      | 4,096 tokens on Opus                 | 1,024 tokens on GPT-5.6+                  |
| routing      | not exposed                          | `prompt_cache_key`, matters below GPT-5.6 |

So the TTL question does not exist on OpenAI. `prompt_cache_options.ttl: "30m"` is the only value
and it is already the default. The 21.6% Claude finding has no OpenAI equivalent.

#### How three proxies handle it

- **`earendil-works/pi`** reaches the same mapping independently: `cached_tokens` are reads, OpenAI
  emits no write field (`openai-completions.ts:1520-1536`). It sends a stable `prompt_cache_key`
  from `sessionId` with `store: false` (`openai-responses.ts:54-99`, `308-319`), uses
  `previous_response_id` with incremental input in Codex mode
  (`openai-codex-responses.ts:1434-1450`), and keeps timestamps out of serialised messages entirely
  (`openai-responses-shared.ts:217-251`), which is the most common way a prefix gets broken.
- **`automazeio/vibeproxy`** carries a hazard DroidProxy avoids: it parses, edits and re-serialises
  JSON when a request contains `cache_control` (`ThinkingProxy.swift:299-345`), which can reorder
  keys and silently kill every downstream hit. DroidProxy does surgical string edits for exactly
  this reason and says so at `ThinkingProxy.swift:4-22`.
- **CLIProxyAPI** does more for OpenAI than for Anthropic: strips `previous_response_id`,
  `prompt_cache_retention`, `safety_identifier`, `stream_options`
  (`codex_executor_execute.go:59-63`), then injects a stable `prompt_cache_key` and mirrors it into
  a `Session-Id` header (`codex_executor_request.go:117-155`). Its `identity-confuse` setting
  deliberately remaps the key per credential (`codex_executor_request.go:158-205`); it is off here
  and turning it on would cost hit rate.

**Rule: check whether a metric reads zero because the thing did not happen, or because nobody read
the field.**

### The GPT gap: what is still unproven

The 92.5% hit rate is real. The conclusion drawn from it, that OpenAI caching is as good as it gets
and there is nothing left to do, was not measured. Three specific holes.

**78 of the 200 busts in the log window are `openai_responses.tools.N`.** The tools array kills the
OpenAI cache the same way it kills the Anthropic one. A 92.5% average is fully compatible with a
handful of sessions rebuilding their whole prefix every time a deferred tool loads. To check: group
the `openai_responses.tools.N` busts by session and by preceding event, and measure the prefix size
destroyed each time. Needs per-request data, so it runs on the four day log window, not the
sidecars.

**Droid emits zero explicit breakpoints.** `probe grep` on the 0.222.0 bundle finds no
`prompt_cache_options` and no `prompt_cache_breakpoint` anywhere. `prompt_cache_key` and
`prompt_cache_retention` appear only inside an allow-list of forwarded fields. Every hit above comes
from OpenAI's implicit breakpoint, which sits at the end of the latest eligible message. The
documented gain from explicit breakpoints is better reuse when a thread **forks**, which is exactly
the subagent case. To check: count fork and subagent starts in the OpenAI sessions, and measure what
share of their first-request input was a miss that an earlier breakpoint would have caught.

**The remaining 7.5% of input has never been broken down.** It was called "mostly new turn content".
That was a guess. It could be new content, tools array busts, fork misses, or sub-1,024-token
requests that are not eligible to cache at all. Those four have different fixes and only one of them
is "nothing to do". To check: for each OpenAI request in the log window, compare fresh input against
the tail appended since the previous request. Fresh roughly equal to tail means new content. Fresh
much larger than tail means something busted, and the preceding event names it.

Until those three are measured, the honest statement is: **OpenAI caching is working well on
average, and nobody has looked at the tail.**

### Ledger updates

| claim                                                      | status                                                                       |
| :--------------------------------------------------------- | :--------------------------------------------------------------------------- |
| the 5 minute cache expires at 5 minutes through DroidProxy | **measured**: not applicable, the proxy upgrades every write to 1h           |
| `ttl:"1h"` survives DroidProxy                             | **measured**: yes, and it is also forced                                     |
| a client-sent `ttl` is left alone by the proxy             | **measured**: `claude_executor_cloaking.go:1548` skips blocks that carry one |
| a read refreshes the TTL                                   | **measured**: 5m entry lived 12m on 4m gaps, died on a 6m one, 2026-09-19    |
| mixed TTLs work, 1 hour before 5 minute                    | **measured**: the proxy deletes an out-of-order 1h rather than erroring      |
| always-5m beats always-1h on this machine's traffic        | **measured**: 21.6%, $837/month, 9 months, 7,338 sessions                    |
| a per-request TTL predictor is worth building              | **measured as no**: oracle headroom 0.23%                                    |
| GPT-family models write no cache                           | **retracted**: 92.5% hit rate, two reasons the field reads zero              |
| OpenAI TTL is selectable                                   | **measured as no**: `"30m"` only on GPT-5.6+, already the default            |
| the tools array is the dominant cache killer               | **measured**: 199 of 200 busts, both providers                               |
| the 7.5% of uncached OpenAI input is new content           | **open**: never broken down                                                  |
| explicit OpenAI breakpoints would help forks               | **open**: Droid emits none                                                   |
| the 20 block lookback contributes to busts                 | **open**                                                                     |

### Retraction: the 21.6% was priced in dollars the account never pays

Audited 2026-09-18. Three things were wrong, and one measurement settles all of them. Run records
are in `FINDINGS.md` under "the subscription meter".

- **The escape hatch was read from the wrong source.** `probe ttl` never sent an explicit `ttl:"5m"`
  (`src/probe/ttl.ts:133` drops the field), and the Go source cited is `main`, not the
  `v7.3.3+dirty` backend bundled in DroidProxy. Sent for real, an explicit `ttl:"5m"` through the
  proxy comes back as a 1h write. The 5m patch would have changed nothing.
- **The replay expired an invented head.** `/tmp/ttl_sliding.py` sets the prefix that expires to
  `cacheCreationTokens / turns`, a sliver of the real prefix. A real expiry rewrites everything. On
  a 100k prefix with one 10 minute gap the corrected sum flips the answer to 1h. Most of the 21.6%
  is the price ratio 2.0/1.25 applied to session-sum writes, not behaviour. The 0.23% oracle shares
  the same head and only decides on misses, so it is not a ceiling either.
- **The goal is subscription usage, and every figure was API list dollars.** The Anthropic
  credential is OAuth on `default_claude_max_20x`. Measured directly against the 5 hour meter on
  `claude-opus-5`, interleaved ABAB over 700 sends, a 1h write costs 777k tokens per percent and a
  5m write 786k: **1.2% apart, which is smaller than the noise on the difference (t = 0.60).** Both
  are 1.25x plain input at 967k, the API's write multiple exactly. **The API's 1.6x premium for 1h
  is rejected.** A cache read never moved the meter across 200 sends and 7.11M tokens, so it costs
  **under 1/9 of a write and under 1/71 of plain input**, a one-sided bound. Full run in
  `FINDINGS.md` under "Measured, controlled".

Corrected ledger rows:

| claim                                                 | status                                              |
| :---------------------------------------------------- | :-------------------------------------------------- |
| a client-sent `ttl` is left alone by the proxy        | **measured as false** on the bundled backend        |
| always-5m beats always-1h on this machine's traffic   | **retracted**: no large premium on the meter        |
| a per-request TTL predictor is worth building         | **retracted as unproven**: oracle was not a ceiling |
| the meter charges 1h writes 1.6x what it charges 5m   | **measured as false**: `probe quota`, 2026-09-18    |
| 1h and 5m writes cost the same on the meter           | **measured**: 1.2% apart, t=0.60, ABAB on Opus 5    |
| writes cost about 1.25x plain input on the meter      | **measured**: 1.245x and 1.230x, Opus 5, 2026-09-19 |
| a cache read costs about 1/20 of a write on the quota | **measured, stronger**: under 1/9, likely far less  |
| DroidProxy forwards rate limit headers                | **measured as no**                                  |

### What to build next

The TTL question is closed: the proxy's forced 1h is measured free on this plan and is the right
setting. What moves the meter is the write versus read ratio, so the optimiser is a **bust
optimiser**. The controlled run also sets the prize: a read is at least 9x cheaper than the write it
replaces, so every bust avoided keeps about 90% of that prefix's quota.

1. **Join busts to real loss.** For each `prompt_cache_miss_detected` warning in the four day log
   window, take the next request's `cacheCreationInputTokens` against its previous
   `cacheReadInputTokens`. That turns "199 of 200 warnings name the tools array" into quota actually
   rewritten. `probe busts`, Part 1 of the plan, unchanged.
2. **Log prefix identity per request.** Extend `cache-usage-log` with the tools array hash and the
   breakpoint positions so a full rewrite can be blamed without a transcript join.
3. **Keep `probe quota` honest.** Re-run each arm after any Anthropic pricing or plan change; the
   meter is the only truth for this account. Measure on `claude-opus-5`, the model this machine
   runs. Avoid Fable: `/api/oauth/usage` shows it carrying its own `weekly_scoped` cap that the
   unified 5h and 7d headers do not report, so `probe quota` would undercount every Fable send.
4. **Read `input_tokens_details.cache_write_tokens`** so GPT-5.6+ write cost stops being invisible.

## Busts closed: the tools array grows, it does not reorder (2026-09-19)

`probe busts` joined 203 warnings to 3.3M rewritten tokens. Every bust in the four day window is
`segment_changed` with a **growing** segment count (33 to 45, 31 to 65); none shrank or kept its
count. Tools are appended, never reordered. Registry order is insertion order with no sort, and
`probe busts` now splits them by cause:

| cause                     | busts | rewritten | what appended                                                  |
| :------------------------ | ----: | --------: | :------------------------------------------------------------- |
| session-start (first 30s) |   169 |     1.94M | MCP servers connect ~0.2s after turn one; VS Code IDE ~0.9s    |
| mid-session               |    34 |     1.40M | `ToolSearch select:FetchUrl[,WebSearch]` loads a deferred tool |

Anthropic omits unloaded deferred tools from the array, so an MCP connect only busts Opus when a
non-deferred tool arrives (the two IDE tools, `exposedToolCount` 11 to 13). OpenAI keeps deferred
tools in the array with `defer_loading`, so the MCP connect itself busts GPT (`hiddenToolCount` 4 to
33).

Fixes, all proven on a patched copy with a subagent spawned from a VS Code folder (turn two: exact
cache hit, zero busts):

- `blockOnMcpLoad: true` at the **root** of `~/.factory/settings.json`. Under a `general` wrapper it
  is silently ignored (`_k` rejects the wrapper only for runtime settings; the user file drops
  unknown keys). Set correctly, the worker logs `[JsonRpc] Gating agent turn on MCP readiness` (60s
  cap, `FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS`). Plain `droid exec` blocks in `mcp_init` instead;
  same effect.
- Patch `gate-first-turn-on-ide-connect`: the gate also awaits `ideInitPromise` (5s cap), since the
  stock gate waits for MCP only and the IDE tools are the Opus session-start bust.
- Patches `web-fetch-always-loaded` and `web-search-always-loaded`: `deferred:!0` to `!1`. Cost 296
  and 422 tokens per request against a median 15k-token bust.

Left open: `MidConversationToolChanges` never applies to custom (DroidProxy) models, so any other
deferred tool loaded mid-session still busts; and the 57.4M of ordinary incremental writes are
normal new-tail writes, not waste, and stay unmeasured as an optimisation target.
