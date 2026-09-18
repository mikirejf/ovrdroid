# Carrying the patch set across a Droid release

`ovrdroid update` fails with `markers not found (Droid version drift): <names>`. Every name is a
patch whose `find` no longer occurs exactly once. Work from the stock binary the update installed;
`apply` will back it up to `<target>.orig` on its own.

Done when `apply` on a `/tmp` copy prints `applied <digest>`, that copy paints, and
`probe ab` against the stock copy resolves faster.

Budget: 0.222.0 took 16 patches rebased automatically, 6 by hand, and 2 test files whose own
anchors had drifted. Expect the mechanical half to be free and the hand half to be the work.

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
- `missing`: the code moved or was rewritten. Step 3.
- `ambiguous N places`: the shape now matches N sites. Widen the `find` until it is unique.

`unresolved: X Y` on a rebased line is the part `--json` cannot do for you: a free name in
`replace` (a module-scope function, a React hook, a theme object) that the `find` never captured,
so the rename map never learned it. Step 3 resolves those.

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
release-scoped; `names` re-derives them in one call, so never carry them across a release.

A patch that hangs a flag on a function (`X.$done`) must hang it on a name that both the writing
site and the reading site can see. Across chunks that means an **exported** name the reader
imports; `names` on the reader's anchor tells you which. That name is itself release-scoped: the
command-catalog snapshot was `$o` on 0.221.0 and `Go` on 0.222.0, and `$o` survived the release as
an unrelated terminal-service getter in a different chunk, so carrying it over would have compiled.

When `names` calls a name **free**, it says the old name is dead, not what replaced it. Find the
replacement by the shape it must have, in the chunk the anchor sits in: an `fs` or `path` default
import is `import <name> from"fs"`, so search the extracted chunk for that and read the binding off
it. On 0.222.0 that turned the reader's `Dc`/`Ff` into `Hoe`/`rne`.

When a stock feature the patch replaced now ships upstream (0.220.0 shipped production React, so
the React swap went), delete the patch rather than re-anchoring it.

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

A failure there is drift, not a bug. Fix the test's anchor the same way you fixed the patch's.

## 5. Prove it

```bash
bun test && bun run verify
cp /tmp/droid-stock /tmp/droid-test
bun run ovrdroid apply --target /tmp/droid-test
bun run ovrdroid status --target /tmp/droid-test     # applied <digest>
bun run probe ab -r 8 /tmp/droid-stock /tmp/droid-test
bun run probe highlight /tmp/droid-test              # rendered a highlighted code block
```

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
