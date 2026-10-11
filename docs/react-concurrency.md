# React concurrency on the chat input: a measured loss

Measured on Droid 0.218.1, 2026-09-14. Read this before you try `useDeferredValue`,
`startTransition` or any other React scheduling on the input or the transcript. Both were built and
measured. Both double the commits per keystroke. Neither ships.

## The render counter

CPU says how much work ran, never how many times. The baseline here came from a counter build: five
instrumentation patches that bump a global and write it to a file every 200ms beside
`process.cpuUsage()`.

| Counter   | Patch site                       | Counts                     |
| :-------- | :------------------------------- | :------------------------- |
| `root`    | root component prologue          | root component calls       |
| `commit`  | Ink `resetAfterCommit`           | commits reaching the host  |
| `frame`   | Ink `writeFrame`                 | terminal frames written    |
| `input`   | chat input params, default value | chat input component calls |
| `suggest` | slash-command match call         | slash menu scans           |

Two counting shapes are worth reusing:

- A component render counts from a **defaulted extra parameter**
  (`function Y6T({...,__od=(...).input++,`). It needs no statement context.
- A value used in an expression counts through a **comma expression**
  (`=((...).suggest++,OBh(MT,XR))`).

The counter patches lived in `/tmp/od-counters.json` and are not in the repo. If render counts are
needed again, they belong in `src/patch/trace-patches.ts`.

## Baseline

Keys 16ms apart, empty transcript:

| Window            | root | commits | input renders | frames |    CPU |
| :---------------- | ---: | ------: | ------------: | -----: | -----: |
| 60 plain keys     |    4 |      62 |            62 |  22-26 | ~280ms |
| 20 keys after `/` |  2-4 |      22 |            21 |    7-9 | ~350ms |
| 1 second idle     |    2 |       1 |             1 |      1 |   44ms |

The input already renders once per keystroke, and the root is already off the per-key path. There
was no priority problem to fix.

## Why it was worth trying

Ink asks for a legacy root (`concurrent:!1`), which would make every concurrency hook a no-op. But
React 19.2 compiled legacy mode out, so the root is concurrent whatever Ink asks for. The app itself
uses none of these hooks.

## Result

20 keys after `/`, 10 paired rounds:

| Variant            | Commits     | Input renders | CPU                   |
| :----------------- | :---------- | :------------ | :-------------------- |
| `useDeferredValue` | 22.3 → 41.6 | 21.3 → 40.6   | +25.3ms, CI 4.9-45.7  |
| `startTransition`  | 22.3 → 41.8 | 21.3 → 41.8   | +26.9ms, CI 13.4-40.4 |

On 60 plain keys, `startTransition` took commits from 50.6 to 106.6. CPU did not resolve there, but
the counts did.

## Why it backfires

Deferring renders a subtree twice: once with the old value at urgent priority, then with the new
one. That pays only when the second pass is expensive and skippable. The suggestion list is cheap
and always on screen. And under Ink every commit builds and writes a terminal frame, so two commits
mean two frame builds, which is exactly the work the typing fixes removed.

**Concurrency trades total work for responsiveness.** Under a renderer that writes a frame per
commit, it costs one extra frame build, and it pays only when the deferred subtree is costly and
skippable.

## Streaming output cannot be deferred

The transcript is not React state. It comes from `useSyncExternalStore` over the session store, and
streamed chunks notify the store. React forces store updates to the sync lane (`forceStoreRerender`
enqueues lane 2), so a transition around a store notification is ignored. There is nothing to patch.
