# overdroid

A patch harness for the [Droid CLI](https://docs.factory.ai/droid-cli/overview).

Droid ships as a Bun standalone binary with its application source and precompiled bytecode embedded
in a module graph. This project extracts that source, patches it, rebuilds it with the same Bun
release Droid embeds, and transplants the result back into the binary.

Measured on Droid 0.218.1 with `bun run bench`: time to first paint drops from 1.23s to 0.68s, and
exit from 1.09s to 0.07s. The zod patch removes a further 68-79ms of CPU before first paint,
measured inside the process because this machine's wall-clock noise is larger than the effect.

Status: the harness applies the patch set below.

| Patch                       | What it changes                                               | Why                                                                                                                   |
| :-------------------------- | :------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------- |
| `kitty-probe-timeout`       | 150ms probe wait to 30ms                                      | Ghostty answers the terminal probe in a few ms.                                                                       |
| `whoami-no-block`           | Drops the `await` on `whoami`                                 | The call costs 450-800ms and gates feature flags and org settings, which already fall back to their disk caches.      |
| `certificate-count-skip`    | Skips the cert count                                          | It spawns three shell pipelines just to validate a cache that has a 7-day TTL.                                        |
| `shutdown-flush-deadline`   | 1000ms flush deadline to 10ms                                 | Exit waits the whole deadline for telemetry flushes that never finish in time anyway.                                 |
| `session-search-warm-skip`  | Skips the session-search cache warm                           | It scans every saved session at startup, before the input box is up, to prime a search nobody has typed yet.          |
| `zod-v3-lazy-bound-methods` | Binds zod schema methods on first use, not in the constructor | The zod v3 constructor runs 24 `.bind(this)` calls per schema, and 15,215 schemas exist before the input box appears. |

```bash
bun run overdroid update
bun run overdroid status
bun run overdroid apply
bun run overdroid restore
```

`bench` launches the binary in a real terminal three times and prints time to first paint and time
from Ctrl-C to exit. Pass a path to measure a copy, for example
`bun run bench ~/.local/bin/droid.orig`.

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
| Patched                       | 0.68s                         |
| Hard floor (Bun boot)         | ~0.08s                        |

The original gap was three blocking Factory API calls (`whoami`, then `feature-flags` and
`managed-settings` behind it) plus a hardcoded 150ms terminal capability probe. Those are gone.

## Where the remaining 0.68s goes

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

The one thing that did pay was the zod v3 constructor, which was not a module to defer but work
inside a constructor that runs 15,215 times. Getting much below that needs the app to import less at
startup, which is an upstream change. Rebuilding without `--bytecode` was measured at 1.23s, so the
bytecode cache is already carrying its weight.

`FINDINGS.md` has the full measurement record, including how the measuring tools were wrong the
first time.

## How it works

1. **Extract.** Parse the Bun module graph (trailer, offsets, module table) and read the entry
   record's source region. Offsets move every release, so they are always derived.
2. **Patch.** Literal find/replace pairs on the source text, any length, plus a marker statement
   that records which patch set is applied.
3. **Rebuild.** Download the exact Bun release the binary embeds (1.3.14 for Droid 0.218.1) and run
   `bun build --compile --bytecode --minify`. This takes ~11s and ~3GB of RAM. Rebuilding is what
   keeps the bytecode cache valid: editing bytes in place invalidates it and Droid falls back to
   parsing 20MB of JavaScript, which costs more than the patches save.
4. **Transplant and re-sign.** Write the rebuilt source, bytecode and module_info back into their
   original slots, update the three length fields, then `codesign --force --sign -`. Without the
   signature macOS kills the process on launch.

The original binary is always backed up first, and the patched one must report the same `--version`
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

- Droid auto-updates and will silently replace a patched binary. Disable it in
  `~/.factory/update-policy.json` before relying on a patch.
- Never patch `~/.local/bin/droid` in place without a backup.
- Test on a copy first.
