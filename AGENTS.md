# AGENTS.md

Guidance for coding agents working in this repo.

## What this is

A patch harness for the Droid CLI binary (`~/.local/bin/droid`). Droid ships as a Bun standalone
executable with its application source and precompiled bytecode embedded in a module graph. This
project extracts all of it, patches the source, rebuilds the whole binary, and re-signs it.

The goal is startup performance first: stock time-to-interactive is ~1.17s, of which ~0.5s is three
serial blocking API calls and ~0.15s is a hardcoded terminal probe timeout.

## The one rule that shapes everything

**Every embedded file must come back out the other side.** Since 0.220.0 the binary holds the app as
an entry module plus hundreds of split JS chunks that import each other by `/$bunfs/root/` path,
alongside the 65 sidecars (ripgrep, agent-browser, keytar, the Rust PTY libraries, skill assets,
sounds). The harness extracts all of them, writes an import preamble that re-embeds the sidecars,
and rebuilds the whole binary with `--splitting`. Chunk names are free to change on rebuild because
imports are rewritten, but every sidecar must survive byte for byte: `assertSameEmbeds` fails the
build if one goes missing, appears from nowhere, or changes a byte.

Not every chunk is reached by an import. A few are loaded on demand with
`import.meta.require("/$bunfs/root/chunk-X.js")` (highlight.js is one), and Bun does not follow that
call: it rewrites the string and drops the chunk, so the build passes and the first code block in a
session crashes with `Cannot find module`. `rewriteImports` turns those calls into plain `require`
so Bun bundles them, and `assertRefsResolve` fails the build if any path the app names by string
does not resolve to a record in the rebuilt binary.

The names matter as much as the bytes. The app addresses its sidecars through hardcoded literals
like `var BUn="/$bunfs/root/rg-kc7jt1ak.";`, one per sidecar, and those literals are never patched.
`--asset-naming=[name].[ext]` makes Bun reproduce each name byte for byte, so the untouched literals
keep resolving. Drop that flag and Bun appends a content hash, every path breaks, and the app fails
at runtime rather than at build time.

Patches are ordinary text edits on the extracted source, any length. Nothing has to fit a fixed slot
any more.

**Patches are name-proof.** They are written against one build and re-found by identifier shape on
the target at apply time (`src/patch/rebase.ts`, tokenizer `src/patch/tokens.ts`), so one set fits
macOS arm64 and Linux x64, whose minified names differ. The contract for a `replace`: every name of
3 characters or fewer is captured by `find`, `until` or `lookups` (snippets in `find`'s module, each
matching once); payload-owned names start with `$OD`. The full rules are in the `patching-droid-cli`
skill.

After the rebuild a macOS binary must be signed with `codesign --force --sign -`, otherwise macOS
sends SIGKILL on launch. Linux builds skip the signing.

**Never `Bun.mmap` a signed binary.** Bun maps the file writable even with `{ shared: false }`, and
on macOS a writable mapping invalidates the signature permanently: from then on the file is killed
on launch with `SIGKILL (Code Signature Invalid)`, and only re-signing brings it back. Mapping the
stock backup this way corrupts the one copy the harness restores from. Read binaries with
`readFileSync`; the whole file is a few hundred MB and reading it is fast enough.

## Two languages, on purpose

- **The harness** is TypeScript on Bun. Normal code, normal tooling.
- **Patch payloads** are hand-written minified JavaScript. They match against already-bundled,
  already-minified code, so no compiler can reach them. Do not try to author them in TypeScript. A
  patch may carry `until` to replace a whole span rather than one string;
  `wordmark-compact-ovrdroid` in `src/patch/logo.ts` uses that to swap an entire array literal.

## Rebuild the whole binary, on a pinned newer Bun

Editing the embedded source in place invalidates JSC's bytecode cache. Bun keys the cache on a hash
of the source, so one changed byte makes Droid parse 20MB of JavaScript at every launch and eats the
whole gain. So the source is rebuilt properly:
`bun build --compile --bytecode --format=esm --minify --target=bun --asset-naming=[name].[ext]`.

**The harness builds on a pinned Bun release, not the one Droid ships.** The version is
`BUILD_BUN_VERSION` in `src/binary/bun.ts`; bump it on purpose, then re-benchmark. The build
downloads that release once and caches it under `~/.cache/ovrdroid/`, so apply works offline after
the first run. Building on a Bun newer than the one Droid ships was worth 173ms of paint the last
time the pin moved (measured, n=30 paired, CI 163-183ms), mostly because the newer Bun packed the
bytecode format and cut the blob by two thirds. Read both versions out of the binary and out of
`src/bun.ts` rather than trusting a number written here.

That means the **whole binary is replaced**, not patched in place. Transplanting new regions into
the stock binary does not work and fails silently: the older runtime rejects the newer bytecode,
falls back to parsing source, and costs 326ms. It still runs, so only a benchmark catches it. If you
ever go back to transplanting, the host and the builder must be the same Bun version.

## Verify before committing

```bash
bun run verify   # every gate the devkit features own
bun test
```

Patch changes additionally need an end-to-end check on a **copy** of the binary, never the installed
one:

```bash
cp ~/.local/bin/droid /tmp/droid-test
bun run ovrdroid apply --target /tmp/droid-test
bun run ovrdroid status --target /tmp/droid-test
```

`--version` passing proves nothing about the sidecars: a binary with every asset missing still
prints its version. Launch it and watch for the input box, which is what `src/probe/launch.ts` does.
Painting proves nothing about chunks loaded later: run `bun run probe highlight /tmp/droid-test`,
which asks for a code block in a real session and fails on a `Cannot find module` crash.

Once a new patch is finalized (`bun run verify`, `bun test`, `bun run probe builds` and the copy
check all pass), you may apply it to the installed Droid without asking. Run
`bun run ovrdroid apply`; it backs up the stock binary first. Do not apply a patch that is still
being tested. Tell the user afterwards that running Droid sessions need a restart.

## Conventions

- Errors to stderr, data to stdout.
- Never write to `~/.local/bin/droid` without an explicit backup first.
- Droid auto-updates (`~/.factory/update-policy.json`). A patched binary gets silently replaced, so
  any apply flow must detect version drift and re-apply.
- Offsets into the binary change with every Droid release. Always derive them by scanning for
  markers; never hardcode a byte offset.

## Every tool you build lands in this repo

If you write something that measures, probes, scans, or reproduces a bug, **it belongs in `src/` as
a `probe` subcommand, not in `/tmp`**. A throwaway script answers one question once and is gone by
the next session; the next agent then rebuilds it from nothing and gets a slightly different answer.

So when a scratch script earns its keep, generalise it before you stop:

- Take the hardcoded paths, binaries and magic strings out and make them arguments with defaults.
- Split the part that **drives** Droid from the part that **reads** the result. The reading half is
  pure: give it text or numbers in and assertions out, and cover it in a sibling `__tests__/`
  folder. `src/probe/watch.ts` parses a log its patches produced; a test caught a real bug in that
  parser with no binary involved.
- Give it a command in `src/probe/probe.ts` and a description that says what question it answers.
- Say the finding in words the output itself explains, not a raw field dump.
  `touched but byte-identical` beats `ctime changed`.

The existing commands are the shape to copy: `probe ab`, `keys`, `trace`, `modules`, `cpu`, `menu`,
`watch`, `touches`, `extract`, `anchors`, `builds`, `grep`, `names`, `hub`.

## After a Droid update

`ovrdroid update` reads Factory's newest release from `downloads.factory.ai/factory-cli/LATEST`,
downloads it for the host (darwin-arm64 or linux-x64) into `~/.cache/ovrdroid/`, verifies its
sha256, and applies the patch set. The installed Droid is replaced only once the patched build
passes, so a release the patches do not fit yet leaves the current Droid in place and `update` exits
non-zero. Drift prints `markers not found (Droid version drift): <name> (<reason>)`: the rebase
could not settle that patch. Load the `patching-droid-cli` skill and follow its `UPDATING.md`: it
fixes the stuck patches with `lookups`, `$OD` names and wider finds (`probe grep`, `probe names`),
re-anchors the tests that carry their own release-scoped names, and proves the result on a copy.

**The Mac is the master.** Edit ovrdroid on the Mac (or a separate full clone on the Linux box) and
push to main. Each Linux box's dotfiles timer pulls ovrdroid into `~/dev/ovrdroid` and runs
`ovrdroid update` every 15 minutes; the Mac pulls by hand. Before pushing a patch change, run
`bun run probe builds`: it checks the patch set against the stock newest release of every supported
platform (downloading and caching them) and exits non-zero on drift. A patch that fits only one
platform breaks the other machine's next update.

**Delete a patch when upstream makes it obsolete.** A patch that still applies is not proof that it
is still needed: Droid may have fixed the bug in code next to the patched line, so the patch now
repeats a check stock already has. After every update, read the stock code around each bug-fix patch
(extract it with `probe extract`, compare it with the previous release). If stock now behaves
correctly, remove the patch from `src/patch/` together with its tests. Do not keep it as a safety
net. Dead patches cost build time, hide real drift, and make the next update harder to read.

Searching the bundle with shell `grep` does not work: a chunk is one 1.2MB line, so `grep -c` says
`1` for a string occurring four times. Use `probe grep`.

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

## Why the command menu rescans

Every Droid startup re-applies mode 600 to `~/.factory/settings.json` and `~/.factory/mcp.json`. The
files are already 600, so nothing is written and the bytes never change, but macOS still fires a
change event and the watcher counts both files as relevant. Every **other** Droid already running
then rescans its whole slash-command catalog. One new terminal tab disturbs every open menu.

Two consequences worth knowing before you chase this again:

- An idle Droid does not loop. Confirmed over 40s with the menu open: zero events, zero rescans. If
  you cannot reproduce a loop, you are missing the second Droid, not looking at a fixed bug.
- A file whose content is unchanged can still wake every watcher. `probe touches` exists to tell a
  real rewrite from a bare metadata touch, because mtime and content both stay put here and only
  ctime moves.

`probe watch` prints the whole chain (file event, watcher wake-up, rescan, cache write) and
`probe menu` counts the resulting flicker. Both take `--churn chmod` to trigger it directly, or
`--churn startup` to trigger it the way a real second terminal does.

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
