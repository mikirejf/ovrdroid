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
- **Count occurrences, not lines.** `grep -c` counts matching **lines**, and the bundle is one
  20MB line per module, so it reports `1` for a string that appears four times and the anchor
  silently fails the harness's uniqueness check later. Use `grep -o -F "str" file | wc -l`.

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
