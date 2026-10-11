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

## Open items

- `hasAnyAvailableModel` (`SettingsService.ts:1082`) runs the policy scan outside any `useMemo`.
  Check whether it is the remaining ~36ms of model-registry time.
- Re-run the render counter after a real session to confirm the transcript costs nothing.
- The idle TTY health poll re-renders the root twice a second. Cheap, but it is the only reason an
  idle Droid renders.
