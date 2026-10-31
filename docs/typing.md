# Typing: what a keystroke costs

Measured on Droid 0.218.1, 2026-09-13 and 2026-09-14, with `probe keys` and paired CPU profiling of
the typing window. Startup and typing share almost no code, so startup numbers do not apply here.
The React concurrency experiment has its own file, [react-concurrency.md](react-concurrency.md).

## Summary

- A single keypress is fast: ~4ms median echo on an idle input box.
- Sustained typing was expensive: ~570 to 930ms of CPU per 100 keys, about ten times idle, depending
  on machine load.
- Four shipped fixes cut it roughly in half. Each removed work that ran once per keystroke.
- Measured later with a proper window cut-off, 100 keys cost 201 to 229ms of CPU against 78ms idle
  for the same span. So the keys themselves are worth ~130ms.

## Where the cost was

Attribution of a stock typing window, 120 keys at 40ms apart:

| Owner                                | Share |
| :----------------------------------- | ----: |
| React reconciler                     |   40% |
| Model registry, `resolveModelPolicy` |   25% |
| Ink `string-width` and emoji regex   |   12% |
| Ink `log-update` and the output diff |   10% |
| Yoga layout                          |  0.1% |

Input state lived at the root of the app (`app.tsx:679`), so every keypress re-ran the root
component and everything under it. The work inside that render was the cost, not the renderer.

## Shipped: `model-alias-lookup-set`, -191ms per 100 keys

The model alias lookup (`lC` in 0.218.1) ran `Object.values(RO).includes(T)` once per model id,
inside `.map`, inside `.filter`, inside the root render. `RO` is a frozen model-id enum. The patch
caches the value set and rebuilds it if the binding is ever replaced:

```js
if ((lC.$o !== RO && ((lC.$o = RO), (lC.$s = new Set(Object.values(RO)))), lC.$s).has(T)) return T;
```

| Owner            |  Base | Patched | Paired difference | 95% CI           |
| :--------------- | ----: | ------: | ----------------: | :--------------- |
| model registry   | 228ms |    37ms |          -191.3ms | -197.0 to -185.6 |
| react reconciler | 789ms |   560ms |          -229.2ms | -250.3 to -208.1 |

The two rows overlap, because the scan runs inside render. Do not add them. Total typing CPU fell
from 934ms to 677ms. The `/model` picker, the heaviest user of the lookup, renders byte-identical
screens on both binaries.

## Shipped: width memo per grapheme, -90ms and -80ms

`ink-string-width-grapheme-memo` and `app-display-width-grapheme-memo`. Ink's `string-width` and the
app's own `displayWidth` both split a string into graphemes and measure each one. Ink's cache keys
on the whole line, so one more typed character misses it and re-measures the whole line. Raising the
cache size changed nothing (+6ms), which proved the miss rate was the problem.

Memoising per grapheme, in two maps keyed by the wide-ambiguous flag, cut `string-width` by 90ms and
the output diff by 80ms per 100 keys. The diff falls too because it measures the frame it diffs. The
hottest leaf before this was `/^\p{RGI_Emoji}$/v` at 97ms.

## Shipped: `draft-dismiss-no-rerender`

`dismissAfterDraftEdit` dispatched `{type:"draft-edited"}` on every keystroke. The reducer returned
the same state, so React bailed out, but it still ran the root component once per dispatch. The
patch reads the state from a ref and returns early when there is nothing to dismiss. Root renders
per 50 keys fell from 65 to 18.

## Production React

Droid 0.218 shipped React's development build (zero `Minified React error` strings, all the dev-only
invariants present). Swapping in the production modules was worth -58ms alone and ~-30ms on top of
the other fixes. **Droid 0.220.0 ships production React itself**, so the swap is gone.

## Nulls

| Experiment                            | Result                                                              |
| :------------------------------------ | :------------------------------------------------------------------ |
| Remove JSX owner-stack capture        | null; the dev-build `Error` per element is cheap                    |
| Ink `incrementalRendering: true`      | null; it changes how a frame is written, not measured               |
| `useDeferredValue`, `startTransition` | twice the commits, see [react-concurrency.md](react-concurrency.md) |

## The transcript costs nothing per keystroke

Finished messages render inside Ink's `Static`, which the output walker skips, and an item rendered
there is never rendered again. `MessageList` splits units into committed units (static) and live
units. The live tail is at most 2 rows with a pane open and up to 10 while streaming. So a long
transcript adds no per-key work. This is read from the code. Every render count was taken with an
empty transcript.

## What is left

After the fixes, the top in-window frames are each under 10ms:

| Frame                               |   CPU | What it is                    |
| :---------------------------------- | ----: | :---------------------------- |
| `stringify` under `persist`         | 9.2ms | Session index written to disk |
| `cloneObject`, `copyDataProperties` | 7.1ms | Object copying in the store   |
| Ink and React frames                |  10ms | The render itself             |
| `lookup` under `net.connect`        | 3.2ms | Background network            |

`persist` is not per key. `SessionIndexCache.queuePersist()` writes the whole index
(`~/.factory/sessions-index.json`, 4.67MB on this host) 1000ms after a change, and nothing a
keystroke does calls it. A 5x longer idle window does not raise its cost, so the profile catches one
startup write drifting into the window.

## How long a keypress keeps writing: the quiet windows of `probe keys`

Measured 2026-10-20 on Droid 0.245.0, stock `/tmp/droid-test.orig` and patched `/tmp/droid-test`.
Four runs per binary, each with 10 echo presses, 10 backspace presses and one 60-key burst at 16ms.
After every key the harness waited 1500ms and timestamped each output chunk. The load average moved
between 2 and 25 while other work ran on the machine.

`probe keys` waits for a quiet window after every key so one key's output cannot be mistaken for the
next key's echo. The window used to be 700ms everywhere (~21s a run). Re-measure the tails with
`bun run probe keys --tails -r 4 <stock> <patched>`: it waits 1500ms after every press, prints
median, p95 and max per key and binary plus the burst range, and says whether `KEY_QUIET_MS` clears
the worst tail. Time from one keypress to that key's last output byte, every press except the first
of each run (n=36 per row):

| Key       | Binary  | Median | p95 | Max |
| :-------- | :------ | -----: | --: | --: |
| echo      | stock   |    3ms | 5ms | 8ms |
| echo      | patched |    3ms | 8ms | 9ms |
| backspace | stock   |    3ms | 9ms | 9ms |
| backspace | patched |    3ms | 7ms | 7ms |

Silence between two chunks of one response: at most 3ms. After the 60-key burst the last byte came 2
to 40ms after the last key on stock and 2 to 55ms on patched (14 bursts over two passes), with no
silence inside it longer than the tail itself. Single stalls do happen under load: an earlier pass
saw one patched backspace take 1276ms to answer, at a load average of 14. A stall like that fails a
trial under any window, so it is not what the window sizes.

The first key after the input box appears is different. Its first byte took 134 to 591ms on both
binaries, and on stock a second burst of output followed it after a 524 to 556ms silence in most
runs (8 to 11 chunks instead of 4; the patched build showed no such silence). That is one-time work,
not typing cost, and a 200ms window would end inside the silence. So the first trial keeps the 700ms
window and every later trial and the burst use 200ms: 3.6x the worst burst tail (55ms) and 22x the
worst single-key tail (9ms). The backspace now waits for its own first byte (`respondsTo`) before
the quiet window starts; before, the window's first 25ms poll could pass before the backspace
answered.

## The 1.2ms echo regression the 0.245.0 gate flagged

Measured 2026-10-21 on Droid 0.245.0. The update gate's `probe keys -r 12` failed the patched build
(digest 62c631cc463d) against stock: echo median per run 6ms against 7ms, paired +1.2ms, 97.5% CI
0.6 to 1.8. The candidate cause was the new `settings-watch-after-paint-ink` hook, which runs on
every Ink frame. Re-measured with all binaries copied into `/tmp/odkeys/`: stock, the last gated
build (6e29ddbf11a7, then installed) and the same patch set rebuilt from stock, plus that set
without the frame hook. Load average 1.5 to 3.3 unless noted, `-r 12` each:

| Comparison                         | Echo median  | Paired echo difference        | Lag difference           |
| :--------------------------------- | :----------- | :---------------------------- | :----------------------- |
| stock, old, new, no hook (4-way)   | 4, 4, 4, 4ms | no pair printed               | medians 37ms on all four |
| stock vs new                       | 3 vs 3ms     | -0.1ms, CI -0.5 to 0.4        | -9.1ms, CI -22.6 to 4.4  |
| old vs new                         | 4 vs 5ms     | +0.5ms, CI -0.8 to 1.8        | -3.4ms, CI -14.7 to 7.9  |
| stock vs new, 5 busy cores, load 7 | 2 vs 3ms     | +0.2ms, CI 0.1 to 0.3 (97.5%) | -1.4ms, CI -15.2 to 12.5 |

So the 1.2ms did not come back on a quiet machine, and under load the frame hook's cost resolves at
0.2ms. The gate's run had a higher echo on both sides (6 and 7ms against 3 and 3), so its machine
was busier. No patch was changed. The gate now fails a measure only when the interval clears a floor
(echo 3ms, lag 16ms), see [method.md](method.md).

## Droid 1.1.0: idle and busy keys (2026-10-31)

Idle, `probe keys -r 8`, patched against stock: echo 3 vs 6ms median, paired -3.1ms (CI -3.5 to
-2.7); lag -1.0ms.

`probe busy-keys` (files `src/probe/busy-keys*.ts`) is new. It types into the input box while Droid
is idle, streams a reply from a stub model, or runs a tool, and reports how long until each key
shows on screen. `-t/--turns` resumes a long synthetic session first.

With a 300-turn session the patched build echoed in about 5ms median and about 13ms worst while
streaming, and in 2 to 12ms while a tool ran. These are single runs on a loaded machine, so they are
not an A/B. The session list (`probe sessions`) opened in 80 to 90ms, and `/clear` took 49ms.

No slowdown reproduced.

## Open items

- `hasAnyAvailableModel` (`SettingsService.ts:1082`) runs the policy scan outside any `useMemo`.
  Check whether it is the remaining ~36ms of model-registry time.
- Re-run the render counter after a real session to confirm the transcript costs nothing.
- The idle TTY health poll re-renders the root twice a second. Cheap, but it is the only reason an
  idle Droid renders.
- Recording key latency in real sessions would show whether long real sessions slow typing.
- `stub-model.ts` gives its one-shot tool reply to the first request, which on 1.1.0 is a request
  with no tools, so the `probe busy-keys` tool phase may not run a real tool.
