# Startup: time to paint

Measured on Droid 0.218.1, Bun 1.3.14, an M-series Mac, 2026-09-13 and 2026-09-14. Time to paint is
the moment the input box border appears in a real PTY. The zod constructor fix has its own file,
[zod.md](zod.md).

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

## Shipped: `settings-watch-after-paint`, 89ms

`SettingsManager.enableWatching()` ran before paint. It walks seven collections of settings sources
and calls `startWatching()` on each, and each one creates `fs.watch` handles and crawls its tree.
That crawl was 93.7ms of CPU before paint, the largest pre-paint item.

The patch sets the `watchingEnabled` flag at once and moves only the `startWatching()` calls into a
400ms timer:

```js
enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,
```

Paint fell by **89.2ms**, n=30 paired, CI -110.5 to -67.9.

Three details make it correct:

1. **The flag is set at once.** Sources read the flag when they are built:
   `this.folderFactory(this.folderPath, this.watchingEnabled)`, and the constructor starts watching
   only if that flag is true. Sources are built lazily, so a patch that leaves the flag false during
   startup creates sources that never watch. Three earlier attempts broke on this.
2. **The `$ow()` guard.** `disableWatching()` can run inside the 400ms window
   (`McpService.withTargetedOperation`, `stopWatching()`, `resetInstance()`). Without the guard the
   timer fires afterwards and starts every watcher again.
3. **`.unref?.()`.** The timer must not hold the event loop open, or a short command waits for it.
   `--version` still exits in 0.15s.

The attempts that failed:

| Attempt                                           | Paint                   | Behaviour |
| :------------------------------------------------ | :---------------------- | :-------- |
| `setTimeout(...,0)` around the call               | not resolved            | fine      |
| Hold a closure, release it at `first_paint`       | watcher still pre-paint | fine      |
| Hold a closure, release it at `input_mounted`     | watcher still pre-paint | broken    |
| Set the flag, defer only the starts (**shipped**) | **-89.2ms**             | verified  |

Behaviour test: create `~/.factory/commands/<name>.md` after paint, open the slash menu, and require
the new command's description to appear. Getting that test to fail on stock first took four fixes:
use the real profile (a fresh `HOME` lands on the login screen), pace keys ~40ms apart, use a short
name (the menu filters fuzzily), and match the description rather than the typed name, which the
input box echoes.

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
- The 400ms watcher delay measured well but was never tuned. On a machine where paint lands after
  400ms, the crawl lands back before paint, so the patch falls back to stock speed.
- Re-run `defer-cloud-session-defaults` in a clean environment.
- The 64ms untraced gap at 392 to 457ms has no known owner.
- Re-measure against an empty `~/.factory/sessions` to split the fixed cost from the part that grows
  with session count.
- The harness answers four terminal queries, but stock 0.218.1 sent three. The DCS truecolor query
  is skipped when `COLORTERM=truecolor` is inherited, so a clean environment may add a probe.
