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
- Every short name in a `find` is a wildcard, and the same letter twice means **one binding
  twice**. Give each distinct binding its own letter: `{width:t,height:e,t}` matches only code
  that really repeats `t`, so stock's `{width:e,height:n,t}` slips past it, while
  `{width:t,height:e,r}` matches.
- A `find` is written in the names of whichever build its author had open, Mac or Linux. So
  `unchanged` on one host and `rebased` on the other is normal, and a shell search of one
  platform's extraction for the other platform's `find` finds nothing. Search by shape, or read the
  rebased text with `probe anchors --json`.

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

The drift list is usually shared by both platforms. When it is, fix it against one build and let
`probe builds` prove the other.

Fix by reason:

- `missing`: first ask whether the patch is still needed (step 3 opens with that). If it is, the
  code moved or was rewritten. Before assuming a rewrite, check whether only a **neighbour** moved:
  a `find` that reaches past the code its `replace` touches goes missing when that extra code
  changes, for example when Droid splits a leading call into its own statement. Keep every `find`
  to what its `replace` actually changes.
- `ambiguous`: widen the `find` until its shape is unique. A `find` that is mostly names (`K$=\``)
  matches thousands of sites, and renaming alone can tip a short one over. Anchor it on a
  neighbouring keyword or literal (`var Hz=\``), or extend it into the value it assigns
  (`,xZ=["\u2554`), which is literal and does not rename. A new feature can also copy your
  constants: a timeout list like `M=1e4,R=1000,` can appear twice once a second module declares
  the same timeouts. Widen into the whole declaration, then read the module it lands in
  (`probe grep`) to confirm it is still the code you meant, not the newcomer.
- `ambiguous` because upstream added a **second consumer** of the same flag: patch where the flag
  is set rather than where one consumer reads it. Setting `askUserToolEnabled:!1` where the flag
  is built covers every tool that reads it, and the next one too.
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
changed under the harness, as when Droid went from one module to hundreds of split chunks. Check
`status`'s `source N bytes across M modules` line against the last known good; a tiny N means the
harness is reading the wrong module. Fix `src/binary/` first, patches second.

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

### Is the patch still needed?

Ask this for every `missing` patch **before** hunting for its new site. Read what the old site did,
then read the stock code around where it was (step 2's extractions, side by side). Often a
`missing` patch is an upstream fix, not drift:

- **Droid removed the code.** A literal can outlive its code in an enum or phase registry, so a
  single remaining hit may be a definition nothing calls any more. Check for a caller before
  re-anchoring. With no caller, delete the patch.
- **Droid replaced the slow path.** A patch that skipped an expensive call is obsolete when stock
  now calls something cheap instead. Read the new function before deciding it is cheap, then
  delete the patch.
- **Droid adopted half the payload's idea.** When stock starts carrying a field or behaviour a
  payload added, use stock's version and drop yours, keeping only the part stock still lacks.
- **Droid now persists what the payload caches.** Before re-anchoring a patch that keeps its own
  file or state, check whether stock now stores the same thing, and under which conditions.

Delete obsolete patches together with their tests. Record the evidence (the absent literal, the new
code) in the commit, because a deleted patch leaves no other trace.

### Find the new site

Start from a literal the minifier cannot rename (a log message, an event name, a `"draft-edited"`
action type, a `\uF418` glyph, `RGI_Emoji`) and walk outward to the code the patch touches.

**Use the probe commands, not `grep`.** A chunk is one line, often over a megabyte, which breaks
the usual tools three ways: `grep -c` counts matching **lines**, so it reports `1` for a string
occurring four times; `grep -o -E '.{400}…'` dies with `invalid repetition count`; and a plain
recursive `grep` over hundreds of chunks times out. These commands read the binary directly, no
extraction needed:

```bash
bun run probe grep $STOCK 'gZ=58,hZ=24'          # can this literal anchor a patch?
bun run probe grep $STOCK 'status:"ready"' -q    # verdict only, no surrounding code
bun run probe names $STOCK '<the find string>' g x P je pc
bun run probe hooks $STOCK '<the find string>'   # which letter is which React hook there
```

`grep` prints the verdict first (`1 place … unique, so it can anchor a patch`, or `3 places across
3 modules … widen it`) and then each place with its chunk, offset and surrounding code. A patch
whose `find` is not unique fails later, so settle it here.

`names` takes the patch's anchor, finds the chunk it sits in, and resolves each name **as that
chunk sees it**: imported (naming the chunk it comes from), defined locally (with the definition),
or free. Feed it the `free names:` list from the report. A name it calls free is a crash waiting at
runtime, not a warning.

`hooks` names React's hooks. With splitting, `useState`, `useEffect`, `useRef`, `useCallback` and
`useMemo` arrive through the import header and are used bare, as short names that differ per
release and per build, and a letter that was `useState` last release can be a session getter now.
Without an anchor, `hooks` lists each hook under the name the React chunk exports it as; with one,
it lists the names the anchor's chunk uses. Capture the hook with a lookup that uses it, not by
writing the letter.

### Settle every name by role

`names` proves a name **resolves**, not that it is the **right binding**. A big chunk reuses its
short names many times over, so `defined in this module` is usually a stranger. Settle every name
by **role**: read what it was at the old site (which destructured key, which prop, which import,
which hook), then find what plays that role at the new site, and write a `lookups` snippet that
captures it from a use with the shape of that role. Two letters can trade roles in one release:
`useEffect` moves from `D` to `I` while a prop moves from `I` to `D`. A lookup written from the
role survives that; a name carried over by hand does not.

This is also the trap that makes eyeballing wrong. A name carried over by hand can resolve in the
new build to unrelated code in a different chunk (a wordmark name that became a markdown regex), so
it compiles, ships, and draws garbage. `names` says which one you have.

A patch that hangs a flag on a function (`X.$done`) must hang it on a name that both the writing
site and the reading site can see. Across chunks that means an **exported** name the reader
imports; `names` on the reader's anchor tells you which, and a lookup in the writer's module must
capture it.

### Port rewritten code

When the old site was **rewritten** rather than renamed (no shape match, and the literal you walk
out from lands in code of a different form), port the payload's intent into the new form instead of
forcing the old form back. When inline style objects replace a named-style registry, the patches
that registered styles merge into the patches that paint.

When upstream **splits one method in two** (a thin wrapper around a new method that holds the old
body), move the patch onto the method that holds the old body, leave the stock wrapper alone, and
rename the patch to match.

Upstream also adds behaviour around code a payload replaces, such as a `shuttingDown` guard in the
MCP hub. Diff the old and new stock text of every method a payload **replaces** (not just the
`find`), and port each new guard.

Give payloads as few borrowed bindings as possible. Every chunk import, hook, or helper a `replace`
leans on is another lookup to keep working next release, and another chance to bind a stranger.
Node built-ins and fixed paths never need borrowing: `require("fs")` and
`require("os").homedir()` work in any chunk, which is why ovrdroid's own files live under
`~/.factory/ovrdroid/`.

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
evaluate a patch payload or a stock module carry **their own** copies of stock code, and those
drift on the same schedule. The rebase does not touch them. A failure there is drift, not a bug.

These tests copy stock code and need a fresh copy when it changes:

- `command-menu.test.ts` wraps the patch payload in the opening of stock's command ranking
  function. Copy that opening off the bundle again rather than renaming letters one by one, and
  keep the test's own `internalMenu` field where stock reads the suggestion kind.
- `denylist-patches.test.ts` rebuilds stock's pattern builder around the payloads:
  `STOCK_ARGUMENT_END` is a copy of the argument-end helper, and the wrapper's parameters name the
  last token. Both follow the builder.
- `mcp-hub-stock.ts` is a copy of stock's MCP hub class, in its own fixed names, that
  `mcp-idle-harness.ts` patches and runs. `stock-source.test.ts` checks each piece occurs once in
  the bundle **up to minified names** (`holePattern`), so a rename passes and only a real code
  change fails. When a piece fails, run `bun run probe hub $STOCK`: it diffs every piece against
  the stock build, works out the renames by majority vote, lists each change in the fixture's
  names, and prints the new method already translated. Before pasting it in:
  - Give every name it reports as new and outside (not a local) a stand-in in the harness's
    `BINDINGS` and argument list, and check every name it says it left unmapped.
  - A tie it cannot settle stays in the bundle's spelling; read the code and pick by role.
  - The majority vote can merge two stock bindings into one letter (a parameter and an arrow
    parameter), which drops the `holePattern` count to 0. Give each stock binding its own
    letter, as in the bundle.
  - Read each change. A hand copy that takes only the first of two new guards still passes the
    harness tests.
  - `probe hub` reads only `async` methods, so it can report a sync method as gone while the
    bundle has it. Trust `stock-source.test.ts` over the report there.

  `probe hub` refuses a patched binary, because the patches rewrite these methods.

Every other stock-reading test finds its code by **shape**, so it survives renames and both
platforms. Write any new one the same way:

- Find a stock function by a regex of its body, and read its export name from the module's
  `export{…}` (`heredoc-shell.test.ts`).
- Take a stock name from a patch's rebased `find` rather than writing the letter: count
  `rebase.find` from `rebaseAll`, never a raw `PATCH.find`, which is in one platform's names; and
  read a captured binding with `renamed(rebase)` (`session-mention-keys.ts`).
- Compare a stock piece with `holePattern`, which ignores minified names (`stock-source.test.ts`).
- A test that writes a chunk to `/tmp` and imports it must write the chunk's whole import closure,
  with `/$bunfs/root/` rewritten to `./`, or it fails with `Cannot find module`.
- A test that cuts a function body out of its module must also carry the module-level `var`s the
  body uses (`scanner-source.ts` prepends every `var NAME="…"`), or the evaluation throws
  `… is not defined`.
- The 400-line lint limit applies to test harnesses too. Move a helper into its own file
  (`mcp-fake-fs.ts`, `scanner-source.ts`) instead of trimming code.

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
Fix the probe in `src/probe/` with a test, then rerun. When Droid started exiting 130 on Ctrl-C,
`probe ab` read it as a crash until the probe learned that exit code.

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
