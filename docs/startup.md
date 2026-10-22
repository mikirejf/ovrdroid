# Startup: time to paint

Measured on Droid 0.218.1, Bun 1.3.14, an M-series Mac, 2026-09-13 and 2026-09-14. Time to paint is
the moment the input box border appears in a real PTY. The zod constructor fix has its own file,
[zod.md](zod.md).

The sections below were measured on 0.218.1 with a paint marker that matches the early input shell
(next section on 0.245.0). Treat their absolute times as old; the deltas between variants still
stand.

## The early input shell and the real app frame

Droid 0.245.0 draws an early input shell (`startEarlyInputShell`, startup boundary `shell_paint`)
about 80 to 100ms after spawn: logo, tip and an input box with its `╰` bottom border, no footer,
written without synchronized output. The real app frame arrives later and is the first output that
contains `\e[?2026h` (synchronized output start). The shell is off under `--resume`.

Until 2026-10-21 `probe ab` and every probe that waits for paint matched `╰`, so they timed the
shell. A startup regression anywhere after ~100ms was invisible to `ab`, and probes that type at
paint typed into the shell. `paintDetector` in `src/probe/launch.ts` now reports paint only once a
`\e[?2026h` has been seen and a `╰` follows it (same chunk or later; the sync start can arrive in a
chunk of its own).

`probe ab` on 2026-10-21, Droid 0.245.0, time to the real app frame in ms, paired and interleaved,
load average 3.5 to 7 (22 other Droid sessions open):

| Where the binaries sit                             | n   | Stock median | Patched median | Patched - stock, paired       |
| -------------------------------------------------- | --- | -----------: | -------------: | ----------------------------- |
| `~/.local/bin` (`droid.orig`, `droid`), 79 entries | 12  |          363 |            333 | -25.5ms, CI -38.6 to -12.3    |
| `/tmp/odbin`, a copy of `~/.local/bin`'s names     | 12  |          357 |            333 | -27.1ms, CI -42.9 to -11.2    |
| `/tmp` itself, 3480 entries                        | 10  |          731 |            335 | -402.7ms, CI -417.6 to -387.7 |

The installed `~/.local/bin/droid` was an older patch digest (watchers on a 400ms timer); the
`/tmp/odbin` and `/tmp` rows use the current build (`settings-watch-after-paint`). Stock is a copy
of `/tmp/droid-test.orig`, byte-identical to `~/.local/bin/droid.orig`. Where users run Droid, the
patched build gains ~25ms. The ~400ms gap in `/tmp` is stock's pre-paint watcher crawl run from a
crowded directory (next section); the patched build moves that crawl after paint, so it does not
care where it sits. Quit time shows the same effect: from `/tmp`, patched quit 109ms faster (CI 38
to 180); from `~/.local/bin` the difference was not resolved.

An earlier table here (`-r 8`, stock 762, patched 332) was taken from `/tmp` and overstated the gain
by about 16 times.

## The binary's directory sets the price of every `fs.watch`

On macOS each `FSEventStreamStart` costs time in proportion to the number of entries in the
directory holding the **running executable**. The watched paths and the working directory make no
difference, and a symlink costs what its target's directory costs. Measured 2026-10-21, Darwin
24.6.0, 60 watches on plain files, ms per call:

| Executable's directory | Entries | Bun 1.4.2/1.4.3 `fs.watch` | C `FSEventStreamStart`+`Stop` |
| ---------------------- | ------: | -------------------------: | ----------------------------: |
| `/tmp/odw/sub`         |       1 |                       0.45 |                          0.35 |
| `/tmp/odw/n1500`       |    1500 |                        1.7 |                             - |
| `/tmp/odw/n3400`       |    3400 |                        2.9 |                           3.2 |
| `/tmp/odw/n6000`       |    6000 |                    4.3-5.2 |                       5.0-5.8 |
| `/tmp`                 |    3480 |                        4.1 |                       4.6-5.0 |

The cost is linear in the entry count; an earlier note that it was not monotonic did not hold up. A
30-line C client shows the same scaling, so the cost sits in `fseventsd`, not Bun. Bun makes it
worse: `FSEventsLoop::schedule` rebuilds the whole stream for every new watcher and holds the loop
mutex through `FSEventStreamStart`, so N synchronous `fs.watch` calls wait for N restarts in a row
(`sample` shows the JS thread in `os_unfair_lock_lock_slow` while the CF thread sits in
`FSEventStreamStart` -> `f2d_register_rpc`). Stock's ~110-path crawl therefore costs ~60ms from a
small directory and ~400ms from `/tmp`. A Bun issue draft is in `/tmp/bun-fswatch-issue.md`, not
filed.

Measure startup with both binaries in the same directory, and in a small one or `~/.local/bin`.
`probe typing-start` copies both into one fresh scratch directory for this reason. `probe ab`
measures binaries where they are, so pass it two paths in the same directory.

## Probe sessions start only once Droid has loaded the org policy

Every probe that launches Droid waits for its ledger's SessionStart (or SessionEnd) hook before it
presses Ctrl-C, so it can delete the session afterwards. Droid paints first, and only then starts
the agent that creates the session: `connectOnce` in the in-process agent host awaits
`waitForOrgSettingsHydration`, which fetches the organization policy from the Factory API with a 15s
timeout (`JC=15000` on 0.245.0). The hook fires ~20ms after
`[Daemon] Hosting Droid agent in process` in every run logged.

So how late the hook arrives depends on the network, not on the machine or the binary's directory.
On 2026-10-21 it arrived 0.5 to 1.2s after spawn in good spells and 2 to 17s in bad ones, with Droid
logging changelog and feature-flag `TimeoutError`s at the same moments. With every Factory request
sent to a proxy that accepts and never answers, it arrived at 17.3s after spawn in 4 of 4 runs,
stock and patched alike. The probe used to give up at 15s and failed with "Droid ran neither the
probe's SessionStart nor its SessionEnd hook within 15000ms". Every `probe ab` failure reported that
day was this, whichever binary or directory it named: the same pairs passed when re-run in a good
spell. `START_HOOK_BOUND_MS` is now 30s, and `probe ab` passes against the dead proxy. The first
keypress after paint was slow on the patched build at the time: four runs per build of the
`measureTails` press sequence, started 700ms after paint, put the first echo's first byte at 6 to
60ms on stock (last byte up to 195ms) and 188 to 462ms on the patched build (every run), against 2
to 14ms for every later key. The cause was the 400ms watcher timer, and
[`settings-watch-after-paint`](#shipped-settings-watch-after-paint) now starts the watchers at the
app frame instead (see there for the cause and the new readings). The first echo trial keeps its
700ms quiet window.

## Summary

- Stock paints in ~600ms on a quiet machine. The two largest shipped startup wins are the settings
  watcher delay (89ms) and the zod fix (47 to 80ms).
- The pinned newer Bun build is worth more than either (173ms, see `AGENTS.md`).
- Only ~40% of time to paint is CPU. The rest is waiting on the keychain and file I/O. No CPU
  optimisation touches that 60%.
- Several things that look like big costs in Droid's own trace are not costs at all. Stub before you
  believe a phase duration ([method.md](method.md)).

## CPU against waiting

From `probe cpu` on stock, cut at paint: 1420 samples at a 0.41ms median period, 587.9ms of CPU in a
1400.8ms window. So roughly 40% of the time to paint is CPU.

## Shipped: `settings-watch-after-paint`

`SettingsManager.enableWatching()` ran before paint. It walks seven collections of settings sources
and calls `startWatching()` on each, and each one creates `fs.watch` handles and crawls its tree
(chokidar, one handle per skill folder and command file, ~110 paths on this host). The crawl is one
synchronous burst: 93.7ms of CPU on 0.218.1, the largest pre-paint item, 50 to 100ms on 0.245.0, and
~400ms when the binary sits directly in `/tmp`
([the binary's directory](#the-binarys-directory-sets-the-price-of-every-fswatch)).

The patch sets the `watchingEnabled` flag at once and defers only the `startWatching()` calls until
the app's first frame has reached the terminal. Three patches share two globals:

```js
// chunk with SettingsManager (cqh3epz0 on 0.245.0)
enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0;let $ODgen=this.$ODgen=(this.$ODgen??0)+1,$ODdone=!1,$ODgo=()=>{if($ODdone||this.$ODgen!==$ODgen)return;$ODdone=!0,this.$ODwatch()};if(globalThis.$ODpainted)return $ODgo();(globalThis.$ODafterPaint??=[]).push($ODgo),setTimeout($ODgo,2500).unref?.()}$ODwatch(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,
// early input shell, where it hands the terminal to the app (31wcg22t)
n=r.write(`${je.SYNC_OUTPUT_START}${t}${e}${je.SYNC_OUTPUT_END}`);if(!globalThis.$ODpainted)globalThis.$ODpainted=!0,setTimeout(()=>{for(let $ODgo of globalThis.$ODafterPaint?.splice(0)??[])$ODgo()},0);if(d=!1,s=0,m=!0,
// Ink, for runs without the shell such as --resume (a2jqw7fx)
renderInteractiveFrame(e,i,l,r){if(this.options.stdout===process.stdout)if(!globalThis.$ODpainted)...;let E=l!=="",
```

**Where "painted" is.** With the early shell, Ink renders into the shell's `PassThrough`
(`prepareForAppRender`), not the terminal. The shell buffers those frames and writes the app's first
whole frame itself, wrapped in `\e[?2026h`, once the app has committed (`markAppRenderCommitted`)
and caught up with the draft; that `r.write` is what the terminal sees as the app frame. Ink's
`renderInteractiveFrame` runs ~110 to 190ms earlier, into the buffer (logged 2026-10-21: first Ink
frame at 45977ms, terminal sync frame at 46118ms), so hooking Ink alone starts the crawl before
paint. The Ink hook therefore fires only when Ink writes to the real `process.stdout`. Starts are
drained on a zero timer, after the frame write. A run that never paints (`droid exec`) starts them
at the 2.5s fallback.

Four details make it correct:

1. **The flag is set at once.** Sources read the flag when they are built:
   `this.folderFactory(this.folderPath, this.watchingEnabled)`, and the constructor starts watching
   only if that flag is true. Sources are built lazily, so a patch that leaves the flag false during
   startup creates sources that never watch. Three earlier attempts broke on this.
2. **The `$ODwatch()` guard and the generation.** `disableWatching()` can run before paint
   (`McpService.withTargetedOperation`, `stopWatching()`, `resetInstance()`). The guard keeps a
   disabled manager stopped; the per-call generation means a disable and enable before paint starts
   the watchers once, not once per closure.
3. **After paint, start at once.** A manager enabled after paint starts immediately, as stock does.
   This is what the 400ms timer got wrong (next section).
4. **`.unref?.()`.** The fallback timer must not hold the event loop open. `--version` exits in
   0.10s.

### Why the watchers started twice with the 400ms timer

Logged on 2026-10-21 with stack traces (`startWatching`/`stopWatching` of the settings folder,
`enableWatching`, `disableWatching`): a second `SettingsManager` is created after paint
(`initializeWithManager` from `_createSessionImpl`) and enabled at once, and ~5ms later plugin sync
calls `refresh({scope:"paths"})` (`refreshSettingsForSync`), which `reset()`s the first manager's
sources. Folders are shared per path with a subscriber set and stop when the last subscriber leaves.
On stock the second manager's sources already subscribe, so `~/.factory` stays up. With the 400ms
timer the second manager's starts were deferred, so `~/.factory` lost its last subscriber, stopped,
and was rebuilt with a full second crawl, and the second manager's own deferred starts ran 400ms
later, right where the first key after paint lands. Starting at once after paint makes the log match
stock: `~/.factory` starts once. Stock itself re-crawls the agent folders (`~/.agents`, 106 files,
and the repo's `.agents`) after that `refresh`; that is stock behaviour and is left alone.

### Readings, 2026-10-21

Droid 0.245.0, all binaries in `/tmp/odfix/` (stock copied from `/tmp/droid-test.orig`, fixed and
the 400ms build from `probe build`), interleaved, app paint = `? for help` on screen, ms from spawn:

| Typing during startup | n   | Stock median | Fixed median | Fixed - stock, paired          |
| --------------------- | --- | -----------: | -----------: | ------------------------------ |
| none                  | 10  |          346 |          336 | -12.6ms, CI -16.6 to -8.6      |
| a key every 25ms      | 9   |          765 |          746 | -14.1ms, CI -37.2 to 9.0 (n/s) |
| a key every 100ms     | 20  |          678 |          448 | -166.9ms, CI -263.3 to -70.6   |

Typing paint is dominated by the shell's input-idle gate (500ms after the first key), not the
watchers; the 100ms row is bimodal on both builds. The 400ms build read 737 (25ms) and 333 (none).
With the binaries directly in `/tmp`, no typing, n=5: stock 716 to 745, fixed 328 to 342, so the
~700ms stock figure in `probe ab` against `/tmp/droid-test.orig` is mostly the `/tmp` crawl cost.

CPU profile of a 25ms typing run (`BUN_OPTIONS=--cpu-prof`, n=2 per build): fixed has no
`_watchWithNodeFs` samples before paint (69 and 95 after); stock has 32 and 44 before paint (115 to
197ms); the 400ms build has 30 and 40 before paint (481 to 554ms).

First keypress after paint (`measureTails`, 700ms quiet then one key, n=5): from `/tmp/odfix/`, the
first echo's first byte took 3 to 11ms on stock and 3 to 8ms on fixed. From `/tmp` directly, where
each crawl costs ~400ms: stock 6 to 89ms, fixed 7 to 39ms in three runs and 365 and 471ms in two,
the 400ms build 347 to 614ms in every run. The residual in `/tmp` is the moved crawl plus stock's
agent re-crawl both landing after paint.

Behaviour test: with `FACTORY_HOME_OVERRIDE` pointing at a scratch home (copy of `settings.json`,
the `auth.v2.*` files linked), create `.factory/commands/zq.md` 1.5s after paint, type `/zq`, and
require its description in the menu. Fixed and stock pass; a build whose `enableWatching` returns
early fails. The logging build showed one settings-folder start. Getting the test to fail on stock
first, on 0.218.1, took four fixes: a real profile (a fresh home lands on the login screen), keys
~40ms apart, a short name (the menu filters fuzzily), and matching the description rather than the
typed name, which the input box echoes.

The attempts that failed:

| Attempt                                         | Paint                   | Behaviour |
| :---------------------------------------------- | :---------------------- | :-------- |
| `setTimeout(...,0)` around the call             | not resolved            | fine      |
| Hold a closure, release it at `first_paint`     | watcher still pre-paint | fine      |
| Hold a closure, release it at `input_mounted`   | watcher still pre-paint | broken    |
| Set the flag, defer the starts 400ms            | -89.2ms on 0.218.1      | verified  |
| Release at Ink's first `renderInteractiveFrame` | crawl still pre-paint   | fine      |

The 400ms timer shipped until 2026-10-21. It fired inside the typing window (the shell holds
deferred startup until input is idle) and deferred the post-paint second manager, causing the double
start above.

## Where the CPU goes before paint

From the same profile split at paint (paint at 1017ms on a loaded run):

| Frame                                  |    CPU | What it is                                      |
| :------------------------------------- | -----: | :---------------------------------------------- |
| `watch` / `FSWatcher` under `fs/watch` | 93.7ms | Settings watcher crawl, now moved after paint   |
| `spawnSync` under `commandExists`      | 18.3ms | A blocking `which` probe                        |
| `memoryUsage`                          | 10.4ms | Repeated `process.memoryUsage()` calls          |
| `Collator`                             |  9.3ms | Intl collator construction                      |
| Zod schema construction                |  7.9ms | What is left after the zod fix                  |
| `JSON.parse` under `loadFromDisk`      |  6.8ms | Parsing the session index (4.67MB on this host) |

After paint and before the first key, 179.5ms of CPU runs. The largest items are the session-index
scan (`readdirSync` under `refresh`, 28.8ms over 13,174 session files) and its buffers (15.8ms).
That scan already runs after paint, so deferring it gains nothing.

Every startup number here was taken on a machine with 13,174 sessions in 504 directories. The
session-index share grows with that count.

## Module evaluation

3817 modules evaluate before paint, for 184 to 205ms in total. 3779 of them cost under 1ms each and
add up to ~89ms. The largest single body is 9.7ms (highlight.js registering languages). No single
module in the tail is worth touching. Only shipping fewer modules moves it, and that is upstream.

The first pass reported 153ms across 156 modules, because the dump dropped every body at or under
0.2ms.

## Null: the settings phases are not work

`settings_local` lasts 121ms, but it only brackets awaits: credentials storage, keytar, dotenv and
telemetry init, plus the terminal probes and the keychain read nested inside it.

| Test                                   | Result           | Meaning                          |
| :------------------------------------- | :--------------- | :------------------------------- |
| Run from depth 18 against depth 2      | -2ms, CI -26..22 | Folder depth does not matter     |
| `FACTORY_AIRGAP_ENABLED=true`          | 12ms, CI -4..28  | Network is already off this path |
| Folder-discovery walk deleted entirely | -3ms, CI -14..7  | The walk costs nothing           |

The walk stops at the Git root and only `stat`s `.factory`, `.agents` and `.agent` at each level.

## Null: the terminal probes are not on the critical path

The truecolor probe, the kitty probe and terminal-appearance detection run in series, and render
awaits the end of that chain. That reads like a 112ms stall. Replacing the whole chain with a
constant made paint **15.8ms slower** (n=14, CI 2.3 to 29.3), so the chain overlaps other work. Only
`kitty-probe-timeout` matters here, because a timeout fires when the terminal sends no reply.

## Small experiments

Measured before the leaked-environment fix ([method.md](method.md)), 72 samples per arm, control is
the patch set of that time:

| Experiment                             | Saving | Verdict               |
| :------------------------------------- | -----: | :-------------------- |
| `lazy-highlight-languages`             |   12ms | real, small, not kept |
| `skip-sandbox-ensure`                  |   11ms | real, small, not kept |
| `ensure-built-in-droids-no-block`      |    3ms | noise                 |
| `ink-maxfps-60`                        |    0ms | noise                 |
| `defer-resource-monitor-terminal-caps` |   -1ms | noise                 |
| `defer-tools-module`                   |   -5ms | noise                 |
| `defer-cloud-session-defaults`         |   -5ms | void: env disabled it |

`defer-cloud-session-defaults` is void. The leaked `FACTORY_DISABLE_SETTINGS_PERSISTENCE=true` made
that code return before doing any work, so the experiment could only ever measure zero.

## Open items

- A residual ~44ms of `fs.watch` still runs before paint with the watcher patch, so at least one
  watcher starts outside `enableWatching`.
- `commandExists` runs a blocking `spawnSync("which", ...)` before paint for 18.3ms. `Bun.which` or
  a cached lookup would remove it.
- Re-run `defer-cloud-session-defaults` in a clean environment.
- The 64ms untraced gap at 392 to 457ms has no known owner.
- Re-measure against an empty `~/.factory/sessions` to split the fixed cost from the part that grows
  with session count.
- The harness answers four terminal queries, but stock 0.218.1 sent three. The DCS truecolor query
  is skipped when `COLORTERM=truecolor` is inherited, so a clean environment may add a probe.

## Typing during startup: `probe typing-start`

`probe typing-start [-r N] [--gaps 25,100] <stock> <target>` answers whether keys typed while Droid
starts delay the real app frame. Droid's early input shell holds deferred startup work back until
input is idle (100ms quiet, capped 500ms after the first key), so a patch that moves work to after
paint can land that work in the typing window. `probe ab` never types and cannot see it.

Each run spawns the build, waits for the shell's input box (first `╰`, no sync frame), writes `/`
then backspace every gap ms until the app frame (`paintDetector`), then exits as `launch` does. It
reports shell paint and app paint in ms from spawn and how many key pairs were typed. Runs are
paired and interleaved per gap; the probe fails when the target is slower than stock with
confidence, Bonferroni-corrected across the gaps. It also fails if the app never paints within 20s
or paints with no shell to type into.

Both binaries are copied into one fresh scratch directory under the temp dir and measured from
there: each `fs.watch` costs in proportion to the entries in the binary's directory (~10 times more
directly in `/tmp` than in a small one), so measuring the two from different directories would bias
the comparison. The copies are deleted afterwards.

First reading, 2026-10-21, Droid 0.245.0, `-r 4`, stock `/tmp/droid-test.orig` against the patched
`/tmp/droid-test` (the build at the time, not a verdict on any patch):

| Gap   | Stock app paint (median) | Patched (median) | Paired difference                 |
| ----- | -----------------------: | ---------------: | --------------------------------- |
| 25ms  |                    786ms |            767ms | -21.1ms, CI -41.2 to -1.1         |
| 100ms |                    477ms |            623ms | +57.5ms, CI -496.2 to 611.1 (n/s) |

At 100ms the gap sits on the idle threshold, so app paint is bimodal: some runs paint at ~370ms (the
quiet window opened between two keys) and others at 600 to 800ms. Both builds do this, so a 100ms
reading needs many more runs than four to resolve anything below a few hundred ms.
