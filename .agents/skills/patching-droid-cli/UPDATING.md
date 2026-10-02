# Carrying the patch set across a Droid release

Patches do not carry release-scoped names. `apply` and `status` re-find every patch by identifier
**shape** on the target build (`src/patch/rebase.ts`, tokenizer in `src/patch/tokens.ts`), rename
the `replace` to match, and only then patch. A release that only renames needs no hand work, and
one patch set fits both supported builds (darwin-arm64 and linux-x64), whose minified names differ.

The hand work is the patches the rebase cannot settle. They surface as
`markers not found (Droid version drift): <name> (<reason>)`.

A new release reaches you on its own. `ovrdroid update` follows Factory's `factory-cli/LATEST`, so
the next run after Factory ships tries it, and the session header says `↓ vX available · run
ovrdroid update`. When the patch set does not fit, `update` stops with the drift list and leaves the
installed Droid and its `.orig` untouched; every Linux box keeps retrying from its download cache
until the fix is pushed. The pre-push hook runs `probe builds` against the same newest release, so
it blocks every push until the drift is fixed. Start here.

Done when `apply` on a `/tmp` copy prints `applied <digest>`, that copy paints and renders a code
block, `probe ab` against the stock copy shows it is **never slower**, and `probe builds` is clean
for every platform. Faster is not the bar: as Droid moves its own waits after paint, the paint gap
shrinks toward zero, and an interval that straddles zero at `-r 24` is a pass.

Expect the hand half to cluster: most of it is usually one or two sites Droid **rewrote** rather
than renamed.

## The contract

A patch is written against one build and must still hold on the others. Its `replace` may only use
names the rebase can map:

- Every name of **3 characters or fewer** in a `replace` must be captured by the patch's `find`,
  its `until`, or its `lookups`. A name captured nowhere is `unresolved`.
- A name the payload owns (locals, parameters, helper functions, globals) starts with `$OD`
  (`$ODline`, `$ODupdateRead`). `apply` refuses a source that already contains `$OD`.
- Never renamed, so safe to write bare: names longer than 3 characters, dotted properties
  (`a.b`, but not a spread `...x`), object keys (`{key:` and `,key:`), and the short keywords in
  `SHORT_WORDS` in `tokens.ts`. Chunk file names inside strings (`chunk-xxxxxxxx.js`) **are**
  renamed.
- `lookups` (optional) are snippets from the same module as `find`. Each must match exactly once,
  and they capture outer names (a hook, a theme object, a module-scope helper) the `replace` uses
  but `find` does not reach. They are only read, never replaced.

The drift reason says which rule broke:

| Reason       | Meaning                                                                         |
| :----------- | :------------------------------------------------------------------------------ |
| `missing`    | the shape of `find` occurs nowhere                                              |
| `ambiguous`  | the shape occurs in more than one place                                         |
| `no-tail`    | `find` matched, but `until` no longer follows it in that module                 |
| `no-lookup`  | a lookup matched zero or several times in the module                            |
| `unresolved` | a short name in `replace` is captured by nothing (`free names:` lists them)     |
| `collides`   | two names in `replace` map to one name on this build (`names renamed onto one`) |

## 1. Triage the drift

```bash
bun run probe builds                          # every platform, newest release, cached downloads
STOCK=~/.cache/ovrdroid/droid-<new>/darwin-arm64/droid   # builds left the stock binaries here
bun run probe anchors $STOCK                  # one line per patch, for one binary
```

`probe builds` checks the patch set against the stock newest release for every supported platform,
downloading and caching each one under `~/.cache/ovrdroid/droid-<v>/<host>/droid`. Work from those
cached files: the installed Droid is still the old release. `--version <v>` checks another release
instead. It exits non-zero on drift. `probe anchors <binary>` prints the same per-patch report for
one binary: `unchanged` / `rebased` with `old->new` renames are done, and `--json` prints the
rebased `find`, `until`, `lookups` and `replace` if you want to see exactly what `apply` will splice
in.

A patch is written against whichever build its author had open, Mac or Linux, so `unchanged` on one
host and `rebased` on the other is normal. On 0.232.0 `shutdown-flush-deadline` was written in Linux
names (`H=2000,M=1e4,R=1000,A=250;`) and lands on the Mac as `M=2000,R=1e4,A=1000,v=250`.

The drift list is usually shared by both platforms. When it is, fix it against one build and let
`probe builds` prove the other.

Fix by reason:

- `missing`: the code moved or was rewritten. Step 3. Before assuming a rewrite, check whether
  only a **neighbour** moved: a `find` that reaches past the code its `replace` touches goes
  missing when that extra code changes. On 0.225.2 `session-search-warm-skip` carried a leading
  `if(S(te),` that Droid split into its own statement; trimming the `find` to `if(!t){…` fixed it.
  Keep every `find` to what its `replace` actually changes.
- `ambiguous`: widen the `find` until its shape is unique. Every short name in a `find` is a
  wildcard, so a `find` that is mostly names (`K$=\``) matches thousands of sites. Anchor such
patches on a neighbouring keyword or literal (`var Hz=\``) so they carry some shape of their own.
Renaming alone can tip a short `find`over:`,Oz=[`was unique on 0.224.1, but its new name`,_z=[` matched 2194 places on 0.225.2. Extend it into the value it assigns (`,_z=["\u2554`),
  which is literal and does not rename.
  A new feature can copy your constants. On 0.232.0 `M=1e4,R=1000,` went from 1 place to 2
  because a new attention outbox declared the same timeouts. Widen into the whole declaration
  (`H=2000,M=1e4,R=1000,A=250;`), then read the module it lands in (`probe grep`) to confirm it is
  still the shutdown code, not the newcomer.
- `no-tail`: re-anchor the `until` on the literal that now follows the span (a string or a
  keyword) rather than on names, as `wordmark-compact-ovrdroid` does with
  `],a="Select Factory Router`. The tail is searched only in the `find`'s own module, just as
  `apply` does. Step 3.
- `unresolved`: a short name in `replace` is captured by nothing. Either add a `lookups` snippet
  from the same module that binds it (a use of the hook, the destructured prop, the theme object),
  widen `find`/`until` to reach it, or make it payload-owned and rename it `$OD…`. Payload
  bindings (arrow parameters, `let` locals, `globalThis` names like `__odUsage`) belong in this
  last group: rename them `$OD…` rather than lookup them.
- `collides`: two names in `replace` land on one name on this build, so a lookup or `find` is
  capturing the wrong binding for one of them. Step 3, settle by role.
- `no-lookup`: the lookup snippet is not unique in the module. Widen it, or pick a different use
  of the same binding.

If **every** patch is missing at once, the drift is structural, not cosmetic: the module layout
changed under the harness (0.220.0 split one module into 496 chunks). Check `status`'s
`source N bytes across M modules` line against the last known good; a tiny N means the harness is
reading the wrong module. Fix `src/binary/` first, patches second.

## 2. Extract the source

```bash
bun run probe extract $STOCK -o work/src/<version>
```

One file per module, `entry.js` plus `chunk-*.js`, ASCII, one line each. Keep the previous
release's extraction beside it: the diff between two releases is where the renames are.

On the extracted files, `rg -o '.{0,200}<needle>.{0,300}' work/src/<version>` prints each hit with
bounded context and copes with the long lines. Use it to read code or to search by a regex shape
(`[\w$]{1,3}\(e,n\)\.map\(`) when the names changed. Counting still belongs to `probe grep`.

## 3. Fix each stuck patch

Start from a literal the minifier cannot rename (a log message, an event name, a `"draft-edited"`
action type, a `\uF418` glyph, `RGI_Emoji`) and walk outward to the code the patch touches.

**Do not reach for `grep` here.** A chunk is one 1.2MB line, which breaks the usual tools three
different ways: `grep -c` counts matching **lines**, so it reports `1` for a string occurring four
times; `grep -o -E '.{400}…'` dies with `invalid repetition count`; and a plain recursive `grep`
over 502 chunks times out. Two probe commands answer those questions instead, straight off the
binary, no extraction needed.

```bash
bun run probe grep $STOCK 'gZ=58,hZ=24'          # can this literal anchor a patch?
bun run probe grep $STOCK 'status:"ready"' -q    # verdict only, no surrounding code
```

`grep` prints the verdict first (`1 place … unique, so it can anchor a patch`, or `3 places across
3 modules … widen it`) and then each place with its chunk, offset and surrounding code. A patch
whose `find` is not unique fails later, so settle it here.

```bash
bun run probe names $STOCK '<the find string>' g x P je pc
```

`names` takes the patch's anchor, finds the chunk it sits in, and resolves each name **as that
chunk sees it**: imported (naming the chunk it comes from), defined locally (with the definition),
or free. Feed it the `free names:` list from the report. A name it calls free is a crash waiting at
runtime, not a warning.

`names` proves a name **resolves**, not that it is the **right binding**. A big chunk reuses its
short names many times over, so `defined in this module` is usually a stranger. Settle every name
by **role**: read what it was at the old site (which destructured key, which prop, which import,
which hook), then find what plays that role at the new site, and write a `lookups` snippet that
captures it from a use with the shape of that role. Reading the two extractions side by side is the
fastest way. On 0.224.1, four names resolved cleanly and all four were strangers, one of them
swapping `ambiguousIsNarrow` for `countAnsiEscapeCodes`. On 0.225.2 two letters traded roles in the
footer: `useEffect` went from `D` to `I` while the `statusState` prop went from `I` to `D`. A lookup
written from the role survives that; a name carried over by hand does not.

This is also the trap that makes eyeballing wrong. In 0.220.0 `T6` was the wordmark; in 0.221.0
the wordmark moved to `O$` and `T6` became an unrelated markdown regex in a different chunk. A
name carried over by hand would have compiled, shipped, and drawn garbage. `names` says which one
you have.

With splitting, React hooks arrive through the import header and are used bare: `useState`,
`useEffect`, `useRef`, `useCallback` and `useMemo` are single letters that differ per release and
per build. To learn which letter is which hook, read the react chunk's wrappers, which name the
hook outright:

```bash
grep -oE '[A-Za-z0-9_$]+=function\([a-z,]*\)\{return [a-z]\.H\.use[A-Za-z]+' \
  work/src/<version>/<react-chunk>.js | sed -E 's/=function.*H\./ /'
```

One line per hook (`A useState`, `v useEffect`, …). On 0.228.0, `p` went from useState to a
session getter, and `A` went from the session getter to useState. Then capture the hook with a
lookup that uses it, not by writing the letter.

A patch that hangs a flag on a function (`X.$done`) must hang it on a name that both the writing
site and the reading site can see. Across chunks that means an **exported** name the reader
imports; `names` on the reader's anchor tells you which, and a lookup in the writer's module must
capture it. The command-catalog snapshot was `$o` on 0.221.0 and `Go` on 0.222.0, and `$o`
survived the release as an unrelated terminal-service getter in a different chunk, so a carried-over
name would have compiled.

When the old site was **rewritten** rather than renamed (no shape match, and the literal you walk
out from lands in code of a different form), port the payload's intent into the new form instead of
forcing the old form back. On 0.224.1 the header dropped its named-style registry for inline style
objects, so the two patches that registered styles merged into the patches that paint.

Give payloads as few borrowed bindings as possible. Every chunk import, hook, or helper a `replace`
leans on is another lookup to keep working next release, and another chance to bind a stranger.
Node built-ins and fixed paths never need borrowing: `require("fs")` and
`require("os").homedir()` work in any chunk, which is why ovrdroid's own files live under
`~/.factory/ovrdroid/`.

Before fixing a patch, read what the old site did. When stock now does the same thing, delete the
patch rather than fixing it: 0.220.0 shipped production React, and 0.224.1 stopped blocking
startup on the whoami call. The same goes for a site Droid removed outright. A literal can outlive
its code in an enum or phase registry. On 0.228.0, `SessionSearchWarm` still appeared once, in the
phase enum, but nothing called it any more, so `session-search-warm-skip` was deleted. When the
only remaining hit is a definition, check for a caller before re-anchoring.

Ask this for every `missing` patch **before** hunting for its new site. On 0.232.0 three of ten
were upstream fixes, not drift:

- `git-ai-archive-skip`: `archiveRetiredGitAiSessions` was gone. Deleted.
- `certificate-count-skip`: the cache check no longer awaited a certificate count; it now calls a
  sync fingerprint of file sizes and mtimes. Read the new function before deciding it is cheap.
  Deleted.
- `cache-warm-effort`: stock's warm snapshot started carrying `reasoningEffort` itself. The patch
  that added `effort` was deleted, and the warmer payload switched to reading stock's field.

When stock half-adopts a payload's idea like that, use stock's version and drop yours. Record the
evidence (the absent literal, the new code) in the commit, because a deleted patch leaves no other
trace.

Upstream also adds behaviour around code a payload replaces. On 0.232.0 `addServer` gained a
`shuttingDown` guard, so `mcp-idle-add-server` had to carry it into the dormant path. Diff the old
and new stock text of every method a payload **replaces** (not just the `find`), and port each new
guard.

### Shared payload constants

A `replace` assembled from module-scope constants (`TURN_CLOCK_TRACK`, `UPDATE_HEADER_LINE`,
`UPDATE_FILE_READER`) is renamed as a whole at apply time, so the contract covers the expanded
string. Check the constants the same way: every short name in them is captured by the patch that
splices them in, and every payload-owned name starts with `$OD`.

Nothing catches a stale name before the build in a patch that skipped the contract, because **the
only earlier gate is the rebase itself**, and it reports a name as captured whenever some `find`,
`until` or lookup mentions it. A wrong capture still compiles. A stale name that happens to collide
with an import in the new chunk fails `bun build` with `Cannot assign to import "Ie"`; the same
mistake on a name that collides with nothing compiles clean and crashes at runtime instead.

## 4. Re-anchor the tests too

`bun test` goes red on a release for two reasons, and only one of them is your patches. Tests that
evaluate a patch payload or a stock module carry **their own** copies of release-scoped names, and
those drift on the same schedule. The rebase does not touch them:

- `src/patch/__tests__/command-menu.test.ts` builds the ranking function around the bindings the
  bundle gives it (`ue`, `de`, and the query `K` on 0.222.0). Read the whole preamble off the
  bundle rather than renaming the letters: on 0.222.0 the query variable and the entry variable
  both moved, and the preamble also has to keep the test's own shape, so
  `re.command.suggestionKind==="internal-menu"` from the bundle becomes `re.internalMenu` here.
- `src/patch/__tests__/denylist-patches.test.ts` rebuilds the pattern builder around the payloads:
  `STOCK_ARGUMENT_END` names the argument-end helper, and the wrapper's parameters name the last
  token. Both follow the builder.
- `src/patch/__tests__/mcp-hub-stock.ts` is a copy of stock's MCP hub class, in its own fixed
  names, that `mcp-idle-harness.ts` patches and runs. `stock-source.test.ts` checks each piece occurs
  once in the bundle **up to minified names** (`holePattern`), so a rename passes and only a real
  code change fails. When a piece fails, upstream changed that method. Run
  `bun run probe hub $STOCK`: it diffs every piece against the stock build, works out the renames
  by majority vote, lists each change on its own in the fixture's names, and prints the new method
  already translated, ready to paste over the old one. Give every name it reports as new and
  outside (not a local) a stand-in in the harness's `BINDINGS` and argument list, and check every
  name it says it left unmapped. A name it cannot settle (a tie) stays in the bundle's spelling;
  read the code and pick by role. Read each change: on 0.232.0 `addServer` gained two
  `shuttingDown` checks, and a hand copy that took only the first still passed the harness tests.
  `probe hub` refuses a patched binary, because the patches rewrite these methods.

Some tests used to carry release names and now find their code by shape. Keep it that way, and
write any new stock-reading test the same way:

- `heredoc-shell.test.ts` finds the shell splitter by a regex of its body
  (`function X(e,n){return Y(e,n).map(({argv:t})=>t)}`) and reads its export name from the
  module's `export{…}`.
- `stock-source.test.ts` takes the zod base class from the class that encloses the constructor
  `zod-v3-lazy-bound-methods` matches.

A failure there is drift, not a bug. Fix the test's anchor the same way you fixed the patch's, and
prefer one that survives both platforms and the next rename: a regex of the code's shape, a name
derived from a patch's rebased `find`, or a `holePattern` comparison.

These tests read the **host's installed** build (or its `.orig`). Until the host runs the new
release they test the old one, so before the real install they fail for patches you already fixed,
and they cannot see the new release at all. Expect that. The order is: copy passes step 6's probes,
`ovrdroid update` for real, then `bun test` must be fully green.

## 5. Install the new release on a copy

```bash
bun run probe builds                     # every platform, newest release; rerun until clean
rm -f /tmp/droid-test /tmp/droid-test.orig
bun run ovrdroid update --target /tmp/droid-test   # installs the newest release for this host, sha256-verified, applies
```

`ovrdroid update` installs Factory's newest release for the host (darwin-arm64 or linux-x64) and
checks its sha256 before applying. A target that does not exist yet counts as not on that release,
so a fresh `/tmp` path runs the same install-then-apply path every machine runs.
Then prove it, below, and push. Each Linux box's dotfiles timer pulls ovrdroid and runs
`ovrdroid update` every 15 minutes, so a patch set that fits only one platform breaks that
machine's next update. `probe builds` is the gate that catches it.

## 6. Prove it

```bash
bun run verify
bun run ovrdroid status --target /tmp/droid-test     # applied <digest>
bun run probe ab -r 24 /tmp/droid-test.orig /tmp/droid-test   # .orig is the stock the update installed
bun run probe highlight /tmp/droid-test              # rendered a highlighted code block
bun run probe mcp-children /tmp/droid-test           # stdio servers dormant, when an mcp-idle patch moved
bun run probe builds                                 # the newest release, every platform
bun run ovrdroid update                              # only now, the real install
bun test                                             # green against the installed new release
```

Pick extra probes by what moved: `mcp-children` for the MCP patches, `effort` for the effort
label, `clear` and `first-send` for the session patches, and `ttl` and `effort-cache` for the
cache warmer (those two send real requests through DroidProxy). `probe --help` lists them.

Stock paint has outliers several times the median, so `-r 8` rarely resolves anything; start at 24.

When a probe fails on the **stock** binary, the probe's model of Droid drifted, not your patches.
Fix the probe in `src/probe/` with a test, then rerun. 0.224.1 started exiting 130 on Ctrl-C, which
`probe ab` read as a crash.

No gate looks at the screen. A patch that paints (header lines, logo accents, footer text) can
build, pass every probe, and draw nothing or draw in the wrong place. Launch the copy and look.

`bun run ovrdroid apply` is the first gate that reads your `replace` strings as code, so treat its
`bun build failed` as a patch bug and not a harness one. `--version` proves nothing: it skips the
app. `probe ab` launches the binary in a PTY and waits for the input box, so a rebuild that boots
and then dies shows up as a timeout there.
`probe highlight` asks the model for a code block, which is the first thing that loads a chunk
by name at runtime; a chunk that fell out of the graph crashes there and nowhere earlier. Only
after the copy passes both: `bun run ovrdroid update`, then push to main.

`src/patch/__tests__/stock-source.test.ts` reruns the rebase of every patch against the host's
stock binary, so it goes red the moment Droid updates underneath.
