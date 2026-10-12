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

`probe readable <binary> -o <dir>` writes every module as readable React in about 15s. It restores
React's hooks and APIs, Ink's `Box`/`Text`/`Static`, JSX, and component and hook names in the form
the React Compiler accepts (components start A-Z, custom hooks `useX`). Local names stay minified.
It is for reading only: patches still target the minified code. Point it at the stock backup to read
stock names.

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

`ink-colorize-shared` and `shimmer-one-string`. A pending tool shows its name in a shimmer. Stock
drew it as one Ink `Text` per letter, each with its own colour, about 8 times a second. The shimmer
now builds one string, colouring each letter with Ink's own `Text` colour step (the first patch
shares that step as `globalThis.$ODcolorize`), and the parent `Text bold` draws it. Ink applies each
child's colour and joins the results, so the screen text is the same. Measured on a pending
`Execute sleep 14` from a local stub model, in a 6s window, n=10 paired, load about 5, control = the
same build without the two patches:

| Count                 | Control | Patched | Paired difference             |
| :-------------------- | ------: | ------: | :---------------------------- |
| `Text` renders        |   395.0 |    54.9 | -340.1 (CI +-9.0)             |
| All component renders |   501.2 |   157.7 | -343.5 (CI +-16.2)            |
| Shimmer renders       |    48.0 |    47.9 | -0.1, same                    |
| Commits               |    49.0 |    48.9 | -0.1, same                    |
| Frames written        |    50.7 |    50.6 | -0.1, same                    |
| `onRender` ms         |    37.4 |    31.9 | -5.5 (CI +-3.4)               |
| React self ms         |    10.0 |     9.4 | -0.6 (CI +-1.2), not resolved |

The saving is the 7 letter renders of "Execute" on each of the 48 ticks. Commits and frames do not
change, because the shimmer still repaints on every tick. `probe renders <binary> -s tool`
reproduces it: the stub model answers the first request with that tool call. A rerun gave Text
renders 391 → 55 and commits 49 → 49, median of 10.

The real-use render logs (`probe renders-log`, 2 days, 99 processes, 17.0M renders) pointed at the
next set. 29% of all renders had nothing changed but the parent.

`pr-state-same-skip`. The PR service polls every 60s and always publishes a new flat state object,
so the root re-rendered once a minute per process: 19,090 footer `prState` changes in 21,297
process-minutes, about 17% of all root renders. It now skips a state equal field by field.

`footer-memo` and `footer-memo-key`. The footer was not memoized and re-rendered with every root
render; 69k of its 220k logged renders had nothing changed. It is now memoized with a one-level
compare, because its call site passes fresh but equal objects (`prState` under 60 columns,
`droidsHint`). The footer reads two settings during render. `/settings` is a pane that unmounts the
footer, so it stays correct; a model switch or an outside settings edit would not, so the call site
also passes a key built from the token-usage text and the Nerd Font setting. The status line, the
background-tasks label and the migration label take a plain memo.

`chat-input-stable` and `chat-input-stable-use`. The main chat input re-rendered on every root
render, because seven callback props were fresh each time. A wrapper passes fixed stand-ins that
call the latest callback, and renders a memoized input.

`model-cycle-memo-key`. The model-cycle `useMemo` keyed on a fresh array and recomputed on every
root render; it now keys on the joined model ids.

`tool-progress-sanitize-cache`. A tool row re-sanitized every progress update on every render, O(N²)
over one long command. Each sanitized update is cached per update object. No probe produces tool
progress, so the hit rate is not measured.

Measured with `probe renders`, n=6 paired, alternated order, load 3-23, control = the shipped set
without these seven:

| Scenario | Count              | Control | Patched | Paired difference               |
| :------- | :----------------- | ------: | ------: | :------------------------------ |
| stream   | Chat input renders |    37.5 |     3.3 | -34.2 (CI +-2.8)                |
| stream   | Footer renders     |    42.5 |    11.5 | -31.0 (CI +-1.8)                |
| stream   | All renders        |    2927 |    2327 | -599 (CI +-78)                  |
| stream   | Nothing-changed    |     572 |     269 | -303 (CI +-17)                  |
| stream   | `onRender` ms      |   178.4 |   170.0 | -8.3 (CI +-73), not resolved    |
| resume   | Nothing-changed    |     145 |      81 | -64 (CI +-14)                   |
| resume   | `onRender` ms      |   257.1 |   246.5 | -10.6 (CI +-17.6), not resolved |
| menu     | `onRender` ms      |    19.5 |    15.7 | -3.8 (CI +-0.9)                 |

Root renders do not move in these scenarios (stream 36.8 → 37.0): the PR poll does not fire inside a
short window. Typing does not move either, because the shipped set already keeps the root still per
key.

`progress-notify-100ms`. The session store coalesces coarse events (tool progress, tool input) on a
50ms timer, because Bun has no `requestAnimationFrame`. It is now 100ms, the same as the text stream
throttle. Not measured: no probe produces tool progress.

The render recorder also logs three things the totals could not answer:

- Why the message snapshot changed: the store event types that raised `version` since the snapshot
  before, and how many changes carried no message event and held the same messages by a cheap check.
- Which root state hooks changed, by hook index, labelled by hook kind and the store it reads.
- What Droid was doing at each commit: typing (a key in the last 500ms), streaming, tool, working or
  idle.

The extra walk costs about 0.7 points of React render time (stream, 2.6% → 3.3%). On the stream
scenario, 4 of 36 snapshot changes came with no message event, and all 4 held the same messages.
Real use with tools and todos is the open question; read it with `probe renders-log`.

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

React Compiler (babel-plugin-react-compiler 1.0.0, Droid 0.238.0 stock). The compiled build paints,
renders code blocks and runs every `probe renders` scenario without a hook error, but renders barely
move: stream 2980 → 2758-2897, resume, resize, typing and menu within noise. It compiled 222
functions in 7 modules and skipped 103. The hot components are the skipped ones: the root,
`MessageList` and the chat view write `ref.current` during render, which the compiler rejects ("This
value cannot be modified", 73 of 82 in the main chunk), and try/finally blocks are not supported.
Components without hooks are never compiled, because infer mode needs a hook call or JSX syntax. The
step adds about 15s to the build and 0.16% to the binary. Not shipped, and the build step was
removed.

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
- The spinner (125ms ticker) and the stream throttle (100ms) run on separate timers. All spinners
  and shimmers already share the one 125ms timer.
- About 76% of root renders in the logs come from the message store snapshot. Its key is the store's
  `version`, which every event raises (metadata, settings, todos, working state), so `MessageList`
  gets a new `groupedMessages` even when no message changed. Keying the snapshot on transcript
  events only would cut that, but a message change sent without `message_thread_updated` would leave
  the transcript stale. Not measured.
- `getDecompMissionId()` has the same uncached summary read that `decomp-miss-cache` fixed.
