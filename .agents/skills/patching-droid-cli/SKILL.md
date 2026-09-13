---
name: patching-droid-cli
description: >-
  Patch the compiled Droid CLI binary: change its behaviour, cut its startup or exit time,
  re-apply a patch set after a Droid update, or work on any Bun standalone executable's
  embedded bundle and bytecode.
---

# Patching the Droid CLI binary

Droid ships as a Bun standalone executable: one Mach-O file carrying its whole application as
plain JavaScript source plus a precompiled JSC **bytecode** blob, indexed by a **module graph**
at the tail of the file. Everything patchable lives in that graph, and every mistake worth
knowing about comes from the bytecode blob.

Working reference implementation: `~/dev/overdroid` (TypeScript, Bun). Read it before writing a
new harness.

## Rebuild the source, never edit bytes in place

The obvious move is a same-length byte edit inside the embedded source, so the file layout never
shifts. It works, and it makes the binary **slower**.

JSC keys its disk cache on a hash of the source and Bun precompiles every nested function into
the blob, so one changed byte invalidates the whole cache. Droid then parses 20MB of JavaScript
at every launch, which costs more than any startup patch saves. Repairing the hash is worse: the
hash matches, the stale bytecode runs, and your patch silently does nothing.

So patches are ordinary text edits of any length on the extracted source, and the source is
**rebuilt** with a real Bun to produce a fresh matching blob. Equal-length tricks
(`await ` to `/**/  `, `1000` to `100.`) belong to the in-place path and are dead weight here.

## The pipeline

1. **Locate the graph** and read the entry record's source region. Offsets change every release,
   so always derive them from the trailer; never hardcode. See
   [`MODULE-GRAPH.md`](MODULE-GRAPH.md).
2. **Patch the source text.** Literal find/replace pairs, each required to match exactly once, so
   a Droid update that moves the code fails loudly instead of patching the wrong site.
3. **Stamp a marker.** Append `globalThis.__overdroid="<digest>";` where the digest covers your
   patch set. Minification renames the identifiers your find strings matched, so the patched
   binary is no longer searchable by those strings; the marker string literal survives and is how
   `status` later tells applied from stale from stock.
4. **Rebuild with the Bun release the binary embeds.** Read it out of the binary
   (`/Bun v(\d+\.\d+\.\d+)/`), download that exact release, and run
   `bun build --compile --bytecode --format=esm --minify --target=bun`. A different Bun writes a
   different JSC cache version and the runtime rejects the cache. Budget ~11s and ~3GB of RAM.
5. **Transplant** the rebuilt source, bytecode and module_info back into the stock binary's
   original offsets, and update their three length fields. Nothing moves; the file size never
   changes.
6. **Re-sign** with `codesign --force --sign -`. Skip this and macOS kills the process with
   SIGKILL at launch.
7. **Prove it before installing.** Run the patched copy's `--version`, require the same output as
   stock, and time it: a hit is ~0.09s, a cache miss ~0.35s. That timing is your **cache canary**,
   the one cheap check that the bytecode path survived. Confirm with
   `BUN_JSC_verboseDiskCache=1`, which prints `Cache hit for sourceCode`.

## Finding a patch site

Extract the source region to a file and work on that text, not the binary. It is one 20MB
minified line, so read it with `rg` and offsets rather than an editor.

- Anchor on strings the minifier cannot rename: log messages, telemetry event names, URL paths,
  env var names. Then walk outward to the identifier you need.
- Minified identifiers (`ARu`, `pIn`, `cQB`) are release-scoped. Never treat one as stable, and
  keep each find string long enough to be unique but short enough to survive unrelated edits
  nearby.
- Check uniqueness before believing a find string. A one-occurrence check in the harness is the
  guardrail that turns the next Droid release into a clean `missing:` report.

## Safety

- Copy the binary to `<target>.orig` before the first patch, and build every patched binary from
  those stock bytes, never from an already-patched one.
- Test on a copy in `/tmp`. Touch `~/.local/bin/droid` only once the copy passes.
- Write to `<target>.tmp`, chmod, sign, verify, then rename over the target. A half-written binary
  in place leaves no working Droid.
- Droid auto-updates and silently replaces a patched binary. Set `disableAutoUpdate: true` in
  `~/.factory/update-policy.json` before relying on a patch.

## After a Droid update

`status` reports `missing:` with the patch names whose find strings no longer match once. Re-find
those sites in the new source, update the find/replace pairs, and re-apply from the new stock
binary. The graph parser, the rebuild and the transplant carry over untouched; only the patch
strings and the embedded Bun version are release-scoped.

## Measuring a performance patch

`--version` is a cache canary, not a benchmark: it skips almost everything Droid does at startup.
Measure time-to-first-paint in a real PTY, and attribute the time before you patch anything.
See [`MEASURING.md`](MEASURING.md).

Instrument the binary rather than guessing: patches that write a timeline or per-module costs to a
file turn an argument into a measurement, and the harness can build such a binary in ~11s. See
[`INSTRUMENTING.md`](INSTRUMENTING.md).

## Know when to stop

Startup work splits into **waiting** (network, probe timeouts, subprocesses) and **doing** (parsing,
evaluating modules, laying out the first frame). Patches are good at deleting waiting and almost
useless against doing.

Once a CPU profile taken before first paint shows no idle samples, the cheap wins are gone. At that
point every remaining candidate must be built and A/B'd, and on Droid 0.218.1 they all came back
inside the noise: lazy highlight.js languages, deferring the tools module, skipping the sandbox
check, deferring cloud session defaults, non-blocking built-in droids, a higher Ink frame cap.

The reason is shape, not size. The cost is spread across ~160 modules whose largest is 11ms, so
deferring any one of them wins nothing and the sum only moves if the app imports less. That is an
upstream change. Report it instead of shipping a patch that cannot be measured.
