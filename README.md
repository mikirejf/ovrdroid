# ovrdroid

A patch harness for the [Droid CLI](https://docs.factory.ai/droid-cli/overview).

Droid ships as a Bun standalone binary with its application source, precompiled bytecode and 35
sidecar files embedded in a module graph. This project extracts all of it, patches the source,
rebuilds the whole binary on a pinned newer Bun release, and re-signs it.

Measured on Droid 0.218.1 with `bun run bench`: time to first paint drops from 1.23s to 0.38s, and
exit from 1.09s to 0.07s. Typing costs 47% less CPU, measured with `bun run probe keys` and paired
CPU profiling.

The Bun upgrade is most of that. Droid 0.218.1 ships Bun 1.3.14; rebuilding on 1.4.2 is worth 173ms
on its own (n=30 paired rounds, 95% CI 163-183ms), because Bun 1.4.1 packed the bytecode format and
cut the embedded blob from 143MB to 45MB. Of the patches, the first five are worth about 36ms of CPU
together and the zod patch removes a further 68-79ms; both were measured inside the process because
this machine's wall-clock noise is larger than the effect.

Status: the harness applies the patch set below.

| Patch                                  | What it changes                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kitty-probe-timeout`                  | 150ms probe wait to 30ms                                                                                                                                                                             | Ghostty answers the terminal probe in a few ms.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `whoami-no-block`                      | Drops the `await` on `whoami`                                                                                                                                                                        | The call costs 450-800ms and gates feature flags and org settings, which already fall back to their disk caches.                                                                                                                                                                                                                                                                                                                                                                               |
| `certificate-count-skip`               | Skips the cert count                                                                                                                                                                                 | It spawns three shell pipelines just to validate a cache that has a 7-day TTL.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `shutdown-flush-deadline`              | 1000ms flush deadline to 10ms                                                                                                                                                                        | Exit waits the whole deadline for telemetry flushes that never finish in time anyway.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `session-search-warm-skip`             | Skips the session-search cache warm                                                                                                                                                                  | It scans every saved session at startup, before the input box is up, to prime a search nobody has typed yet.                                                                                                                                                                                                                                                                                                                                                                                   |
| `zod-v3-lazy-bound-methods`            | Binds zod schema methods on first use, not in the constructor                                                                                                                                        | The zod v3 constructor runs 24 `.bind(this)` calls per schema, and 15,215 schemas exist before the input box appears.                                                                                                                                                                                                                                                                                                                                                                          |
| `model-alias-lookup-set`               | Model alias lookup scans a Set                                                                                                                                                                       | It rebuilt an array with `Object.values` and scanned it linearly, once per model id, inside a render that runs on every keystroke.                                                                                                                                                                                                                                                                                                                                                             |
| `ink-string-width-grapheme-memo`       | Ink's width scan memoises per grapheme                                                                                                                                                               | Ink's cache keys on the whole line, so one new character misses it and re-measures every grapheme again.                                                                                                                                                                                                                                                                                                                                                                                       |
| `ink-string-width-grapheme-memo-init`  | Adds the two grapheme maps Ink's memo reads                                                                                                                                                          | The memo needs its narrow and wide maps created when the module is evaluated.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `app-display-width-grapheme-memo`      | `displayWidth` memoises per grapheme                                                                                                                                                                 | The app measures width separately from Ink and paid the same per-grapheme cost on every keystroke.                                                                                                                                                                                                                                                                                                                                                                                             |
| `app-display-width-grapheme-memo-init` | Adds the two grapheme maps `displayWidth` reads                                                                                                                                                      | Same as Ink's: the maps are created at module evaluation.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `turn-clock-state`                     | Adds the turn clock's state and its duration formatter                                                                                                                                               | The footer needs somewhere to remember when the last turn started and ended.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `turn-clock-track`                     | Records the times as the session goes busy and idle                                                                                                                                                  | The footer already re-renders on every status change, so the two edges are free to observe.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `turn-clock-parts`                     | Adds `↑sent ↓received` to the footer's timer bracket                                                                                                                                                 | Shows how long ago the last prompt went out and the last reply landed.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `auto-update-notice-only`              | Stops the update at the check and records the version found                                                                                                                                          | An auto-update silently replaces the patched binary with a stock one, so blocking it is what keeps every other patch applied.                                                                                                                                                                                                                                                                                                                                                                  |
| `update-notice-writer`                 | Writes the version found to `~/.factory/ovrdroid-update.json`                                                                                                                                        | The check finishes long after the header is painted, so the answer has to outlive the session that found it.                                                                                                                                                                                                                                                                                                                                                                                   |
| `update-notice-reader`                 | Reads that file when the header paints                                                                                                                                                               | One `readFileSync` of a tiny file, and it returns nothing once the installed version has caught up.                                                                                                                                                                                                                                                                                                                                                                                            |
| `update-notice-header-room`            | Reserves a header row for the notice                                                                                                                                                                 | The header sizes its canvas up front, so the extra line has to be counted before anything is drawn.                                                                                                                                                                                                                                                                                                                                                                                            |
| `update-notice-header-line`            | Draws `↓ vX available · run ovrdroid update` in the header                                                                                                                                           | The notice belongs where a session starts, not in the status bar where it competes with live state for the rest of the session.                                                                                                                                                                                                                                                                                                                                                                |
| `settings-watch-after-paint`           | Starts the settings file watchers once the app's first frame is on screen                                                                                                                            | Registering them crawls the settings trees, and typing during startup used to push that crawl into the frame it delayed. Nothing needs a file-change event before the app shows.                                                                                                                                                                                                                                                                                                               |
| `draft-dismiss-no-rerender`            | Skips the no-op `draft-edited` dispatch                                                                                                                                                              | The reducer returned the same state, but React still re-ran the root component for every keystroke.                                                                                                                                                                                                                                                                                                                                                                                            |
| `cache-warm-arm`                       | Arms a warm timer after every LLM request: 45m on Anthropic, 27m otherwise                                                                                                                           | While subagents run, one cheap request re-reads the session's prefix so the parent's cache is still warm when they return. It resolves tools the way the agent loop does, so tool search matches byte for byte. Its usage is tagged `odWarm`, so `cache-usage-log` skips it and the warm's own `warm:true` line is its only record. 45m, not 54m: one proxy 1h entry died before 54m, and a read costs next to nothing on this plan, so firing early is cheap and firing late wastes the warm. |
| `cache-warm-close`                     | Closing a session cancels its warm and aborts one in flight                                                                                                                                          | A closed session has nothing left to keep warm. A queued user message does not cancel it: that message is the one that needs the cache.                                                                                                                                                                                                                                                                                                                                                        |
| `cache-warm-forget`                    | Dropping a session's snapshot also drops its warm timer                                                                                                                                              | A forgotten session has nothing left to keep warm.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `cache-warm-effort`                    | Stores the turn's reasoning effort in the request snapshot                                                                                                                                           | The warm sends the same effort as the turn it replays; a different effort starts a separate cache entry.                                                                                                                                                                                                                                                                                                                                                                                       |
| `cache-warm-child-count`               | Exposes Droid's running-subagent count as `globalThis.__odKids`                                                                                                                                      | The warm fires only while the session has subagents running; with none, nobody is waiting on the cache.                                                                                                                                                                                                                                                                                                                                                                                        |
| `tool-result-omit-false-is-error`      | Sends `is_error` on a tool result only when it is `true`                                                                                                                                             | A live success leaves `isError` unset, so its request has no `is_error` key. A resumed session reads `isError:false` back from disk and sent `"is_error":false`, which changes the bytes of the prefix and misses the prompt cache the live session wrote.                                                                                                                                                                                                                                     |
| `resume-expand-once`                   | Shows all messages on the first expansion tick instead of doubling                                                                                                                                   | Stock doubles the visible window every 100ms (30, 60, 120, ...). Each step inserts older messages in front of ones already printed, which resets the transcript and redraws it all, so a 677-message resume redrew about 5 times. The first paint still shows only the last 30.                                                                                                                                                                                                                |
| `main-transcript-markdown-cache`       | Wraps the main transcript in a markdown cache scope                                                                                                                                                  | Droid caches parsed and rendered markdown by text, width and colors, but only inside a scope. After a reset or a resize every message is parsed and rendered again unless a scope is set.                                                                                                                                                                                                                                                                                                      |
| `ink-style-diff-same-skip`             | Skips the style diff between two neighbouring characters whose styles match item by item                                                                                                             | Ink's `cP` ran Sets, filters and maps for every character of every frame, and the result is always the empty string when the styles are equal.                                                                                                                                                                                                                                                                                                                                                 |
| `ink-output-caches-shared`             | One styled-char and width cache is shared by all frames, reset past 512 lines                                                                                                                        | Every frame built a new `Output` with empty caches, so each unchanged line was segmented again.                                                                                                                                                                                                                                                                                                                                                                                                |
| `ink-frame-wrap-cache`                 | `writeFrame` caches the wrapped rows of each line per width, up to 2048 lines                                                                                                                        | Ink re-wrapped the whole frame tail on every frame, though most lines had not changed.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `markdown-parse-memo`                  | Remembers the last four markdown parses by their exact input and returns the same tree for a repeat                                                                                                  | A streaming reply is parsed twice per update, by the cut finder and by the renderer, about ten times a second; the second parse is free when the strings match. Nothing writes to a returned tree.                                                                                                                                                                                                                                                                                             |
| `ink-blank-cell-shared`                | Ink's grid uses one blank cell per frame instead of a new object for every position                                                                                                                  | Every frame allocated height×width cell objects; no code writes to a blank cell or its styles array.                                                                                                                                                                                                                                                                                                                                                                                           |
| `code-highlight-memo`                  | The code block and diff line renderer remembers the highlight.js result for each language and code text, up to 2000 entries or 4M characters                                                         | Every redraw of the transcript (resize, remount, resume) and every re-render of the live tail ran highlight.js again for every code block, 15-42ms per redraw at 150 turns. The result is a string that does not depend on the theme, so a repeat can return the same string.                                                                                                                                                                                                                  |
| `code-ansi-memo`                       | The same renderers remember the colored text for each highlight.js result, up to 2000 entries or 4M characters, and forget all of it when the theme syntax colors or the terminal color level change | Every redraw also ran a span-to-ANSI regex loop again for every code block. The colored text depends only on the highlight result, the active theme syntax colors and the chalk level, and it is a string, so no caller can change a remembered value.                                                                                                                                                                                                                                         |
| `input-change-noop`                    | Skips the chat input's change report when the text equals the draft the root already holds                                                                                                           | The input reports its text after every commit through a callback the root makes anew each render. The no-op write still scheduled a root render that React then bailed out of, which doubled root renders while a reply streamed.                                                                                                                                                                                                                                                              |
| `decomp-miss-cache`                    | Remembers, per session id, that the session summary has no `decompSessionType`                                                                                                                       | The root asks for it on every render. In a normal session each ask read the session file, parsed it and ran a zod parse, about 0.8ms per root render.                                                                                                                                                                                                                                                                                                                                          |

```bash
bun run ovrdroid update
bun run ovrdroid status
bun run ovrdroid apply
bun run ovrdroid restore
```

## The turn clock

The footer gains `↑7m ↓5m`: how long ago the last prompt was sent, and how long ago the reply
finished. It sits inside the timer bracket, right after the duration:
`[⏱ 21m 6s, ↑7m ↓5m, cache 53m, context: 35%] ? for help`. With no duration or context to share, it
opens a bracket of its own.

Nothing is added to startup. The clock watches the session status the footer already receives, and
notices the two edges where it leaves and returns to `idle`, so a session that has sent nothing yet
renders nothing and schedules nothing. Measured against a control binary built from the same patch
set minus these three patches, the paint difference was not resolved (n=14, 95% CI -39 to +15ms).

**The edge says when to look; the session says when it happened.** The time itself is read from
`getDroidWorkingStateChangedAtMs()`, never stamped from the render. The footer is not always
mounted: it unmounts whenever the slash-command menu is open. Stamping at render time meant a turn
that ended behind that menu was recorded when the menu closed, showing `↓<1m` for a reply that had
landed a minute earlier. Resuming a session that was already busy told the same lie.

The display is deliberately coarse: `<1m` until the first minute is up, then `7m`, `2h`, `3d`. That
buys the repaint budget. One `setTimeout`, aligned to the next boundary that actually changes a
digit, redraws the footer **once a minute** for the first hour, then hourly, then daily. A second
would have cost 60x the repaints to animate a digit nobody is watching.

Measured over a 150s idle window: 3120 bytes painted, against 30780 bytes/minute for a per-second
version of the same patch and 0 bytes for the control. Typing is untouched (median 33.5KB painted
for 60 keystrokes, against 34.9KB for the control).

The alternative was Droid's own `dAT` tick hook, which subscribes to a shared 125ms interval that
then runs for the rest of the session even when the visible text has not changed for an hour.

One tradeoff comes with the single timer: it is aligned to whichever of the two times is newer, so
the other can show its previous minute for up to 59s longer. A second timer would keep both exact
and double the idle repaints, which is the wrong trade for a minute-resolution display.

### The cache countdown

The same bracket carries `cache 59m` after the turn clock, set off by a comma. It counts down to
`cache <1m` and then `cache cold` (in the warning colour) once the hour is up. It answers "is my
prompt cache still warm?" the way Claude Code's "Prompt cache warm, about 59 min left" does.

The clock is written by `cache-warm-arm`, not the footer. The recording code lives in
`src/patch/cache-clock.ts` and is spliced into that patch, because it already owns the `pY` rewrite.
`pY` stamps `globalThis.__odCache` with the request's `capturedAt` for the session, because the
cache lifetime runs from when a request is **sent** (see `docs/cache-lifetime.md`, "The clock starts
at request start") and every request resets it. A successful cache warm resets it to the moment the
warm was sent. Only Anthropic models get a clock: DroidProxy makes every Anthropic write last an
hour, and no lifetime has been measured for the others, so a non-Anthropic request removes the entry
and the footer shows nothing.

The footer's one timer now wakes at the earlier of the turn clock's next step and the next minute
boundary of the cache's remaining time, one millisecond past it so the digit has changed, and again
at the exact expiry moment. Once the entry is cold and no turn clock is running, it sleeps.

The footer only reads the entry when it renders, so a warm that resets the clock while the session
sits idle shows up at the next wake-up, at most a minute later.

### Resuming a session

The clock lives in memory, so a session you resume would show nothing until its first new request.
So every request and successful warm also writes `~/.factory/ovrdroid/cache-clock/<sessionId>.json`
as `{"at": <ms>, "setup": {...}}`, and a non-Anthropic request overwrites the file with a tombstone,
`{"at": null}`, which means "no clock". When the footer shows a session with no entry, it reads that
file once and puts the entry in `globalThis.__odCache` marked `loaded`. A tombstone shows nothing.
The next live request replaces the entry, and the file, with a normal one.

A rewind or a fork gives Droid a new session id whose transcript copies the parent's history, and
the new id has no file. So when the file is missing, the footer reads the first line of
`~/.factory/sessions/*/<sessionId>.jsonl`, follows its `parent` up the chain (a middle session that
never sent a request has no file either) until it finds a file, and uses that file's setup. An
ancestor whose file is a tombstone ends the walk with nothing shown, because its last request was
not Anthropic. The entry's time is the older of the ancestor's request and the fork's last message,
because a rewind cuts the history back to a point whose cache is only as fresh as the request that
ended there. The last message is the last transcript line that does not carry
`"visibility":"user_only"`, because Droid appends such hook records on every resume and never sends
them to the model. The fork gets no file of its own; its next live request writes one. With no
transcript, no `parent` or no ancestor file, the footer shows nothing, as before.

A changed Droid setup (`AGENTS.md`, MCP servers, the patch set, the Droid version) changes the
request bytes, so the cache misses even inside the 45 minutes. The `setup` object is the one
`move-work parity` prints. It is costly (about 0.9s of CPU, because it starts Droid and `brew`), so
a Droid process runs `echo '{}' | move-work parity` only when it first needs the answer: its first
Anthropic request, or a resumed file still inside the 45 minutes. It starts 3 seconds after that,
runs once, and the process keeps the answer. A process that never needs it never runs it.

When it runs, it also deletes every file in the folder not written for a day. Each deletion waits
behind that session's own writes, so it never removes a file a session just saved. A loaded entry
then says:

- older than 45 minutes: `cache cold`, at once, without waiting for `move-work`;
- inside the window, `move-work` still running: `cache checking`;
- inside the window, same setup: `cache 32m`, counting down like a live entry;
- inside the window, different setup: `cache cold: proxy, AGENTS.md changed` (warning colour),
  listing the differing keys in the current setup's order, except `skills`, `droids` and `commands`,
  because those lists reach the model as text in the first user message, which the transcript stores
  and replays byte for byte on resume, so editing them on disk cannot change a resumed session's
  cached prefix;
- inside the window, no fingerprint on either side (`move-work` missing, failing or printing bad
  JSON): `cache unchecked` (warning colour).

Failures go to Droid's log as `[ovrdroid] cache setup fingerprint failed`,
`cache clock write failed`, `cache clock load failed` and `cache clock prune failed`. The code is in
`src/patch/cache-clock.ts`: the runtime is installed as `globalThis.__odCacheClock` by
`cache-warm-arm` (the footer lives in another chunk and cannot see the warmer's names), and the
footer asks it to load and to tell it when to re-render. The footer chunk imports the warmer chunk
today, so the runtime exists before the first render, but the footer does not rely on it: with no
runtime it skips the resumed entry instead of throwing.

`bench` launches the binary in a real terminal three times and prints time to first paint and time
from Ctrl-C to exit. Pass a path to measure a copy, for example
`bun run bench ~/.local/bin/droid.orig`.

## Render recording

`/renders on` makes Droid record which React components render while you work; `/renders off` stops
it, and a bare `/renders` flips the setting. The command saves `renders` in
`~/.factory/ovrdroid.json`, and the change takes effect at the next Droid start. Its reply says
whether the current Droid is recording.

With the setting off, Droid runs the stock reconciler. The only extra work is one small read of
`ovrdroid.json` when the reconciler module loads. With it on, Droid runs the React profiling build
of the same reconciler (`react-reconciler` 0.33.0, vendored in `src/patch/vendor/` and pinned by its
sha256 in a test). After each commit, a small DevTools hook adds each component's renders, own time
and causes to a running total. Each Droid writes its totals for the day every minute and at exit, to
`~/.factory/ovrdroid-renders/<YYYY-MM-DD>/<pid>.json`. The profiling build is slower than stock, so
leave recording off when you do not need it.

`probe renders-log` reads those files and ranks components by own time across all processes:

```bash
bun run probe renders-log --days 7 --top 15
```

## Hooks

Two Droid hooks ship alongside the patch set. They are official extension points, so they survive
Droid updates and need no rebuild.

| Hook                  | Event          | What it does                                                     |
| :-------------------- | :------------- | :--------------------------------------------------------------- |
| `ovrdroid-execute.js` | `PreToolUse`   | Approves a delete inside a temp dir or the current repo silently |
| `ovrdroid-notify.js`  | `Notification` | Plays `awaitingInputSound` when an approval prompt appears       |

`bun run ovrdroid hooks` bundles both into `~/.factory/hooks/`. `ovrdroid update` does not run it,
so re-run it after a hook changes. Wire them up once in `~/.factory/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Execute|mcp__.*_Execute",
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/.factory/hooks/ovrdroid-execute.js"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/.factory/hooks/ovrdroid-notify.js"
          }
        ]
      }
    ]
  }
}
```

Match on the tool name only. A `commandRegex` is tested against the raw command string, which
silently skips the hook for MCP-wrapped Execute tools.

### Why the prompt is silent without the notify hook

Droid's own awaiting-input sound is unreachable code on this path. `requestConfirmationForToolUses`
takes the delegated branch whenever `context.requestPermissionFn` is set, which the TUI always sets,
and returns from there; the only call passing `playAwaitingSound:!0` sits after that return.
`AskUser` dings because it takes a different path. The `Notification` hook fires on the branch that
does run, so it plays the same sound the setting already names. Inside herdr (`HERDR_ENV` set) it
runs `herdr notification show --sound request` instead, so a remote box reaches your Mac; the
turn-end sounds from the patch set do the same with `done` and `wait`, and a custom sound name is
ignored there.

### What the execute hook approves

A delete is approved only when every one of these holds, and it prompts as normal otherwise:

- the command is a plain `rm`, with no shell metacharacters, no `..` path segment, and no
  unrecognised flags
- every path lands in one zone: inside a temp root, or inside the current repo
- no path is a symlink
- a directory target carries `-r`, and a missing target carries `-f`
- the payload names the agent's `cwd`; without it the hook passes rather than guess from its own

Repo deletes are rewritten to `/usr/bin/trash`, so they stay recoverable in the macOS Trash, and the
hook passes when that binary is missing rather than approve a command that would silently fail. Temp
deletes run as a real `rm`. Droid already exempts `/tmp` itself, via `y6H=["/tmp"]` in `Ugf`, but
nothing else: `$TMPDIR` and every repo path still prompt, which is the gap this closes.

**Every approval rewrites the command to the canonical paths it checked**, in both zones. Approving
the agent's original text would check one path and run another: `path.resolve` drops a trailing
slash, so `rm -rf link/` passes a check against the symlink itself and then deletes the contents of
whatever it points at. Rewriting binds the executed command to the inspected path, and the symlink
rule above closes the rest.

A residual race remains: an ancestor directory renamed between the check and the delete would defeat
it. Closing that needs deletion through verified directory handles, which is not worth it here.

The repo root is found by walking parents for a `.git` entry, which costs microseconds where a
`git rev-parse` subprocess costs ~13ms on every tool call. It is only looked up once a path misses
the temp zone, and the result is cached for the rest of the run.

The entry has to prove itself: a directory needs `HEAD`, `objects` and `refs` inside it, and a file
has to start with `gitdir:`, the linked-worktree form. An empty `.git` directory is not a
repository, and accepting one would hand any directory holding it an approval zone it never earned.

The root is then **discarded when it is the home directory**, or when the home directory cannot be
resolved at all. A dotfiles repo whose work tree is `$HOME` otherwise makes every path under home
look like a repo path, so `~/Downloads` would auto-approve. Paths under `.git`, and the repo root
itself, are never approved.

The `.git` check is case-insensitive, because the default macOS filesystem is: `.GIT` opens `.git`,
so a case-sensitive check would trash a repository's history without asking.

## Probing startup

`probe` is the breakdown tool that `bench` is not. Every command launches the binary in a real PTY
and answers the terminal probes Droid sends. The environment is scrubbed first: `FORCE_COLOR` plus
every `FACTORY_*`, `DROID_*` and `HERDR_*` variable is stripped, because an inherited `FORCE_COLOR`
makes Droid skip its truecolor and background-colour probes, and an inherited
`FACTORY_DISABLE_SETTINGS_PERSISTENCE` switches whole features off so a patch that defers them
measures nothing. Auto-update is forced off so a benchmark can never replace the binary under test.

A run that paints and then crashes, hangs, or exits non-zero is rejected rather than reported as a
fast time.

`probe build` rebuilds a probe binary from the stock one (default `~/.local/bin/droid.orig`) without
touching anything installed. `--trace` adds the tracing patches, and `--extra <patches.json>` adds a
JSON array of `{name, find, replace}` so you can A/B a candidate patch before committing it.

`probe trace` runs a traced binary and prints the startup timeline: start, end, duration, kind and
phase for every instrumented span.

```bash
bun run probe build --trace --out /tmp/droid-trace
bun run probe trace /tmp/droid-trace --runs 3
```

`probe modules` answers "what is this startup actually evaluating?". Build with `--modules` and it
wraps the bundle's own lazy module loader, charging each module its own evaluation time with nested
imports subtracted, then prints the costliest bodies at first paint.

```bash
bun run probe build --modules --out /tmp/droid-modules
bun run probe modules /tmp/droid-modules --top 20
```

`probe ab` interleaves runs across two or more binaries so machine noise hits all of them equally,
alternating which binary leads each round so the second position's advantage cancels, and discarding
a warm-up round. It prints min, p25, median, p75 and the raw paint times for each. Given exactly two
binaries it also prints the paired difference with a 95% confidence interval and the smallest effect
that sample count can resolve.

`probe keys` measures typing rather than startup. It waits for the input box, waits for the terminal
to go quiet, then reports two things per binary:

- **echo**: milliseconds from one keypress to the first byte back, on an idle input box, with the
  character deleted between trials so the buffer never grows.
- **lag**: milliseconds of output still arriving after the last key of a sustained burst. This is
  the number that moves when a render is too expensive to keep up with a fast typist.

Runs are interleaved and position-balanced like `probe ab`, and both metrics get their own paired
confidence interval. Echo is per keypress, so it reaches a usable sample count quickly; lag is one
sample per run and needs far more rounds before its interval means anything.

```bash
bun run probe keys /tmp/od-base /tmp/od-candidate --runs 4
```

`probe idle` measures what a Droid costs while nobody is typing, which is the number that decides
how many sessions fit on one machine. It waits for the input box, walks the whole process tree, and
reads it once at the start and once at the end of an idle window, so the probe itself adds nothing
to the window it is timing. Runs are interleaved and position-balanced like `probe ab`, and both
metrics get a paired confidence interval.

It reports **physical footprint**, not `ps` RSS. A Droid reports 350MB of RSS against a 179MB
footprint: every process maps the same 159MB binary and RSS charges each one a full copy, so summing
RSS across sessions overstates the machine's load by gigabytes. RSS stays in the output as a
diagnostic.

```bash
bun run probe idle ~/.local/bin/droid.orig ~/.local/bin/droid --runs 4 --window 45
```

`probe timers` answers "what wakes an idle Droid?". Build with `--timers` and it wraps `setInterval`
and `setTimeout`, logging every arm and every fire with the source of the callback, then groups the
fires by site. An idle Droid fires 227 wake-ups a minute; the census is what proved they are not the
idle cost.

```bash
bun run probe build --timers --out /tmp/od-timers
bun run probe timers /tmp/od-timers --window 60
```

`probe idle-cpu` profiles the window **after** paint rather than before it, and ranks the frames an
idle process is spending time in. Read it with the same care as `probe cpu`: a high inflation factor
is a stall holding someone else's time, not work.

`probe cpu` records a CPU profile of a startup, selects the profile belonging to the process it
launched (Droid spawns a second Droid, which writes its own), cuts the samples at first paint, and
ranks frames by `samples * median(sampling period)`. It prints each frame's sample count and, when
the raw delta sum disagrees with that estimate by 2x or more, an inflation factor. Rank by the
estimate and treat a high inflation factor as a frame holding someone else's stall, not as work.

`probe stream` measures the cost of a streamed reply. It points Droid at a local stub model that
streams a fixed markdown answer for free. The stub is set up through `FACTORY_RUNTIME_SETTINGS_PATH`
only, so nothing in `~/.factory` changes.

`probe resume` measures reopening a long session. It writes a deterministic 150-turn session file
for a temporary directory, resumes it, and then resizes the terminal to measure the redraw. The file
is deleted afterwards.

`probe build --counters` builds a binary that counts work instead of time: commits, frames built and
written, milliseconds inside Ink's `onRender`, root and message list renders, markdown parses and
bytes. `probe counters` runs that binary and prints the counts. Counts resolve where wall time
cannot.

```bash
bun run probe build --counters --out /tmp/od-counters
bun run probe counters /tmp/od-counters
```

`probe renders` tells which React components render and why, on any build with the shipped patch
set. It sets `OD_RENDERS` to a file, so the binary starts the profiling reconciler and writes one
line per commit: each component that rendered, its own time without its children, and the cause (its
props, its state, a context it reads, or only its parent). It drives the stream, resume and typing
scenarios and prints, for each window, the components ranked by own time, with how many renders
changed nothing but the parent. The hook knows each component by its function, not its minified
name, so two components that share a name stay two rows; across runs a component is matched by its
code. The probe finds that code among the binary's own modules and prints its place as
`chunk-x.js:line`. The rebuild drops the source maps, so places are bundle lines, not `src/...`
lines.

```bash
bun run probe renders ~/.local/bin/droid --runs 2 --scenario all
```

Read the numbers with care. This machine's load swings paint between 0.6s and 2.7s. Believe the
confidence interval `probe ab` prints, not the gap between the medians: if the interval contains
zero, the difference was not resolved.

`update` is the one you want day to day: it installs Factory's newest Droid release for this host
(darwin-arm64 or linux-x64, read from `factory-cli/LATEST`, sha256-verified, cached under
`~/.cache/ovrdroid/`, skipped when the target already runs it), then applies the patch set. The
installed Droid is replaced only once the patched build passes. When the patches do not fit the new
release yet, `update` stops with the drift list, leaves the current Droid in place, and
`.agents/skills/patching-droid-cli/UPDATING.md` takes over. Each command takes `--target <path>` and
defaults to `~/.local/bin/droid`. `apply` backs the stock binary up to `<target>.orig` before
patching.

Supported hosts are macOS arm64 and Linux x64. Patches are matched by identifier shape, so one patch
set fits both builds. `bun run probe builds` checks it against the stock newest release of every
platform (downloading and caching them); `--version <v>` checks another release instead, and it
exits non-zero on drift.

The Mac is the master: edit and commit there. Every 15 minutes the Mac pushes `main` on its own
(`ovrdroid-push` from the dotfiles), as long as the checkout is a clean `main`. When
`ovrdroid update` installs to `~/.local/bin/droid`, it writes the version it installed to
`droid-version` at the repo root. Commit that file with the patches. Each Linux host runs
`ovrdroid-sync` (from the dotfiles) every 15 minutes: it pulls `~/dev/ovrdroid` and runs
`ovrdroid sync`, which installs the pinned version and applies the patch set, and does nothing when
both are already in place. So every Linux host follows the Mac's exact Droid version within 15
minutes of a push, and never jumps to a newer release on its own. `dotfiles-sync` on the Mac runs
the same step at once. Run `probe builds` before pushing a patch change, because a patch that fits
only one platform makes that host's sync fail, and the host keeps its current Droid.

On the Mac, `update` also runs the gate (`ovrdroid gate --target <build> --stock <stock>`) on the
freshly built binary before it replaces the installed Droid: the build basics and the probes for
speed against stock, prompt cache, compaction, MCP servers, sub-agents and token cost. One failure
deletes the build and installs and pins nothing; each check's output is in
`~/.cache/ovrdroid/gate/<version>-<patch digest>/<check>.log`. A pass writes `gate-pass.json`, which
you commit with `droid-version`. The stamp records the Droid version, the patch digest and the Bun
version the build used, and covers a Droid version and a Bun version; when it already covers both,
`update` skips the gate and says so. The gate runs when `update` moves to a new Droid version.
`apply` never runs it, and a patch change needs no gate run before you push. `ovrdroid sync` refuses
a pinned version the stamp does not cover with the current Bun version.

To run it from anywhere, link the entry point onto your `PATH`:

```bash
ln -s "$PWD/src/index.ts" ~/.local/bin/ovrdroid
```

## Why

On Droid 0.245.0 (2026-10-21, `probe ab -r 12`, paired, load average 3.5 to 7), time until the real
app frame appears, with both binaries in `~/.local/bin`: stock 0.36s, patched 0.33s, so the patched
build is 25ms faster (CI 12 to 39ms). The same comparison from a scratch copy of `~/.local/bin` gave
27ms (CI 11 to 43ms). Run straight from `/tmp`, stock takes 0.73s and patched 0.34s. That gap is a
macOS cost that only shows up in a crowded directory: stock starts its settings watchers before
paint, and each `fs.watch` gets slower the more entries the binary's own directory has
([docs/startup.md](docs/startup.md)). Droid now draws a placeholder input shell at ~0.1s before that
frame; it takes keys but acts on none of them. The path there, measured on a real terminal on Droid
0.218.1, before the placeholder shell existed:

| Setup                         | Time to interactive           |
| :---------------------------- | :---------------------------- |
| Stock                         | 1.17s (up to 2.9s under load) |
| Without startup network calls | 0.72s                         |
| Patched, on Bun 1.3.14        | 0.55s                         |
| Patched, rebuilt on Bun 1.4.2 | 0.38s                         |
| Hard floor (Bun boot)         | ~0.08s                        |

The original gap was three blocking Factory API calls (`whoami`, then `feature-flags` and
`managed-settings` behind it) plus a hardcoded 150ms terminal capability probe. Those are gone. The
last step is the runtime itself, not the app.

## Where the remaining time goes

Only about 40% of the time to paint is CPU. The rest is waiting on the keychain, the terminal and
the filesystem, which caps what any CPU optimisation can win.

Module evaluation is spread thin: 184ms across **3817** modules, and the largest single body costs
9.7ms. Deferring individual modules was measured and rejected:

| Experiment                                 | Result       |
| :----------------------------------------- | :----------- |
| Lazy highlight.js language registration    | within noise |
| Deferring the tools module (zod + schemas) | within noise |
| Skipping `sandbox_ensure`                  | within noise |
| Non-blocking `ensureBuiltInDroids`         | within noise |
| Ink `maxFps` 30 to 60                      | within noise |
| Deferring resource monitor + terminal caps | within noise |
| Deleting the whole terminal probe chain    | within noise |

The terminal probes look like a 112ms serial stall and are not: replacing the entire chain with a
constant changed nothing, because the probes overlap other startup work. A phase's duration is a
bracket around what it awaits, never its cost.

The one thing that did pay inside the app was the zod v3 constructor, which was not a module to
defer but work inside a constructor that runs 15,215 times. Getting below ~600ms on Bun 1.3.14
needed the app to import less at startup, which is an upstream change, not a patch. The Bun 1.4.2
rebuild got there instead by making module loading itself cheaper. Rebuilding without `--bytecode`
was measured at 1.23s, so the bytecode cache is still carrying its weight.

## What an idle session costs

An idle session is **~540ms of CPU per minute** and **~300MB** of real memory, and the patch set is
already the largest win there: **-657ms/min** against stock (n=4, 95% CI -889 to -425), mostly from
the React production swap, because an idle Droid still renders.

Two idle experiments were measured and rejected:

| Experiment                           | Result                               |
| :----------------------------------- | :----------------------------------- |
| Slow every 1s idle poll by 10x       | within noise (n=6, CI -41.9 to +6.4) |
| Force a full GC every 10s while idle | 250ms/min **worse**, frees nothing   |

The memory that caps parallel sessions is mostly not Droid. One session is **five processes**, and
the two Droid ones are the smaller half; the `npm exec` wrapper around an MCP server costs ~77MB per
session and does nothing after startup. Pointing the MCP config at the resolved entry point removes
one process per session for an identical response. That is a config change, not a patch.

`docs/` has the full measurement record, one file per question, including how the measuring tools
were wrong the first time. Start at `docs/README.md`. For the prompt cache (what a write and a read
cost on the subscription meter, what busts the cache, and where token spend sits), start at
`docs/token-spend.md`.

## How it works

1. **Extract.** Parse the Bun module graph (trailer, offsets, module table) and read every module:
   the entry module plus its hundreds of split JS chunks, alongside the 65 sidecars (ripgrep,
   agent-browser, keytar, the Rust PTY libraries, skill assets, sounds). Offsets move every release,
   so they are always derived.
2. **Patch.** Find/replace pairs on the source text, any length, plus a marker statement on the
   entry module that records which patch set is applied. Each find must match exactly once across
   the whole app, whichever chunk it lands in. Patches are matched by identifier shape and renamed
   onto the target build first, so the same set fits macOS arm64 and Linux x64 even though their
   minified names differ. A patch may also carry `until`, which extends the replaced range through
   the first match of that string after `find`, and `lookups`, which capture outer names its
   replacement uses.
3. **Rebuild.** Download the pinned Bun release for this host (`BUILD_BUN_VERSION` in
   `src/binary/bun.ts`) once, cache it under `~/.cache/ovrdroid/`, and run
   `bun build --compile --bytecode --splitting --format=esm --minify --asset-naming=[name].[ext]`
   over the patched modules with an import preamble that re-embeds every sidecar. Chunk imports are
   rewritten from `/$bunfs/root/` paths to relative ones so the rebuild resolves them. The build
   dominates the ~4.5s apply and peaks near 1.8GB. Binaries are read with `readFileSync`, never
   memory-mapped: a writable mapping invalidates a signed binary permanently, and macOS then kills
   it on launch. Rebuilding is what keeps the bytecode cache valid: editing bytes in place
   invalidates it and Droid falls back to parsing 20MB of JavaScript, which costs more than the
   patches save.
4. **Check and sign.** Fail if any sidecar went missing, appeared, or changed a byte, then, on
   macOS, `codesign --force --sign -`. Without the signature macOS kills the process on launch.
   Linux builds are not signed.

The app finds its sidecars through hardcoded `/$bunfs/root/...` literals, one per file. Those are
never patched: `--asset-naming=[name].[ext]` makes Bun reproduce each name exactly, so the original
literals keep working.

The original binary is always backed up first, and the rebuilt one must report the same `--version`
before it is installed.

## Layers

The harness is deliberately three separate things, in increasing fragility:

1. **Plugin and hooks.** Official Factory extension points. Separate processes, survives updates, no
   patching. Covers subagents, commands, and lifecycle.
2. **Extracted bundle plus `--preload`.** A development tool for iterating on a patch. Runs 4x
   slower because it loses bytecode, so it is not for daily use.
3. **Patched binary.** What you actually run. Breaks on every Droid update and must be re-applied.

## Setup

```bash
bun install
bun run verify
```

## Safety

- A patched binary blocks its own auto-update, so an update can no longer replace it silently. The
  header of the next session says `↓ v0.219.0 available · run ovrdroid update` instead.
  `ovrdroid update` installs that release once the patch set fits it.
- Never patch `~/.local/bin/droid` in place without a backup.
- Test on a copy first.
