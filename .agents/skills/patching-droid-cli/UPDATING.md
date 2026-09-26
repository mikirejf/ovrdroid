# Carrying the patch set across a Droid release

`ovrdroid update` fails with `markers not found (Droid version drift): <names>`. Every name is a
patch whose `find` no longer occurs exactly once. Work from the stock binary the update installed;
`apply` will back it up to `<target>.orig` on its own.

Done when `apply` on a `/tmp` copy prints `applied <digest>`, that copy paints and renders a code
block, and `probe ab` against the stock copy shows it is **never slower**. Faster is not the bar:
as Droid moves its own waits after paint, the paint gap shrinks toward zero, and an interval that
straddles zero at `-r 24` is a pass.

Budget: expect the mechanical half to be free and the hand half to be the work. The hand half
clusters: most of it is usually one or two sites Droid **rewrote** rather than renamed.

## 1. Triage the drift

```bash
cp ~/.local/bin/droid /tmp/droid-stock
bun run ovrdroid status                 # the missing list
bun run probe anchors /tmp/droid-stock
```

`anchors` re-finds each patch by identifier **shape** and prints one line per patch:

- `unchanged` / `rebased` with `old->new` renames: the mechanical part is done. `--json` prints
  the rebased `find`, `until` and `replace` for every patch with the renames already applied, so
  copy those in rather than renaming by hand.
- `missing`: the code moved or was rewritten. Step 3. Before assuming a rewrite, check whether
  only a **neighbour** moved: a `find` that reaches past the code its `replace` touches goes
  missing when that extra code changes. On 0.225.2 `session-search-warm-skip` carried a leading
  `if(S(te),` that Droid split into its own statement; trimming the `find` to `if(!t){…` fixed it.
  Keep every `find` to what its `replace` actually changes.
- `ambiguous N places`: the shape now matches N sites. Widen the `find` until it is unique.
  `anchors` turns every name into a wildcard, so a `find` that is mostly names (`K$=\``) becomes a
  shape matching thousands of sites. Anchor such patches on a neighbouring keyword or literal
  (`var Hz=\``) so they carry some shape of their own into the next release. The rename alone can
  tip a short `find` over: `,Oz=[` was unique on 0.224.1, but its new name `,_z=[` matched 2194
  places on 0.225.2. Extend it into the value it assigns (`,_z=["\u2554`), which is literal and
  does not rename.

`unresolved: X Y` on a rebased line is the part `--json` cannot do for you: a free name in
`replace` (a module-scope function, a React hook, a theme object) that the `find` never captured,
so the rename map never learned it. Step 3 resolves those. The list also includes the payload's
own bindings (arrow parameters like `T`, `let` locals, `globalThis` names like `__odUsage`), which
need no work. Read the payload and strike those first; what remains is the real list.

If **every** patch is missing at once, the drift is structural, not cosmetic: the module layout
changed under the harness (0.220.0 split one module into 496 chunks). Check `status`'s
`source N bytes across M modules` line against the last known good; a tiny N means the harness is
reading the wrong module. Fix `src/binary/` first, patches second.

## 2. Extract the source

```bash
bun run probe extract /tmp/droid-stock -o work/src/<version>
```

One file per module, `entry.js` plus `chunk-*.js`, ASCII, one line each. Keep the previous
release's extraction beside it: the diff between two releases is where the renames are.

## 3. Re-anchor each stuck patch

Start from a literal the minifier cannot rename (a log message, an event name, a `"draft-edited"`
action type, a `\uF418` glyph, `RGI_Emoji`) and walk outward to the code the patch touches.

**Do not reach for `grep` here.** A chunk is one 1.2MB line, which breaks the usual tools three
different ways: `grep -c` counts matching **lines**, so it reports `1` for a string occurring four
times; `grep -o -E '.{400}…'` dies with `invalid repetition count`; and a plain recursive `grep`
over 502 chunks times out. Two probe commands answer those questions instead, straight off the
binary, no extraction needed.

```bash
bun run probe grep /tmp/droid-stock 'gZ=58,hZ=24'          # can this literal anchor a patch?
bun run probe grep /tmp/droid-stock 'status:"ready"' -q    # verdict only, no surrounding code
```

`grep` prints the verdict first (`1 place … unique, so it can anchor a patch`, or `3 places across
3 modules … widen it`) and then each place with its chunk, offset and surrounding code. A patch
whose `find` is not unique fails the harness's own check later, so settle it here.

```bash
bun run probe names /tmp/droid-stock '<the rebased find string>' g x P je pc
```

`names` takes the patch's anchor, finds the chunk it sits in, and resolves each name **as that
chunk sees it**: imported (naming the chunk it comes from), defined locally (with the definition),
or free. Feed it exactly the `unresolved:` list from step 1. A name it calls free is a crash
waiting at runtime, not a warning.

This is also the trap that makes eyeballing wrong. In 0.220.0 `T6` was the wordmark; in 0.221.0
the wordmark moved to `O$` and `T6` became an unrelated markdown regex in a different chunk. A
rename carried over by hand would have compiled, shipped, and drawn garbage. `names` says which
one you have.

With splitting, React hooks arrive through the import header and are used bare: `useState` is `g`,
`useEffect` is `x`, `useRef` is `v`, `useCallback` is `A`, `useMemo` is `E`. Those letters are
release-scoped, so never carry them across a release. `names` only tells you which chunk a letter
is imported from. To learn which hook it is, read that chunk's wrappers, which name the hook
outright:

```bash
grep -oE '[A-Za-z0-9_$]+=function\([a-z,]*\)\{return [a-z]\.H\.use[A-Za-z]+' \
  work/src/<version>/<react-chunk>.js | sed -E 's/=function.*H\./ /'
```

One line per hook (`A useState`, `v useEffect`, …). On 0.228.0, `p` went from useState to a
session getter, and `A` went from the session getter to useState.

**Apply a rename map in one pass, never as a chain of find/replace.** Releases swap names:
on 0.228.0, `xe→be` and `be→Ee` both hit the same payload, so renaming them one after the other
turns every `xe` into `Ee`. Tokenise each payload and look up every identifier in the map once.
Skip only a name that follows a single `.` (a property access). A lookbehind that rejects any
preceding `.` also skips spreads, so `...qt.visibility` kept its old name on 0.228.0.

A patch that hangs a flag on a function (`X.$done`) must hang it on a name that both the writing
site and the reading site can see. Across chunks that means an **exported** name the reader
imports; `names` on the reader's anchor tells you which. That name is itself release-scoped: the
command-catalog snapshot was `$o` on 0.221.0 and `Go` on 0.222.0, and `$o` survived the release as
an unrelated terminal-service getter in a different chunk, so carrying it over would have compiled.

`names` proves a name **resolves**, not that it is the **right binding**. A big chunk reuses its
short names many times over, so `defined in this module` is usually a stranger, and an
`unresolved:` name that `--json` left untouched in `replace` is still the old release's name. Settle
every such name by **role**: read what it was at the old site (which destructured key, which prop,
which import, which hook), then find what plays that role at the new site. Reading the two
extractions side by side is the fastest way to do that. On 0.224.1, four names resolved cleanly and
all four were strangers, one of them swapping `ambiguousIsNarrow` for `countAnsiEscapeCodes`.
On 0.225.2 two letters traded roles in the footer: `useEffect` went from `D` to `I` while the
`statusState` prop went from `I` to `D`. A payload left on the old letters still compiles, then
calls a string as a hook and compares a function to `"idle"`.

When `names` calls a name **free**, it says the old name is dead, not what replaced it. The same
role search finds the replacement.

When the old site was **rewritten** rather than renamed (no shape match, and the literal you walk
out from lands in code of a different form), port the payload's intent into the new form instead of
forcing the old form back. On 0.224.1 the header dropped its named-style registry for inline style
objects, so the two patches that registered styles merged into the patches that paint.

Give payloads as few borrowed bindings as possible. Every chunk import, hook, or helper a `replace`
leans on is another name to re-derive next release, and another chance to bind a stranger. Node
built-ins and fixed paths never need borrowing: `require("fs")` and `require("os").homedir()` work
in any chunk, which is why ovrdroid's own files live under `~/.factory/ovrdroid/`.

Before re-anchoring, read what the old site did. When stock now does the same thing, delete the
patch rather than re-anchoring it: 0.220.0 shipped production React, and 0.224.1 stopped blocking
startup on the whoami call. The same goes for a site Droid removed outright. A literal can outlive
its code in an enum or phase registry. On 0.228.0, `SessionSearchWarm` still appeared once, in the
phase enum, but nothing called it any more, so `session-search-warm-skip` was deleted. When the
only remaining hit is a definition, check for a caller before re-anchoring.

Do not trust `rebased` on a patch with an `until`. `anchors` turns the tail's names into wildcards
and takes the first match anywhere after the `find`, even in a later module. On 0.228.0 the tail
`];var Gq=` came back `rebased` as `];var ot=`, but that string does not occur in the logo's chunk
at all: the array now ends `],a="Select…`. Check the rebased `until` with `probe grep` inside the
`find`'s own chunk. Anchor it on the literal that follows the span (a string or a keyword), as
`wordmark-compact-ovrdroid` does with `],a="Select Factory Router`.

### Rebase the shared payload constants, not just the patch entries

A `replace` assembled from module-scope constants (`TURN_CLOCK_TRACK`, `UPDATE_HEADER_LINE`,
`UPDATE_FILE_READER` in `src/patch/patches.ts`) holds release-scoped names **outside** the patch
entry, and `--json` hands you the fully expanded string without pointing at which constant to edit.
Rebase every constant the patch set names, then diff your expanded `replace` against the `--json`
one before building.

Nothing catches a stale name before the build, because **every gate up to that point grades `find`
alone**: `status` prints `pending` once each `find` is unique, `bun test` reruns those same finds,
and `verify` never reads the bundle. On 0.222.0 that let three patched header names ship into
`bun build`, which failed with `Cannot assign to import "Ie"`. Read that error as the signal it is:
a stale name that happens to collide with an import in the new chunk. The same mistake on a name
that collides with nothing compiles clean and crashes at runtime instead.

## 4. Re-anchor the tests too

`bun test` goes red on a release for two reasons, and only one of them is your patches. Tests that
evaluate a patch payload carry **their own** copies of release-scoped names, and those drift on the
same schedule:

- `src/patch/__tests__/command-menu.test.ts` builds the ranking function around the bindings the
  bundle gives it (`ue`, `de`, and the query `K` on 0.222.0). They rename with the patch. Read the
  whole preamble off the bundle rather than renaming the letters: on 0.222.0 the query variable and
  the entry variable both moved, and the preamble also has to keep the test's own shape, so
  `re.command.suggestionKind==="internal-menu"` from the bundle becomes `re.internalMenu` here.
- `src/patch/__tests__/stock-source.test.ts` pins the zod base class (`SCHEMA_CLASS`, `tn` on
  0.222.0). Find the new one from the constructor the patch matches, then read back to `class`.
- `src/patch/__tests__/denylist-patches.test.ts` rebuilds the pattern builder around the payloads:
  `STOCK_ARGUMENT_END` names the argument-end helper, and the wrapper's parameters name the last
  token. Both follow the builder (`r` and `l` on 0.228.0, `l` and `s` before).
- `src/patch/__tests__/heredoc-shell.test.ts` loads the parser chunk on its own, found by
  `PARSER_EXPORT`, and imports the splitter by its export name. The test takes the **first** module
  that contains the anchor, so the anchor must be unique across all chunks. `function Pm(` matched
  five chunks on 0.228.0, and the wrong one failed with `Cannot find module '/$bunfs/root/chunk-…'`.
  Anchor on the splitter's body (`function Pm(e,n){return A8(e,n).map(`).

A failure there is drift, not a bug. Fix the test's anchor the same way you fixed the patch's.

## 5. Prove it

```bash
bun test && bun run verify
cp /tmp/droid-stock /tmp/droid-test
bun run ovrdroid apply --target /tmp/droid-test
bun run ovrdroid status --target /tmp/droid-test     # applied <digest>
bun run probe ab -r 24 /tmp/droid-stock /tmp/droid-test
bun run probe highlight /tmp/droid-test              # rendered a highlighted code block
```

Stock paint has outliers several times the median, so `-r 8` rarely resolves anything; start at 24.

When a probe fails on the **stock** binary, the probe's model of Droid drifted, not your patches.
Fix the probe in `src/probe/` with a test, then rerun. 0.224.1 started exiting 130 on Ctrl-C, which
`probe ab` read as a crash.

No gate looks at the screen. A patch that paints (header lines, logo accents, footer text) can
build, pass every probe, and draw nothing or draw in the wrong place. Launch the copy and look.

`bun run ovrdroid apply` is the first gate that reads your `replace` strings at all, so treat its
`bun build failed` as a patch bug and not a harness one. `--version` proves nothing: it skips the
app. `probe ab` launches the binary in a PTY and waits for the input box, so a rebuild that boots
and then dies shows up as a timeout there.
`probe highlight` asks the model for a code block, which is the first thing that loads a chunk
by name at runtime; a chunk that fell out of the graph crashes there and nowhere earlier. Only
after the copy passes both: `bun run ovrdroid apply`.

`src/patch/__tests__/stock-source.test.ts` reruns every `find` against the installed binary, so
it is the regression gate for the next release: it goes red the moment Droid updates underneath.

Finish with `bun run ovrdroid hooks`. `update` runs it for you, but a release you rebased by hand
ends on a bare `apply`, which leaves the hooks in `~/.factory/hooks` built against the old release.
