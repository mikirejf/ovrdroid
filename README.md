# overdroid

A patch harness for the [Droid CLI](https://docs.factory.ai/droid-cli/overview).

Droid ships as a Bun standalone binary with its application source and precompiled bytecode embedded
in a module graph. This project extracts that source, patches it, rebuilds it with the same Bun
release Droid embeds, and transplants the result back into the binary.

Measured on Droid 0.218.1 with `bun run bench`: time to first paint drops from 1.23s to 0.68s, and
exit from 1.09s to 0.07s.

Status: the harness applies the patch set below.

| Patch                     | What it changes               | Why                                                                                                              |
| :------------------------ | :---------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `kitty-probe-timeout`     | 150ms probe wait to 30ms      | Ghostty answers the terminal probe in a few ms.                                                                  |
| `whoami-no-block`         | Drops the `await` on `whoami` | The call costs 450-800ms and gates feature flags and org settings, which already fall back to their disk caches. |
| `certificate-count-skip`  | Skips the cert count          | It spawns three shell pipelines just to validate a cache that has a 7-day TTL.                                   |
| `shutdown-flush-deadline` | 1000ms flush deadline to 10ms | Exit waits the whole deadline for telemetry flushes that never finish in time anyway.                            |

```bash
bun run overdroid update
bun run overdroid status
bun run overdroid apply
bun run overdroid restore
```

`bench` launches the binary in a real terminal three times and prints time to first paint and time
from Ctrl-C to exit. Pass a path to measure a copy, for example
`bun run bench ~/.local/bin/droid.orig`.

`update` is the one you want day to day: it runs `droid update`, then applies the patch set if the
binary is stock. Each command takes `--target <path>` and defaults to `~/.local/bin/droid`. `apply`
backs the stock binary up to `<target>.orig` before patching.

To run it from anywhere, link the entry point onto your `PATH`:

```bash
ln -s "$PWD/src/index.ts" ~/.local/bin/overdroid
```

## Why

Measured on a real terminal, time until the input box appears:

| Setup                                 | Time to interactive           |
| :------------------------------------ | :---------------------------- |
| Stock                                 | 1.17s (up to 2.9s under load) |
| Without startup network calls         | 0.72s                         |
| Projected, after probe + cert fixes   | ~0.55s                        |
| Hard floor (Bun boot + module import) | ~0.45s                        |

Most of the gap is three blocking Factory API calls (`whoami`, then `feature-flags` and
`managed-settings` behind it) plus a hardcoded 150ms terminal capability probe.

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
