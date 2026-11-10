# Rendering

How much work Droid does to draw a streamed reply, a resumed session and a resized window. Measured
2026-10-11 on Droid 0.238.0, darwin-arm64. The A/B is all 11 new render patches against the same
harness without them (`probe build --without ...`), on a quiet machine (load about 5-10), paired.
Every row resolved.

## Droid 1.3.0 copy check, 2026-11-04

darwin-arm64, patched digest `6e038377039f`, Bun 1.4.3. Compared stock
`/tmp/ovrdroid-update-1.3-bin/droid.orig` against patched `droid` in the same small directory.
`probe resume` (10 pairs, 150 synthetic turns) and `probe stream -r 10` (4193 characters from the
local stub, 25-character deltas every 15ms) ran serially after startup and typing checks. Neither
makes a paid model call.

| Measure                  | Stock median | Patched median | Paired mean difference, 95% CI |
| :----------------------- | -----------: | -------------: | :----------------------------- |
| Resumed transcript shown |       1132ms |         1015ms | -315.4ms, -599.6 to -31.2      |
| Resume CPU               |       4150ms |         3150ms | -989.0ms, -1198.2 to -779.8    |
| Resize redraw            |        796ms |          529ms | -320.8ms, -462.1 to -179.6     |
| Stream CPU               |       1230ms |          930ms | -299.0ms, -339.1 to -258.9     |
| Stream screen lag        |         20ms |            4ms | -16.7ms, -17.4 to -16.1        |
| Stream bytes             |       120685 |         111420 | -8383.7, -9400.3 to -7367.1    |

Both commands pass all regression checks. Stream wall time is unresolved (+17.3ms, CI -3.2 to 37.8),
as is its frame count (-0.3, CI -0.8 to 0.2). These compare the complete patch set against stock,
not the contribution of any single patch.

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

It starts Droid in an empty folder under `~/.cache/ovrdroid/stream`, outside git, because the gate
runs from the repo. Inside a git repo the diff-stats footer (`diff-stats-without-pr`,
`diff-stats-footer-without-pr`) paints `+393 -452 |` on every frame: 12 visible characters in 8
colour codes, about 80 bytes. Ink rewrites the whole live area each frame, so a streamed reply of 55
frames grows by about 3.7 KB. On Droid 1.0.0 (n=10) that read as a byte regression, and a build
without those two patches matched stock (+43 bytes, CI -1392 to 1477) while keeping the CPU saving.
It is the feature's price, not waste, so the probe leaves it out. Droid must already trust the
folder; it does when your home folder is trusted.

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

Copying commands (`code-copy-*` in `src/patch/code-copy-patches.ts`, checked by `probe code-copy`).
A terminal copy carries every newline Droid wrote, so a command split by word wrap pastes broken.
Code block lines and inline code now print as one unbroken run; the terminal soft-wraps a run wider
than the screen, and a copy joins those rows. Inline code spaces become U+00A0 so Droid's own
markdown wrapper keeps the span whole, and they print back as plain spaces. A word wider than the
line goes on its own line unbroken (transcript paragraphs only; table cells keep hard breaks). Text
with no spaces, such as CJK, now counts as one word and moves whole to its own line.

The redraw stays clean (0.239.0): finished text goes to Ink's static output, written once at full
width and never erased. The live area clips each line at the terminal width, so a streaming long
command shows cut at the edge (20 live frames at 80 columns) and appears whole once its block
commits. The row count in the erase step always matches, and the screen equals a full repaint.

Checked again on 2026-11-03 with `probe code-copy` on patched Droid 1.1.0 and the 1.2.0 candidate
(one run each). Both draw the whole 124-character command while it streams, rather than clipping it.
Ink counts the terminal-wrapped rows with `Math.ceil(width / columns)` before erasing the frame. The
old probe rejected both builds because it required clipping. It now counts a live command only when
the next frame erases far enough upward to cover it and all its wrapped rows. The candidate
exercised 21 such redraws and the installed build 22. Both kept commands intact after the reply and
resize, and their final conversation matched a full repaint. A static command above the erased area,
a full repaint, or an erase that misses wrapped rows does not count.

The system prompt also asks the model to put commands in fenced code blocks.

Selecting with the terminal copies every glyph on screen, so the markdown blockquote bar `│` and the
chat input box sides (`│`) are gone (`copy-select-*` in `src/patch/copy-select-patches.ts`, checked
by `probe copy-select`, which fails on stock). The box keeps its top and bottom rules; its text sits
in the same columns. The early shell, markdown table separators and the second blockquote renderer
(`json-render`, never listed to the model) still draw `│`.

## Off the root: todos, message snapshot, roster (Droid 1.1.0, 2026-10-31)

`probe renders-log -d 2` over my own sessions (2 days, 615 processes, 934s of React render time)
showed where the root still spends its time. The root component (the main screen) took about 47% of
render time, about 2ms per render with about 400 hooks. `MessageList` took about 18%. The root
re-rendered because of these hooks:

| Root hook                                      | Changes | Why                                                    |
| :--------------------------------------------- | ------: | :----------------------------------------------------- |
| Session roster store (`()=>this.roster.model`) |    ~75k | Any roster change gives a new model                    |
| Message snapshot                               |    ~65k | About 10% came with no message event                   |
| Todo hook                                      |    ~32k | Returned a fresh `{todos}` on every store version bump |

`todo-snapshot-stable` and `todo-panel-memo` (`src/patch/todo-render-patches.ts`). The todo hook
returns the previous object when every todo has the same own keys with `===` values. The todo panel
is wrapped in React memo.

`snapshot-stable-messages` (`src/patch/snapshot-render-patches.ts`). On a snapshot cache miss it
reuses the cached message array when the session state manager, session id, update mode, streaming
version and the store's messages version are unchanged and every element is `===`. A message change
sent without `message_thread_updated` stays safe, because the store raises its messages version at
the next notify, before the store version moves. The `render-profile-snapshot` recorder anchor moved
to the return tail, so it records only new arrays.

`roster-render-split*` (7 patches, `src/patch/roster-render-patches.ts`). The root subscribes to a
value-compared facts snapshot of the roster (identity, loaded, working count, needs-you count, lead
session id), which is all the root's own render reads. The status line under the input box, the
roster pane and the pane-height hook each subscribe to the live model themselves. The controller
gets the model through a getter, so its callbacks read the newest model. On the mission path no
store is passed and every reader falls back to the root's model, as stock.

Measured with `probe renders -r 3`: the full set against `probe build --without` the three families,
median of 3, unpaired, so nothing here is resolved.

| Scenario | Count                           | Without → with                               |
| :------- | :------------------------------ | :------------------------------------------- |
| stream   | Root renders                    | 42 → 42                                      |
| stream   | React render time               | 168.5 → 137.3ms                              |
| stream   | Root self time                  | 67.8 → 55.7ms                                |
| stream   | Message snapshot changes        | 40 → 38                                      |
| stream   | Of those, with no message event | 6 → 3                                        |
| resume   | Render time                     | 241.7 → 238.2ms                              |
| resize   | Render time                     | 69.2 → 65.0ms                                |
| typing   | Render time                     | 16.6 → 21.6ms (one root render, 1.2 → 3.7ms) |
| menu     | Render time                     | 12.7 → 16.6ms                                |
| pending  | Render time                     | 11.8 → 10.8ms                                |

Resume, resize, typing, menu and pending are within noise. The scripted scenarios run no subagent
and change no todos, so they do not reach the roster and todo triggers. The real effect is for
`probe renders-log` over real sessions after the build has been in use.

The `probe roster-view` race. The probe failed about 1 run in 10 on both the new build and the build
without the patches (an instrumented baseline failed run 12 of 15 with the same screen). The child
droid's working count drops to 0 for about 4s while it hands over to the grandchild. When the
probe's 1.5s settle ended inside that dip, Down was pressed while stock's own open gate (needs a
droid working or needing you) was false. The probe now presses Down only while the working line
shows, and retries if the roster does not open within 2s, inside the same 15s budget. 15 of 15
passed after.

## Blank rows under the footer after the frame shrinks (Droid 1.1.0, 2026-11-01)

The bug: after a turn ends, a background droid finishes, or the "1 droid working" line goes away,
the screen shows blank rows under the last footer line (the status line) instead of the one cursor
row. Pasting an image fixes it. Stock does this too; none of our patches causes it.

The stock cause is Ink's log-update. It rewrites the live frame in place: erase the old frame's rows
upward, then write the new frame from that top row. A frame that loses k rows therefore ends k rows
higher and leaves k blank rows under it. Only a resize sets `viewportRepaintPending`, which repaints
the screen anchored to the bottom. That is why a resize or the image paste brings the footer back.

The resize repaint is not safe for a shrink. It redraws the visible screen from the tail of
`fullStaticOutput`, after hiding the cursor (`\e[?25l`, not a clear). After a shrink of k rows it
would draw k more static lines at the top of the screen, and those lines already sit at the bottom
of scrollback, so scrolling up would show them twice.

`ink-shrink-repaint*` (5 patches) padded the frame instead, from 2026-11-01 to 2026-11-05. Ink
remembered where on screen the frame's top row was and how tall the frame was. When the old frame
reached the bottom row and the new one was shorter, it put blank lines in front of the new frame so
that it still ended on the bottom row. The patch set dropped it on 2026-11-05 to go back to stock's
redraw, so the patched build shows the stock gap again. Commit 3432a13 holds the patch.

`probe frame-gap <binary>` checks this. A stub model streams a 40-paragraph reply on a 120x40 screen
and launches a background droid. The probe then reads the screen after the turn ends and again after
the droid finishes. It also checks that scrollback plus screen hold each reply line exactly once.

| Binary                             | After the turn ended | After the droid finished | Reply lines once |
| :--------------------------------- | -------------------: | -----------------------: | :--------------- |
| stock 1.1.0, run 1                 |           0 rows gap |               2 rows gap | yes              |
| stock 1.1.0, run 2                 |           3 rows gap |               2 rows gap | yes              |
| patched, with `ink-shrink-repaint` |           0 rows gap |               0 rows gap | yes, both runs   |

The first stage on stock depends on how far the frame shrank by the time the screen went quiet, so
it varies from run to run. The second stage failed on stock in every run and passed on this build in
every run.

A scratch run of the same scenario that recorded every frame showed stock at 2 to 3 extra blank rows
at the end, the build before this patch at 1, and this build at 0 for every frame after the reply
finished.

Cost, against `probe build --without` the five patches, paired, not resolved: `probe stream -r 8`
CPU +82.5ms (CI -70.8 to 235.8), wall -17.6ms (CI -65.7 to 30.5); `probe resume` (n=10) resize
redraw -7.3ms (CI -18.7 to 4.2), input box -27.2ms (CI -64.9 to 10.6).

## Blank message list inside an agent scope (Droid 1.7.0, 2026-11-10)

The main chat sometimes rendered zero messages, clearing and reprinting an empty terminal.
`bun run probe blank-log` recorded 4–29 such events per hour on 2026-11-10. Every blank had an
`empty-render` row with `agentScope` set and a React work-loop stack (`renderWithHooks` through the
scheduler), preceded by `scoped-read` rows.

React scheduling callbacks inherited the AsyncLocalStorage agent scope of the work that scheduled
them. Inside that scope, the adapter getter chose the agent's daemon-connected adapter, which lacked
the main session's session manager; the message selector therefore returned `[]`. Droid 1.7.1
retained the same upstream code.

`render-root-context-*` captures `AsyncLocalStorage.snapshot()` once when the React/scheduler module
initializes in the startup root context. Scheduler immediate and timeout callbacks, plus Ink host
microtask and timeout callbacks, run through that snapshot rather than the scheduling agent's scope.
Timeout wrappers return the original handles, so cancellation still works.

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

## Stacked tool calls

`general.toolResultDisplay` takes a third value, `stacked` (`src/patch/stacked-view-patches.ts`,
Droid 1.1.0). In the main chat, each run of consecutive non-inline tool calls draws as one line,
`Read 2 files › Grep 1 search › Read 1 file › Execute 2 commands (1 failed)`. Segments follow the
order the calls ran in; only neighbouring calls of the same tool share a count (`$ODsegments`).
While the run is open, a dim ` ↳ <subtitle>` line shows the latest call. Expanded and compact draw
as before, and the transcript panel is untouched.

- **Folding.** `$ODstack` runs over the units that `t0` returns in MessageList. Calls join the open
  run. Items for which `iD` draws nothing pass through and leave the run open: hidden thinking,
  quiet hooks, and TodoWrite, which the main view never draws. An inline tool closes the run, as do
  a pinned unit and anything else that draws.
- **Hooks.** A call or stock group whose hooks stock would draw does not fold: it draws as stock,
  hook rows included, and closes the run. The rule is stock's (`Tu`, `iD`): Show hook output is on
  and a before or after list is not quiet (`cw`). Quiet hooks fold. A hook that is still running
  folds until it settles, because the open run stays in the dynamic region; splitting the run for it
  would commit the part before it, and a quiet hook would then leave a second partial line. Stock
  1.1.0 drew no tool hook rows at all in the stub harness (PostToolUse exit 1, exit 2, stdout
  without `suppressOutput`, PreToolUse exit 1; expanded and Ctrl+O alike), so this is covered by
  unit tests only.
- **Approval.** Only a call in `pendingPermissionToolIds` (the calls of the open confirmation) stays
  out of the run: it draws as stock, so its block and prompt show, and the run before it stays open,
  so nothing is committed while it waits. Once approved it joins the run as a `command`.
  `permissionToolIds` is not read: the root keeps every id that ever asked until the session
  changes. Nothing is pinned to Static for an Execute: `staticToolIds` and the pending part of
  MessageList's `le` only take ExitSpecMode plans and ProposeMission, both inline.
- **Switching modes.** MessageList's `baseStaticKey` carries `:stacked` in stacked mode, and the
  layout effect that calls `onStaticEpochReset` on an epoch bump also calls it when the mode moves
  into or out of stacked. That clears the terminal and reprints the history once in the new mode.
  Expanded and compact share a key, as in stock.
- **Staying live.** The root's `rb=xs!=="idle"` (droid working state) reaches MessageList as
  `$ODturn`. The last run is open only while it is true. `Xz` treats an open run as live, so `eK`
  keeps it, and everything after it, in the dynamic region. Ink's `<Static>` never sees a run that
  can still grow. Stock commits a group as soon as its member calls settle, so a stacked run that
  stock rules committed early would print a second partial line.
- **Script.** Nested calls are ordinary items and join the run. The outer Script draws nothing, as
  in stock.
- **Thinking.** With Show thinking on, each thinking block draws as `Thinking: <summary>` in the
  same muted italic as stock. The summary wraps and is clipped at 3 rows (`THINKING_ROWS`, a
  `maxHeight` box with `overflow:"hidden"`), so a long first sentence shows whole. The summary is
  the text of the last `**Title**` line when the thinking has one (GPT reasoning summaries start
  each part with one), else the first sentence, whitespace collapsed. A redacted block reads
  `Thinking: [Content encrypted]`; a block with no text draws nothing. `$ODstack` marks each
  thinking item `$ODsummary`, and the `FM_2` thinking branch draws `$ODThinkingRow` for a marked
  item. The marked row closes the open tool run, as shown thinking does in stock. Ctrl+O and
  Alt+Up/Down render from `FM_2` and the history window without the mark, so they keep the full
  text; expanded and compact never mark.
- **Thinking and streaming cuts.** `streamingCuts` splits a streaming message at each finished
  markdown block and gives every part its own unit, so a part holds only its own slice of the text.
  A summary needs the whole text, so in stacked mode the cut computation skips thinking messages and
  the block stays one unit. Without that, a long thinking block grew a second
  `Thinking: <first words of the next paragraph>` row while it streamed (reproduced with the stub,
  not guessed).
- **Measured on screen** (stub turn of Read, Grep, Read, Execute ok, Execute exit 1, Edit, Read,
  text). The run grows in place to
  `Read 1 file › Grep 1 search › Read 1 file › Execute 2 commands, 1 failed`. It then commits
  without its ↳ line, the Edit draws with its diff preview, and the trailing `Read 1 file` commits
  when the turn ends. Scrollback holds no duplicate partial lines. `probe stacked` also opens the
  turn with a thinking block (`**Planning the run**\n\nI will read the files first.`, sent as three
  deltas, the stream held after the second). It checks that one `Thinking: Planning the run` row
  shows mid-stream with no body fragment, that the row is single and above the tally line at the
  end, that the body never draws, and that Ctrl+O shows the full text. With the cut skip removed the
  probe fails: the held frame holds a second row, `Thinking: I will read`.
- **Measured: approval and switching** (`probe stacked`, two more stub sessions of Read, Execute,
  Read). With the command on the deny list, the frame while it waits shows `Read 1 file` with its ↳
  line, the `Execute echo stacked-approval` block and the prompt; after Enter scrollback holds one
  `Read 1 file › Execute 1 command › Read 1 file` and no copy of the command. The previous build
  left `Read 1 file`, the Execute block, `Read 1 file`. Switching through `/settings` to expanded
  shows the three stock blocks, and back to stacked one line again; the previous build stayed
  expanded after switching back. The probe sets `FACTORY_DISABLE_SETTINGS_PERSISTENCE`, because the
  settings toggle otherwise writes `~/.factory/settings.json`.
- **Skill names and failures** (Droid 1.2.0, 2026-11-03). Each Skill call gets its own segment,
  `Skill <name>`, including neighbouring or repeated loads. The name comes from `toolInput.skill`
  and remains after the run closes; before that input arrives the call count still shows. Failure
  counts stay red and now use parentheses, `(1 failed)`.
  `bun run probe stacked /Users/andrej/.local/bin/droid --print` failed on the previous installed
  build (n=1), which displayed `Skill 2 calls`.
  `bun run probe stacked /tmp/droid-stacked-skills --print` passed on the candidate (n=1): both
  fixture skills loaded and their names showed in call order while the run was open and after it
  closed, followed by `Execute 2 commands (1 failed)`. Approval, switching modes and scrollback
  checks passed too.

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
- `snapshot-stable-messages` now reuses the message array when no message changed. What is left is
  the root still rendering on each version bump (the snapshot hook itself). Read how much from
  `probe renders-log`.
- `getDecompMissionId()` has the same uncached summary read that `decomp-miss-cache` fixed.
- Measure `todo-snapshot-stable`, `snapshot-stable-messages` and `roster-render-split*` with
  `probe renders-log` after a few days of use and compare with the 2-day baseline above.
- The chat input gets a fresh `onRewindShortcut` prop on root renders.
- The background-task panel (`OQ`/`UQ` in the probe output) re-renders on every root render, because
  `onFocusReturn` and `onProcessKilled` are fresh callbacks (42 of 42 renders in the stream
  scenario).
- `stub-model.ts` gives its one-shot tool reply to the first request, which on 1.1.0 is a request
  with no tools, so `probe renders -s tool` and `pending` may not exercise a real tool call.
