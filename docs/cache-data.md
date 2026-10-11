# Token and cache data: where it lives and how to read it

Reference for writing a probe that reads token usage, transcripts or cache behaviour. Checked
2026-09-18.

## Sources on disk

| Source                                  | Span        | Has tokens       | Notes                                                              |
| :-------------------------------------- | :---------- | :--------------- | :----------------------------------------------------------------- |
| `~/.factory/ovrdroid/cache-usage.jsonl` | since patch | yes, per request | Written by `cache-usage-log`, so it has no older history           |
| `~/.factory/logs/droid-log-single.log*` | ~3 days     | yes, per request | Rotates. `probe logs` copies it to `~/.factory/ovrdroid/logs/`     |
| `~/.factory/sessions/*/*.jsonl`         | all history | **no**           | Timing, models, tool calls. `summaryTokens` is not usage           |
| `~/.factory/sessions/*/*.settings.json` | all history | yes, per session | `tokenUsage`, `inclusiveTokenUsage`, `lastCallTokenUsage`, `model` |
| `~/.factory/sessions-index.json`        | all history | no               | Subagent and fork sessions are files without entries               |
| `https://models.dev/api.json`           | -           | prices           | `probe prices` caches it under `~/.cache/ovrdroid/`                |

Three mistakes were made reading these, and each cost a full re-run:

1. Reading `cache-usage.jsonl` as history. It was created that morning by the patch.
2. Globbing `sessions/*/*.jsonl` for tokens. That glob skips `*.settings.json`, the only file that
   has them.
3. Modelling the TTL as a fixed lifetime. It slides with each read.

## Transcript shapes

- `session_start` carries `callingSessionId` and `callingToolUseId` for a subagent, and `parent` and
  `forkedAtMessageId` for a fork.
- A `Task` tool result contains `task_id: <uuid>`, the child session id.
- `compaction_state` lines with `summaryText` mark a context rebuild.
- `Skill` tool calls carry `input.skill`. `ToolSearch` calls load deferred tools.
- Assistant messages carry `modelId` and `reasoningEffort` per message. Thinking blocks carry
  `durationMs`.
- No TTL choice is recorded anywhere.

In the logs, `callingSessionIdPresent` is `"false"` on every line, so subagent requests cannot be
told from the parent's there.

## Where Droid's code hooks in

Minified names change every release. Find them again with `probe grep` on the quoted literals.

- `commitTurnTokenUsage` runs once per finished, non-aborted LLM request. It is the only place
  per-request usage exists.
- The stream reducer copies `cache_read_input_tokens` and `cache_creation_input_tokens` from
  `message_start`. It never reads the 5m and 1h split.
- The miss detector logs `prompt_cache_miss_detected` with `mismatchRegion`, segment labels and
  hashes. `probe busts` reads those.
- `awaitMcpReadinessBeforeAgentTurnIfEnabled` in the JSON-RPC worker is the first-turn gate.
- Droid's own cache promotion (`general.enableOneHourAnthropicCaching`, a 4.5 minute timer that
  re-sends with `ttl:"1h"` and no tools) is behind a Factory feature flag and does nothing here,
  because the proxy already forces 1h.

## `probe ttl`

Talks to the real endpoint the way Droid does and reads `usage` back. Each schedule answers one
question. Each run costs real tokens: the command prints an estimate and needs `--yes`.

| Schedule       | Steps                                                 | Answers                                        |
| :------------- | :---------------------------------------------------- | :--------------------------------------------- |
| `cliff`        | send, wait N, send                                    | where the 5m cache expires                     |
| `refresh`      | send, then three 4m gaps                              | whether a read extends the TTL                 |
| `clock-start`  | a slow answer, wait 4m, send                          | whether the clock starts at request start      |
| `one-hour`     | send with 1h, wait 20m, send                          | whether `ttl:"1h"` survives                    |
| `promote`      | send, wait 3m, re-send with 1h and no tools, wait 20m | whether a 1h re-send extends the TTL           |
| `mixed`        | 1h on the head and 5m on the tail, wait 20m           | whether mixed TTLs work                        |
| `price`        | one send per kind                                     | the price multiples                            |
| `unrelated`    | send, another prompt at 4m, the first again at 6m     | whether other traffic resets the TTL           |
| `shared-head`  | as `unrelated`, with a shared head                    | whether a shared head keeps only the head warm |
| `hour-refresh` | send with 1h, two 54m gaps                            | whether a read slides the proxy's 1h clock     |
| `hour-cliff`   | send with 1h, wait 66m, send                          | whether the proxy's 1h entry dies at 1h        |

A schedule about the 5 minute TTL needs `--direct`. It swaps the proxy for `api.anthropic.com` and
the OAuth token, because the proxy turns every write into 1h. `--direct` also makes `--model` an API
model id (`claude-opus-5`), and prepends the system block the OAuth endpoint requires, uncached and
ahead of the measured prefix. Record each result in [cache-lifetime.md](cache-lifetime.md) with the
model, endpoint, date and command.
