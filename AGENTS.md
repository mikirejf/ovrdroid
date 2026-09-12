# AGENTS.md

Guidance for coding agents working in this repo.

## What this is

A patch harness for the Droid CLI binary (`~/.local/bin/droid`). Droid ships as a Bun standalone
executable with its application source and precompiled bytecode embedded in a module graph. This
project extracts the source, patches it, rebuilds it, transplants the result back, and re-signs.

The goal is startup performance first: stock time-to-interactive is ~1.17s, of which ~0.5s is three
serial blocking API calls and ~0.15s is a hardcoded terminal probe timeout.

## The one rule that shapes everything

**The three rebuilt regions must fit the slots they replace.** Patches are ordinary text edits on
the extracted source, any length. What cannot move is the layout of the outer binary: the source,
bytecode and module_info regions are written back into their original offsets, and only their three
length fields in the module table change.

Slack on Droid 0.218.1:

| Region      | Slack        |
| :---------- | :----------- |
| source      | 81695 bytes  |
| bytecode    | 335120 bytes |
| module_info | 28757 bytes  |

If an edit overruns a slot the harness throws and names the region. Grow the source and you will run
out of bytecode slack long before source slack.

After any edit the binary must be re-signed with `codesign --force --sign -`, otherwise macOS sends
SIGKILL on launch.

## Two languages, on purpose

- **The harness** is TypeScript on Bun. Normal code, normal tooling.
- **Patch payloads** are hand-written minified JavaScript. They match against already-bundled,
  already-minified code, so no compiler can reach them. Do not try to author them in TypeScript.

## Rebuild the source, never the binary

Editing the embedded source in place invalidates JSC's bytecode cache. Bun 1.3.14 precompiles every
function and keys the cache on a hash of the source, so one changed byte makes Droid parse 20MB of
JavaScript at every launch and eats the whole gain.

So the source is rebuilt properly:
`bun build --compile --bytecode --format=esm --minify --target=bun`. That produces a fresh, matching
bytecode blob.

**Rebuild with the exact Bun release the binary embeds.** Droid 0.218.1 embeds Bun 1.3.14; the
harness reads the version out of the binary and downloads that release. A different Bun writes a
different JSC cache version and the cache is rejected at runtime.

The outer binary is never regenerated. Only the three regions inside it are replaced.

## Verify before committing

```bash
bun run verify   # every gate the devkit features own
bun test
```

Patch changes additionally need an end-to-end check on a **copy** of the binary, never the installed
one:

```bash
cp ~/.local/bin/droid /tmp/droid-test
bun run overdroid apply --target /tmp/droid-test
bun run overdroid status --target /tmp/droid-test
```

## Conventions

- Errors to stderr, data to stdout.
- Never write to `~/.local/bin/droid` without an explicit backup first.
- Droid auto-updates (`~/.factory/update-policy.json`). A patched binary gets silently replaced, so
  any apply flow must detect version drift and re-apply.
- Offsets into the binary change with every Droid release. Always derive them by scanning for
  markers; never hardcode a byte offset.

## Measuring startup

`--version` is **not** a valid benchmark (0.09s, skips almost everything). Measure
time-to-first-paint in a real PTY by watching for the input box border characters `╰` (U+2570) and
`╮` (U+256E).

Droid has built-in instrumentation: `DROID_PROFILE=1` plus `FACTORY_PROFILE_DIR=<dir>` writes
`profile.jsonl`. Gotchas:

- It appends across runs. Always `rm -rf` the profile dir first, or timelines interleave and look
  nonsensical.
- `bootstrap_complete` and `ready` are `taskType: boundary` and carry no `startMonoMs`. Guard for
  that when sorting.
- It does not work on an extracted bundle run via `BUN_BE_BUN`; profile the real binary.

## Background

Full investigation notes, including the measured phase breakdown and the ranked fix list, live in
the handoff document referenced in `README.md`.

<!-- devkit:core:start -->

## Verify

The `verify` script (`pnpm verify`, or `bun run verify` in a Bun repo) is the "am I done?" gate:
every check the installed features own, run together, all failures reported. Run it before you say a
task is finished. Fix what it reports in the code, not in the config.
<!-- devkit:core:end -->

<!-- devkit:comments:start -->

## Comments

Default to none. The `no-comments` lint fails on any comment. Say it in the code instead: clearer
structure, a name, a type, or a test.

Two shapes pass:

- A tool directive.
- A block citing a URL outside this repo that proves a constraint we do not control. Links to this
  repo or to localhost fail.

The URL comment is one or two lines, plain words, and states the fact itself; the link backs it.
<!-- devkit:comments:end -->
