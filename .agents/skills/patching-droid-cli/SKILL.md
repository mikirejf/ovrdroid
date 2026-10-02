---
name: patching-droid-cli
description: >-
  Patch the compiled Droid CLI binary: change its behaviour, cut its startup or exit time,
  re-apply a patch set after a Droid update, or work on any Bun standalone executable's
  embedded bundle and bytecode.
---

# Patching the Droid CLI binary

Droid ships as a Bun standalone executable: one native file carrying its whole
application as plain JavaScript source plus a precompiled JSC **bytecode** blob, indexed by a
**module graph** at the tail of the file. Everything patchable lives in that graph, and every mistake worth
knowing about comes from the bytecode blob.

Working reference implementation: `~/dev/ovrdroid` (TypeScript, Bun). Read it before writing a
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

1. **Locate the graph** and read every app module: the entry record plus, since Droid 0.220.0,
   hundreds of split `chunk-*.js` records (loader 1) that import each other by `/$bunfs/root/`
   path. Offsets change every release, so always derive them from the trailer; never hardcode.
   See [`MODULE-GRAPH.md`](MODULE-GRAPH.md).
2. **Patch the source text.** Find/replace pairs, each required to match exactly once across all
   modules, so a Droid update that moves the code fails loudly instead of patching the wrong site.
   The pairs are written against one build but matched by identifier **shape**: at apply time
   `src/patch/rebase.ts` re-finds each `find` on the target, renames the `replace` to that build's
   names, then patches. See [The patch contract](#the-patch-contract).
3. **Stamp a marker.** Append `globalThis.__ovrdroid="<digest>";` where the digest covers your
   patch set. Minification renames the identifiers your find strings matched, so the patched
   binary is no longer searchable by those strings; the marker string literal survives and is how
   `status` later tells applied from stale from stock.
4. **Rebuild the whole binary on a pinned Bun.** Stage the chunks as files with their
   `/$bunfs/root/chunk-X.js` imports rewritten to `./chunk-X.js`, stage every sidecar behind an
   import preamble, and run
   `bun build --compile --bytecode --splitting --format=esm --minify --target=bun --asset-naming=[name].[ext]`.
   The Bun version is `BUILD_BUN_VERSION` in `src/binary/bun.ts`, newer than the one Droid ships,
   because its bytecode format is smaller and faster to load. The harness downloads the Bun build
   for the host (darwin-arm64 or linux-x64) once and caches it. Budget ~6s.
   Two chunks (highlight.js and one other big library) are not imported; the app loads them on
   demand with `import.meta.require("/$bunfs/root/chunk-X.js")`. Bun leaves that call alone and
   only rewrites the string, so the chunk is dropped from the graph and the first code block
   crashes the session with `Cannot find module './chunk-X.js'`. `rewriteImports` turns those
   calls into `require("./chunk-X.js")`, which Bun bundles like any other edge.
5. **Verify the sidecars** survived byte for byte under their original names
   (`assertSameEmbeds`). Chunk names may change; sidecar names never may, because the app
   addresses them by string literal. Then **verify every path the app names resolves**
   (`assertRefsResolve`): no `import.meta.require("./…")` left behind, and every
   `/$bunfs/root/…` literal names a record the binary carries.
6. **Re-sign** with `codesign --force --sign -` on macOS. Skip this and macOS kills the process with
   SIGKILL at launch. Linux builds skip this step.
7. **Prove it before installing.** `--version` must match stock, the copy must paint in a PTY
   (`probe ab`), and it must render a code block (`probe highlight`). A `--version` that passes
   says nothing about the chunks or the sidecars, and a paint says nothing about chunks loaded
   later.

Transplanting rebuilt regions into the stock binary in place was the old path. It fails silently
on a Bun version mismatch (the runtime rejects the cache and parses source, +326ms) and cannot
carry split chunks; the harness rebuilds the whole file instead.

## The patch contract

A patch (`src/patch/patches.ts`, `Patch`) is `name`, `find`, optional `until`, optional `lookups`,
`replace`. It is written against one build and must hold on every supported build, whose minified
names differ.

- Every name of 3 characters or fewer in `replace` must be captured by `find`, `until` or
  `lookups`. `lookups` are snippets from the same module as `find`, each matching once, that
  capture outer names the `replace` uses.
- Payload-owned names (locals, parameters, helpers) start with `$OD`. `apply` refuses a source that
  already contains `$OD`.
- Never renamed: names longer than 3 characters, dotted properties, object keys, and the short
  keywords in `SHORT_WORDS` (`src/patch/tokens.ts`). Chunk file names in strings are renamed.
- Drift is reported as `markers not found (Droid version drift): <name> (<reason>)`, reason one of
  unresolved, collides, ambiguous, missing, no-tail, no-lookup. [`UPDATING.md`](UPDATING.md) fixes
  each.
- `bun run probe builds` checks the whole set against the stock pinned release of every platform.
  Run it before pushing a patch change.

## Finding a patch site

Two probe commands read the binary directly and answer the only two questions a patch site poses:

```bash
bun run probe grep <binary> 'gZ=58,hZ=24'        # is this literal unique enough to anchor?
bun run probe names <binary> '<find>' g x P je   # what are the free names in the replacement?
```

`grep` prints a verdict (`unique, so it can anchor a patch`, or `N places … widen it`) then every
place with its chunk and surrounding code. `names` resolves each name as the anchor's own chunk
sees it: imported, locally defined, or free. **Never reach for shell `grep` here**: a chunk is one
1.2MB line, so `grep -c` reports `1` for a string occurring four times, long `-E '.{400}'` context
patterns error out, and a recursive grep over 502 chunks times out.

`bun run probe extract <binary> -o work/src/<version>` writes one file per module when you need to
read a whole region rather than query it. Keep the previous release's extraction beside it.

- Anchor on strings the minifier cannot rename: log messages, telemetry event names, URL paths,
  env var names. Then walk outward to the identifier you need.
- Minified identifiers (`ARu`, `pIn`, `cQB`) are release- and platform-scoped, and a name is
  **reused across releases for unrelated code**: `T6` was the wordmark on 0.220.0 and a markdown
  regex on 0.221.0. Capture a name from a `find`/`lookup` with the shape of its role, and resolve it
  with `probe names` rather than writing one you saw in another build.
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

`ovrdroid update` installs Factory's newest release (`factory-cli/LATEST`) for the host,
verifies its sha256, and applies. A release that only renames is absorbed by the rebase. Otherwise
`update` reports `markers not found (Droid version drift): <name> (<reason>)` and leaves the
installed Droid as it was, so `status` still says `applied` for the old release. `probe builds`
shows the drift for every platform from cached stock downloads. Before fixing a stuck patch, check whether the new
release fixed or removed what it patched; then delete it instead. The full
procedure, from triage through the proof on a copy, is [`UPDATING.md`](UPDATING.md). The graph
parser and the rebuild carry over, unless every patch goes missing at once, which means the module
layout moved.

## Adding a feature, not just deleting work

A patch that adds UI is held to the same bar as a startup patch: prove it costs nothing, against a
control that differs by the patch alone.

**Build the control from the same patch set minus your patches.** Comparing against the installed
binary measures page-cache warmth, not code: a daily-launched binary beat a fresh 159MB file in
`/tmp` by 44ms with a confident interval, and the same comparison against a fair control landed on
zero.

**The display format is the performance decision.** Anything that shows elapsed time has one
unavoidable cost, a repaint per visible change, so the format sets the bill: seconds resolution cost
30,780 bytes a minute, minutes resolution 3,120 bytes per 150s, an absolute clock time nothing at
all. Pick the coarsest format that answers the question and let the timer match it. Precision the
redraw budget cannot support is a lie regardless: a minute timer printing `43s` is wrong for most of
that minute, so print `<1m`.

**Do not subscribe to a shared ticker to animate one label.** Droid's `dAT(ms, enabled)` hook is one
line and looks idiomatic, but it joins a shared **125ms** interval that then runs for the rest of
the session no matter what the text says; `ms` only rounds the value handed back. A self-rescheduling
`setTimeout` aligned to the next boundary that changes a digit fires exactly when the display goes
stale. Align to the boundary (`step - age % step`), never sleep a whole step, or a label that has
been idle for 40 seconds shows the wrong value for another full minute.

**A React render is not a clock.** Droid's TUI mounts components conditionally: the footer is
`!NT&&jsxDEV(Yht,...)`, so opening the slash-command menu unmounts it. A timestamp stamped with
`Date.now()` during render records when the component next drew, so a turn that ended behind that
menu was recorded when the menu closed, and resuming a busy session stamped the resume. Let the
lifecycle event tell you **when to look**, and read **when it happened** from state that outlives the
component, here `getSessionStateManager().getSessionManager(id)?.getDroidWorkingStateChangedAtMs()`.
Every live test passed before this was caught by review; reproducing it needed a pane swap mid-turn.

**Confirm a probe exercises your feature before believing its number.** `probe keys` never submits a
prompt, so a turn-scoped feature is switched off for the whole run; it still reported an 18ms
difference. Counting bytes painted during a burst after a real turn put it at 89 bytes in 33,462.

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

Deferring work past paint is the one startup lever that still pays, but two details decide whether
it works. **A React effect is not the paint boundary**: boundaries like `first_paint` and
`input_mounted` are recorded inside effects that run before the renderer writes the frame, so
hanging work there does not move it after paint. A short timer does. And **check what reads the
flag you are deferring**: if lazily-created objects copy a `watchingEnabled`-style flag at
construction, deferring the flag leaves them permanently disabled and the feature dies silently
while the benchmark reports a win. Set the flag immediately; defer only the expensive calls.

Typing work has its own version of this, and one rule covers most of it: **React concurrency is a
scheduling tool, not a cost-reduction tool.** `useDeferredValue` and `startTransition` render a
subtree twice on purpose, so they win only when the second pass is both expensive and genuinely
skippable. Under Ink every commit reaches `resetAfterCommit` and builds a whole terminal frame, so
the fixed price of splitting a render is one extra frame build, which is the single most expensive
thing Ink does. Both hooks were built and measured on Droid 0.218.1 and both roughly **doubled**
commits per keystroke. Count renders before reaching for either.

Two related traps. Ink asks for a legacy root (`concurrent:!1`), which looks like it disables the
hooks, but React 19.2 compiled legacy mode out and the root is concurrent regardless, so a legacy
root is not a reason to dismiss the experiment. And state arriving through `useSyncExternalStore`
cannot be deferred at all: `forceStoreRerender` enqueues at the sync lane unconditionally so a
store read cannot tear, so there is no patch site to put a transition in.
