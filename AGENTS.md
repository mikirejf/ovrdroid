# AGENTS.md

Guidance for coding agents working in this repo.

## What this is

A patch harness for the Droid CLI binary (`~/.local/bin/droid`). Droid ships as a Bun standalone
executable with its application source and precompiled bytecode embedded in a module graph. This
project extracts all of it, patches the source, rebuilds the whole binary, and re-signs it.

The goal is startup performance first: stock time-to-interactive is ~1.17s, of which ~0.5s is three
serial blocking API calls and ~0.15s is a hardcoded terminal probe timeout.

## The one rule that shapes everything

**Every embedded file must come back out the other side.** Droid's binary holds 36 modules: the app
plus 35 sidecars (ripgrep, agent-browser, keytar, the Rust PTY libraries, skill assets, sounds). The
harness extracts all of them, writes an import preamble that re-embeds them, and rebuilds the whole
binary. `assertSameEmbeds` fails the build if any sidecar goes missing, appears from nowhere, or
changes a single byte.

The names matter as much as the bytes. The app addresses its sidecars through hardcoded literals
like `var BUn="/$bunfs/root/rg-kc7jt1ak.";`, one per sidecar, and those literals are never patched.
`--asset-naming=[name].[ext]` makes Bun reproduce each name byte for byte, so the untouched literals
keep resolving. Drop that flag and Bun appends a content hash, every path breaks, and the app fails
at runtime rather than at build time.

Patches are ordinary text edits on the extracted source, any length. Nothing has to fit a fixed slot
any more.

After the rebuild the binary must be signed with `codesign --force --sign -`, otherwise macOS sends
SIGKILL on launch.

## Two languages, on purpose

- **The harness** is TypeScript on Bun. Normal code, normal tooling.
- **Patch payloads** are hand-written minified JavaScript. They match against already-bundled,
  already-minified code, so no compiler can reach them. Do not try to author them in TypeScript.

## Rebuild the whole binary, on a pinned newer Bun

Editing the embedded source in place invalidates JSC's bytecode cache. Bun keys the cache on a hash
of the source, so one changed byte makes Droid parse 20MB of JavaScript at every launch and eats the
whole gain. So the source is rebuilt properly:
`bun build --compile --bytecode --format=esm --minify --target=bun --asset-naming=[name].[ext]`.

**The harness builds on a pinned Bun release, not the one Droid ships.** The version is
`BUILD_BUN_VERSION` in `src/bun.ts`; bump it on purpose, then re-benchmark. The build downloads that
release once and caches it under `~/.cache/overdroid/`, so apply works offline after the first run.
Droid 0.218.1 ships Bun 1.3.14; building it on 1.4.2 is worth 173ms of paint (measured, n=30 paired,
CI 163-183ms), mostly because 1.4.1 packed the bytecode format and cut the blob from 143MB to 45MB.

That means the **whole binary is replaced**, not patched in place. Transplanting new regions into
the stock 1.3.14 binary does not work and fails silently: the old runtime rejects the newer
bytecode, falls back to parsing source, and costs 326ms. It still runs, so only a benchmark catches
it. If you ever go back to transplanting, the host and the builder must be the same Bun version.

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

`--version` passing proves nothing about the sidecars: a binary with every asset missing still
prints its version. Launch it and watch for the input box, which is what `src/launch.ts` does.

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
