# Script mode: which models get the Script tool

Droid 0.245.0, 2026-10-20. Script mode is a session whose tool surface is `script_only`: the model
gets `Script` (plus `WaitForScript`, `TaskOutput`, `TaskStop`, `Task`, `ExitSpecMode`) as top-level
tools and reaches `Read`, `Grep` and the rest from inside a script. Any other model runs
`direct_only` and calls every tool itself.

## The choice is a remote list, and Sonnet is not on it

The mode comes from one function, anchored on `Ta(B3)` (`B3` is `"script_tool_models"`):

```
function dQ(t){let r=Ta(B3)?.models,o=_t(t.modelId)?At(t.modelId,C().getCustomModels()):void 0,i=o?Wl(o):void 0;if(!(r?.some((u)=>u===t.modelId||u===i)??!1))return"direct_only";return t.override??"script_only"}
```

`script_tool_models` is a remote feature flag holding a list of model ids. A session is
`script_only` only when its model id, or for a custom model the underlying id `i`, is on that list.
`override` can then change the mode, but it is never read for an unlisted model. On this account the
list has Opus and not Sonnet or Haiku, so a Sonnet session through DroidProxy ran `direct_only`.

Checked on stock with `droid exec -m custom:droidproxy:sonnet-5-5` asked to read two files in one
`Script`: the model replied that no Script tool is available and ran one `Execute` with `wc -l`.

## The patch

`script-mode-every-model` (`src/patch/tool-surface-patches.ts`) deletes the remote-list check, so
every model runs `script_only` unless `override` says otherwise. It started on 2026-10-20 as
`script-mode-sonnet`, a match on `sonnet` in the model id. Haiku joined on 2026-10-30, and the same
day every model did, once the comparisons below showed no model answering worse in script mode and
every model needing fewer requests.

Helpers follow the same rule. A new session, main or helper, gets its mode from one function
(`sv({modelId,override})` in 1.0.0) called with its own model, and helper sessions carry no
override: in the 14 days to 2026-10-30, 783 Sonnet sessions, coder helpers included, ran
`script_only` under the Sonnet match, while 560 `api-haiku-5-5` helper sessions ran `direct_only`.

Patched, the same `droid exec` call ran `Script` with two `Read` calls and answered `3` and `5`
lines. `probe tool-surface` on a `--bodies` build, now defaulting to `custom:droidproxy:sonnet-5-5`
at effort low, reads the request body of one real turn and showed `Script` and `TodoWrite` together
on the direct list. That one turn proves both this patch and `todo-write-direct`, which puts
`TodoWrite` on the direct list in `script_only` sessions. It stays bound inside `Script` too.

From Oct 22 to Oct 30 the patch also put `Read` and `Grep` on the direct list, because Opus 5.5
called them top level in `script_only` sessions and failed "Not found": 13 failures between Oct 18
and Oct 22 across long sessions. The measurements below took them off again: they bought nothing for
Opus or Sonnet, slowed Haiku, and failed more often than the calls they replaced. Arguments sent as
strings like "true" and "60" turned out to be an Opus habit, not a missing schema: it keeps doing it
with the schema sent.

## Direct Read and Grep, measured

Droid 1.0.0, 2026-10-30. Every model was put in script mode for the test by an extra patch that
skips the remote list; one build put `Read` and `Grep` on the direct list next to `TodoWrite`, the
other did not.

Controlled runs through `droid exec`, 104 in all, every one answered correctly:

| Model      | Tasks                                                 | Requests, direct on / off | Note                                    |
| ---------- | ----------------------------------------------------- | ------------------------: | --------------------------------------- |
| Opus 5.5   | chain, callers, gate timing, two-bug fix; 3 runs each |                   35 / 32 | 10 direct Read/Grep calls in 12 runs    |
| Sonnet 5.5 | the same                                              |                   33 / 35 | 1 direct call                           |
| Haiku 5.5  | the same                                              |                   64 / 38 | the chain took 10 requests instead of 3 |
| Opus 5.5   | two repo questions; 4 runs each                       |                   46 / 42 | time 376s / 336s                        |
| Sonnet 5.5 | the same                                              |                   35 / 38 | time 259s / 263s                        |

For Opus and Sonnet the differences sit inside run-to-run noise in requests, time and cost. Haiku
with direct `Read` follows a file chain one call per turn instead of writing a loop in one Script.
Without the direct tools, no model called `Read` or `Grep` top level in any run.

Past sessions, `script_only`, Oct 12 to Oct 30:

- Before the change (Oct 12 to 22, 12.5k Opus requests), Opus called a made-up `Read` or `Grep` top
  level 9 times, each failing "Not found".
- After it (Oct 22 to 30, 40k Opus requests), Opus made 5.7k direct `Read`/`Grep` calls, and 88 of
  them failed on arguments sent as text, like `offset: "60"`, although the request carried the
  number schema. Inside a Script the same tools failed 0.2% of the time, never on argument types.
- 12.5% of Opus requests and 4.7% of Sonnet requests after the change did nothing but direct
  `Read`/`Grep`.

`probe task-ab` reruns the controlled comparison.

## Haiku: direct mode against Script mode

Droid 1.0.0, 2026-10-30. Haiku is not on the remote list and runs `direct_only`. `probe task-ab`
compared the installed patch set (`haiku-direct`) with the same set plus a patch putting every model
in script mode (`haiku-script`, built `--extra` with `--without script-mode-sonnet`, the patch as it
was then), 4 tasks × 5 runs each:

| Task    | Requests, direct / Script | Median time, direct / Script |
| ------- | ------------------------: | ---------------------------: |
| chain   |                    32 / 3 |                    66s / 14s |
| callers |                     2 / 2 |                    11s / 10s |
| explore |                     3 / 3 |                    16s / 16s |
| fix     |                     7 / 5 |                    30s / 20s |

All 40 runs answered correctly. In total Script mode took 65 requests against 221, cost 7.8 cents
against 12.3 cents, and had 0 failed tool calls against 3. Where a task needs one lookup after
another, Haiku in direct mode spends a turn per file; in Script mode it writes the loop once. On
tasks that need one or two batched lookups the two modes tie.

## Every other model: direct mode against Script mode

Droid 1.0.0, 2026-10-30, the same two builds and four tasks, 3 runs of each task per model:

| Model                   | Correct, direct / Script | Requests, direct / Script | Median time, direct / Script |
| ----------------------- | -----------------------: | ------------------------: | ---------------------------: |
| GPT-5.6 Luna            |                  12 / 12 |                  133 / 45 |                    40s / 26s |
| GPT-6 Luna              |                  12 / 12 |                 141 / 104 |                    32s / 27s |
| Inkling (free)          |                  11 / 12 |                 155 / 128 |                    28s / 34s |
| Nemotron 3 Ultra (free) |                  11 / 12 |                 145 / 122 |                   100s / 63s |
| Laguna S 2.1 (free)     |                   9 / 12 |                 106 / 101 |                  124s / 114s |

- All five Laguna failures (3 direct, 2 Script) were the free provider refusing with 429, not wrong
  answers. Inkling and Nemotron each gave one wrong answer, both in direct mode.
- In money, GPT-5.6 Luna cost 8.7 cents direct against 4.8 cents in Script mode, and GPT-6 Luna 4.6
  cents against 4.3 cents. The free models have no price in the catalog.
- GPT-6 Luna puts one call in each Script when every lookup depends on the one before (33 requests
  on the chain task either way), so it gains nothing there. It ties or wins on the rest. The prompt
  text below fixed the chain.
- Inkling and Laguna in script mode still called `Read` or `Grep` top level, 53 and 34 times in 12
  runs each. Neither tool is on their list, but Droid runs a top-level call to any tool it knows by
  its plain name, so these calls work and each costs a turn instead of sharing a Script. Checked on
  2026-10-30: an Inkling session whose request offered only the script-mode tools (read on a
  `--bodies` build) called `Read` top level seven times in a row, and every call returned the file.
  Only made-up names such as `mcp__hollow_pipe__Read` fail "Not found". That is why Inkling's fix
  and explore tasks took more requests in Script mode (13 against 7, 10 against 7).

## Steering models into Scripts: the prompt text

Two prompt texts invited a call per turn. The top-level `TodoWrite` description, stock direct-mode
text that `todo-write-direct` exposes, said to send TodoWrite together with "Read, Grep, Glob, LS,
Execute, Edit, Create". The script-only section of the system prompt was one line about guidance
elsewhere and never said those tools live only inside a Script.

Two patches in `src/patch/tool-surface-patches.ts` rewrite them, since 2026-10-30:

- `script-only-section-steers-to-scripts` says the tool list holds every top-level tool, that Read,
  Grep and the rest exist only as `tools.<Name>` inside a Script, and that a chain of dependent
  steps is a loop inside one Script, not a turn per call.
- `todo-write-batch-rule-tool-neutral` has TodoWrite go out with "at least one other tool call that
  does the next action (in script mode, a Script)", with no tool names. The text holds in both
  modes, so it needs no mode check.

`probe task-ab`, installed build against the same build plus the two patches, OpenAI and Claude
models. The chain task (30 files, each naming the next) is where the effect shows:

| Model        | Chain runs read one Script per file, before / after | Chain requests in total, before / after |
| ------------ | --------------------------------------------------: | --------------------------------------: |
| GPT-6 Luna   |                                   8 of 15 / 0 of 15 |                                246 / 45 |
| GPT-5.6 Luna |                                     0 of 6 / 0 of 6 |                                 19 / 19 |
| GPT-6.1 Sol  |                                     0 of 6 / 0 of 6 |                                 18 / 17 |
| Opus 5.5     |                                     0 of 6 / 0 of 6 |                                 15 / 12 |
| Sonnet 5.5   |                                     0 of 6 / 0 of 6 |                                 17 / 12 |
| Haiku 5.5    |                                     0 of 6 / 0 of 6 |                                 18 / 14 |

GPT-6 Luna's 15 runs per side are 3 from a four-task run, 8 from a chain-only run and 4 from a third
run; four more of its runs in the third run failed on DroidProxy `503 auth_unavailable` before doing
anything and are left out. On the callers, explore and fix tasks (3 runs each, Luna and Haiku) the
two builds tied. No run got a wrong answer from the change. `droid exec` never offers `TodoWrite`,
so these runs measure the system-prompt section alone; the `TodoWrite` text is unmeasured.

The free OpenRouter Inkling kept its one or two stray top-level calls per run with the new text.

## Open

- Due 2026-11-06, and again a week later: run
  `bun run probe tool-errors --since 2026-10-30 --model opus --mode script_only` and read the
  top-level Read/Grep "Not found" count. Read and Grep went back inside Script on 2026-10-30. Before
  they were direct the same command (`--since 2026-10-18 --until 2026-10-23`) counted 11 in five
  days, 0.6 per 1,000 requests, plus 4 Read calls with arguments sent as text. A count near that is
  the expected cost, one retry each. If it climbs well above it, route a stray top-level Read or
  Grep call into its Script binding (and turn `"60"` into 60) rather than putting them back on the
  direct list, which tripled failed calls.
- Whether the new `TodoWrite` text changes how often TodoWrite goes out alone, or with a top-level
  Read, in real sessions. `droid exec` cannot show it; past sessions after 2026-10-30 can.
- If Factory drops the remote list or gives every model Script, the patch becomes a no-op and should
  be deleted.
- Whether Sonnet does better or worse in script mode than direct, in quality, turns or tokens, is
  not measured. Only that it uses `Script` correctly on a two-file task.
