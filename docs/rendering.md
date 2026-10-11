# Rendering

How much work Droid does to draw a streamed reply, a resumed session and a resized window. Measured
2026-10-11 on Droid 0.238.0, darwin-arm64. The A/B is all 11 new render patches against the same
harness without them (`probe build --without ...`), on a quiet machine (load about 5-10), paired.
Every row resolved.

## The headline

| Question                                   | Before → after                                                                 |
| :----------------------------------------- | :----------------------------------------------------------------------------- |
| Streaming a 4193-char markdown reply, n=10 | CPU 1210 → 930ms (-288ms, -23%)                                                |
| Same, inside Ink's `onRender`              | 150 → 65ms; root renders 78 → 39; markdown parses 89 → 69; frames written -3.6 |
| Resuming a 150-turn session, n=8           | CPU 2450 → 2125ms (-324ms)                                                     |
| Same, transcript visible after spawn       | 830 → 655ms (-176ms); settled -187ms                                           |
| Same, markdown parses and `onRender`       | parses 300 → 157; `onRender` -175ms                                            |
| Same, input box paint                      | Unchanged, about 232ms                                                         |
| Resize of that session (120 → 100 cols)    | Wall 761 → 515ms (-251ms); CPU 958 → 489ms (-49%)                              |
| Same, markdown parses and `onRender`       | parses 300 → 0; `onRender` -172ms                                              |
| Typing 40 keys, n=6                        | `onRender` 67 → 30ms; commits and frames unchanged (41 and 40)                 |
| Slash menu open                            | `onRender` 13 → 6ms                                                            |
| Idle settled session                       | Zero commits, zero frames, both builds                                         |

## New tools

`probe stream` streams a reply from a local stub model. It adds a `customModels` entry with a
`baseUrl`, and a `sessionDefaultSettings.model`, through `FACTORY_RUNTIME_SETTINGS_PATH` only.
Nothing in `~/.factory` changes, and the stream costs nothing.

`probe resume` writes a synthetic, deterministic session: a `session_start` record (it needs an
`owner`), message records and an `agent_turn_outcome`. The file goes under the sessions folder for a
temporary directory in `~/.cache/ovrdroid/resume`, and the probe deletes it afterwards. It also
measures a resize. It resizes the PTY and sends SIGWINCH itself, because `Bun.Terminal.resize` sends
no SIGWINCH.

`probe build --counters` and `probe counters` count work. They count commits, frames built and
written, milliseconds inside `onRender`, root and message list renders, markdown parses and bytes.
The build samples the counts to `$OD_COUNTERS` every 200ms. Counts resolve where wall time cannot.

`pairedStats` changed too. It uses Student t for n of 31 or less, and it refuses to resolve n
below 2. The old z of 1.96 let two identical copies look different at n=2.

## Shipped patches

`resume-expand-once`. Stock doubles the visible window every 100ms after a resume. Each step is a
committed insert reset, so Ink redraws the whole Static region and clears the terminal. The patch
expands once.

`main-transcript-markdown-cache`. Droid has a markdown LRU cache, but it only worked under a
`scopeKey`, and only the detail panel set one. The main transcript now uses it.

`ink-style-diff-same-skip`, `ink-output-caches-shared`, `ink-frame-wrap-cache` and
`ink-blank-cell-shared`. These cut per-frame Ink work. Stock did a style diff per character with
Sets, recreated its caches every frame, rewrapped every line, and made a fresh cell object for each
of height times width. A scratch bench fell from 3.0 to 0.38ms for a 20-paragraph frame, with
byte-identical output.

`markdown-parse-memo`. The live tail was parsed twice per streaming update.

`code-highlight-memo` and `code-ansi-memo`. Stock ran highlight.js and the span-to-ANSI step for
every code block on every redraw. The caches hold at most 2000 entries and 4M characters, because a
streaming block caches every prefix of itself.

`input-change-noop`. The chat input effect reported unchanged text after every commit, through a
fresh callback. A no-op setState still re-ran the root. This doubled root renders while streaming.

`decomp-miss-cache`. `getDecompSessionType` re-read and zod-parsed the session file on every root
render in a non-mission session. That cost about 0.8ms each time.

## Retractions

"Frame building is the streaming cost" was wrong. The 19ms per frame came from machine load (60-130)
and blocked writes. On a quiet machine a frame builds in about 0.5ms, and React work in the root was
about 59% of streaming CPU.

"The TTY health poll re-renders while idle" was wrong. It checks `isatty` every 1000ms and only acts
on a failure. An idle session schedules zero updates. The idle renders seen earlier were the startup
tail landing after the output-quiet settle: identical frames write nothing, so they do not reset the
quiet timer.

A profile showed 590ms of chokidar `fs.watch` at resume. That was an artifact of one binary file. A
byte-identical copy at another path paid about 60ms. The cause is unknown. Profile a fresh copy
before you trust a number from one binary path.

## Measured and not shipped

Slash-menu search memo: finder reuse, prefix narrowing, and no description scoring for name matches.
The output was equivalent, but it saved only about 0.3ms per key at about 110 commands. Fuzzy
matching accepts nearly every description for a short query, so scoring dominates. I dropped it as
not worth the code.

React concurrency is still a loss. See [react-concurrency.md](react-concurrency.md).

## Open items

- Tail-only reprint on resize and resume. A resize still re-renders every message: React, yoga and
  Ink over the whole transcript. That is about 0.5s of CPU at 150 turns and about 2s at 600.
  Reprinting only the last K units would make it constant, but older messages would leave terminal
  scrollback. That is the user's call.
- The shared markdown LRU (1000 entries, 5M characters) holds about 500 markdown messages. Beyond
  that, every resize parses everything again. Raising the limit costs memory, and that cost is not
  measured.
- `SettingsManager.refresh()` rebuilds the `~/.agents` chokidar watcher twice on startup and three
  times on resume, at 20-45ms each after paint. Option one: delay the reset of old sources by about
  1s, so the pool entry survives. Option two: use one recursive `fs.watch` on macOS instead of 54
  per-file handles (20ms → 0.4ms in a spike).
- The per-delta stream notification path is about 14% of streaming CPU. It does a `structuredClone`,
  two zod parses and an OpenTelemetry span per text delta. I did not trace it to its receivers.
- The model-cycle `useMemo` has a fresh array as a dependency, so it recomputes on every root
  render.
- The spinner (125ms ticker) and the stream throttle (100ms) run on separate timers.
- `getDecompMissionId()` has the same uncached summary read that `decomp-miss-cache` fixed.
