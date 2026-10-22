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

`script-mode-sonnet` (`src/patch/tool-surface-patches.ts`) adds a second way onto the list: a model
id or underlying id containing `sonnet`, case-insensitive. The remote list still applies and
`override` still wins once a model is allowed. Haiku, GPT and every other model are unchanged. The
match is hardcoded, with no setting.

Patched, the same `droid exec` call ran `Script` with two `Read` calls and answered `3` and `5`
lines. `probe tool-surface` on a `--bodies` build, now defaulting to `custom:droidproxy:sonnet-5-5`
at effort low, reads the request body of one real turn and showed `Script` and `TodoWrite` together
on the direct list. That one turn proves both this patch and `direct-tools`.

Opus 5.5 called `Read` and `Grep` directly in `script_only` sessions: 13 failures between Oct 18 and
Oct 22 across long sessions, with arguments sent as strings like "true" and "60", a sign it had no
schema. `direct-tools` puts `TodoWrite`, `Read` and `Grep` on the direct list. They stay bound
inside `Script` too.

## Open

- The remote list can change. If Factory adds Sonnet to it, the patch becomes a no-op and should be
  deleted.
- Whether Sonnet does better or worse in script mode than direct, in quality, turns or tokens, is
  not measured. Only that it uses `Script` correctly on a two-file task.
