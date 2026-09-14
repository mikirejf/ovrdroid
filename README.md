# overdroid

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

| Patch                                  | What it changes                                                | Why                                                                                                                                |
| :------------------------------------- | :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `kitty-probe-timeout`                  | 150ms probe wait to 30ms                                       | Ghostty answers the terminal probe in a few ms.                                                                                    |
| `whoami-no-block`                      | Drops the `await` on `whoami`                                  | The call costs 450-800ms and gates feature flags and org settings, which already fall back to their disk caches.                   |
| `certificate-count-skip`               | Skips the cert count                                           | It spawns three shell pipelines just to validate a cache that has a 7-day TTL.                                                     |
| `shutdown-flush-deadline`              | 1000ms flush deadline to 10ms                                  | Exit waits the whole deadline for telemetry flushes that never finish in time anyway.                                              |
| `session-search-warm-skip`             | Skips the session-search cache warm                            | It scans every saved session at startup, before the input box is up, to prime a search nobody has typed yet.                       |
| `zod-v3-lazy-bound-methods`            | Binds zod schema methods on first use, not in the constructor  | The zod v3 constructor runs 24 `.bind(this)` calls per schema, and 15,215 schemas exist before the input box appears.              |
| `model-alias-lookup-set`               | Model alias lookup scans a Set                                 | It rebuilt an array with `Object.values` and scanned it linearly, once per model id, inside a render that runs on every keystroke. |
| `ink-string-width-grapheme-memo`       | Ink's width scan memoises per grapheme                         | Ink's cache keys on the whole line, so one new character misses it and re-measures every grapheme again.                           |
| `ink-string-width-grapheme-memo-init`  | Adds the two grapheme maps Ink's memo reads                    | The memo needs its narrow and wide maps created when the module is evaluated.                                                      |
| `app-display-width-grapheme-memo`      | `displayWidth` memoises per grapheme                           | The app measures width separately from Ink and paid the same per-grapheme cost on every keystroke.                                 |
| `app-display-width-grapheme-memo-init` | Adds the two grapheme maps `displayWidth` reads                | Same as Ink's: the maps are created at module evaluation.                                                                          |
| `turn-clock-state`                     | Adds the turn clock's state and its duration formatter         | The footer needs somewhere to remember when the last turn started and ended.                                                       |
| `turn-clock-track`                     | Records the times as the session goes busy and idle            | The footer already re-renders on every status change, so the two edges are free to observe.                                        |
| `turn-clock-parts`                     | Adds `↑sent ↓received` to the footer                           | Shows how long ago the last prompt went out and the last reply landed.                                                             |
| `auto-update-notice-only`              | Stops the update at the check and reports it as available      | An auto-update silently replaces the patched binary with a stock one, so blocking it is what keeps every other patch applied.      |
| `update-notice-command`                | Adds `run: overdroid update` to the update notice              | The notice has to name the command that now does the updating.                                                                     |
| `draft-dismiss-no-rerender`            | Skips the no-op `draft-edited` dispatch                        | The reducer returned the same state, but React still re-ran the root component for every keystroke.                                |
| `react-production`                     | Swaps React for its production build                           | Droid ships React's development build, whose hook checks and invariants run on every render.                                       |
| `react-reconciler-production`          | Swaps the reconciler and scheduler for their production builds | Same reason, and the reconciler is the largest share of typing CPU.                                                                |
| `react-jsx-runtime-production`         | Swaps the JSX runtime for its production build                 | The dev runtime validates and records a stack for every element it creates.                                                        |

```bash
bun run overdroid update
bun run overdroid status
bun run overdroid apply
bun run overdroid apply --dev-react
bun run overdroid restore
```

`--dev-react` keeps React's development build, which is slower but keeps the full DevTools
diagnostics: component and owner stacks, hook checks and readable error messages.

## The turn clock

The footer gains `↑7m ↓5m`: how long ago the last prompt was sent, and how long ago the reply
finished.

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

`bench` launches the binary in a real terminal three times and prints time to first paint and time
from Ctrl-C to exit. Pass a path to measure a copy, for example
`bun run bench ~/.local/bin/droid.orig`.

## Hooks

Two Droid hooks ship alongside the patch set. They are official extension points, so they survive
Droid updates and need no rebuild.

| Hook                   | Event          | What it does                                                     |
| :--------------------- | :------------- | :--------------------------------------------------------------- |
| `overdroid-execute.js` | `PreToolUse`   | Approves a delete inside a temp dir or the current repo silently |
| `overdroid-notify.js`  | `Notification` | Plays `awaitingInputSound` when an approval prompt appears       |

`bun run overdroid hooks` bundles both into `~/.factory/hooks/`, and `overdroid update` re-runs it
so the installed copies never drift from the source. Wire them up once in
`~/.factory/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Execute|mcp__.*_Execute",
        "hooks": [{ "type": "command", "command": "bun ~/.factory/hooks/overdroid-execute.js" }]
      }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "bun ~/.factory/hooks/overdroid-notify.js" }] }
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
does run, so it plays the same sound the setting already names.

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

`probe cpu` records a CPU profile of a startup, selects the profile belonging to the process it
launched (Droid spawns a second Droid, which writes its own), cuts the samples at first paint, and
ranks frames by `samples * median(sampling period)`. It prints each frame's sample count and, when
the raw delta sum disagrees with that estimate by 2x or more, an inflation factor. Rank by the
estimate and treat a high inflation factor as a frame holding someone else's stall, not as work.

Read the numbers with care. This machine's load swings paint between 0.6s and 2.7s. Believe the
confidence interval `probe ab` prints, not the gap between the medians: if the interval contains
zero, the difference was not resolved.

`update` is the one you want day to day: it runs `droid update`, then applies the patch set if the
binary is stock. Each command takes `--target <path>` and defaults to `~/.local/bin/droid`. `apply`
backs the stock binary up to `<target>.orig` before patching.

To run it from anywhere, link the entry point onto your `PATH`:

```bash
ln -s "$PWD/src/index.ts" ~/.local/bin/overdroid
```

## Why

Measured on a real terminal, time until the input box appears:

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

`FINDINGS.md` has the full measurement record, including how the measuring tools were wrong the
first time.

## How it works

1. **Extract.** Parse the Bun module graph (trailer, offsets, module table) and read every module:
   the app source plus 35 sidecars (ripgrep, agent-browser, keytar, the Rust PTY libraries, skill
   assets, sounds). Offsets move every release, so they are always derived.
2. **Patch.** Literal find/replace pairs on the source text, any length, plus a marker statement
   that records which patch set is applied. A patch may also carry `until`, which extends the
   replaced range through the first match of that string after `find`. The React production patches
   are built from tarballs fetched from the npm registry at pinned versions, cached under
   `~/.cache/overdroid/react`, so they are never read from `node_modules`.
3. **Rebuild.** Download the pinned Bun release (`BUILD_BUN_VERSION` in `src/binary/bun.ts`) once,
   cache it under `~/.cache/overdroid/`, and run
   `bun build --compile --bytecode --minify --asset-naming=[name].[ext]` over the patched source
   with an import preamble that re-embeds every sidecar. The build dominates the ~4.5s apply and
   peaks near 1.8GB. Binaries are read with `readFileSync`, never memory-mapped: a writable mapping
   invalidates a signed binary permanently, and macOS then kills it on launch. Rebuilding is what
   keeps the bytecode cache valid: editing bytes in place invalidates it and Droid falls back to
   parsing 20MB of JavaScript, which costs more than the patches save.
4. **Check and sign.** Fail if any sidecar went missing, appeared, or changed a byte, then
   `codesign --force --sign -`. Without the signature macOS kills the process on launch.

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
  footer says `v0.219.0 available · run: overdroid update` instead, and `overdroid update` installs
  it and re-applies the patch set.
- Never patch `~/.local/bin/droid` in place without a backup.
- Test on a copy first.
