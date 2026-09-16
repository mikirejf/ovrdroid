# Carrying the patch set across a Droid release

`ovrdroid update` fails with `markers not found (Droid version drift): <names>`. Every name is a
patch whose `find` no longer occurs exactly once. Work from the stock binary the update installed;
`apply` will back it up to `<target>.orig` on its own.

Done when `apply` on a `/tmp` copy prints `applied <digest>`, that copy paints, and
`probe ab` against the stock copy resolves faster.

## 1. Triage the drift

```bash
cp ~/.local/bin/droid /tmp/droid-stock
bun run ovrdroid status                 # the missing list
bun run probe anchors ~/.local/bin/droid
```

`anchors` re-finds each patch by identifier **shape** and prints one line per patch:

- `unchanged` / `rebased` with `old->new` renames: the mechanical part is done. Its `replace`
  still needs the same renames applied by hand, and any name it lists as `unresolved` is a
  free identifier in `replace` (a module-scope function, a React hook, a theme object) that the
  find string never captured, so you look those up in step 3.
- `missing`: the code moved or was rewritten. Step 3.
- `ambiguous N places`: the shape now matches N sites. Widen the `find` until it is unique.

If **every** patch is missing at once, the drift is structural, not cosmetic: the module layout
changed under the harness (0.220.0 split one module into 496 chunks). Check `status`'s
`source N bytes across M modules` line against the last known good; a tiny N means the harness is
reading the wrong module. Fix `src/binary/` first, patches second.

## 2. Extract the source

```bash
bun run probe extract ~/.local/bin/droid -o work/src/<version>
```

One file per module, `entry.js` plus `chunk-*.js`, ASCII, one line each. Keep the previous
release's extraction beside it: the diff between two releases is where the renames are.

## 3. Re-anchor each stuck patch

Start from a literal the minifier cannot rename (a log message, an event name, a `"draft-edited"`
action type, a `\uF418` glyph, `RGI_Emoji`) and walk outward to the code the patch touches.

```bash
grep -l -F '"draft-edited"' work/src/<version>/*.js       # which chunk
grep -o -F 'let C=A(()=>{w({type:"draft-edited"})' work/src/<version>/*.js | wc -l   # exactly 1
```

Count with `grep -o ... | wc -l`, never `grep -c`: a chunk is one line, so `-c` says `1` for a
string that occurs four times.

Names a patch needs beyond its `find` come from the chunk's import header (first ~2KB): with
splitting, React hooks arrive as `import{A,D,v,g}from"…chunk-4hgqprmy.js"` and are used bare, so
`rJ.useState` becomes `g`, `useEffect` becomes `D`, `useRef` becomes `v`, `useCallback` becomes
`A`. Confirm each by reading its definition in the exporting chunk (`g=function(t){return
i.H.useState(t)}`).

A patch that hangs a flag on a function (`X.$done`) must hang it on a name that both the writing
site and the reading site can see. Across chunks that means an **exported** name the reader
imports; read the reader's import line before choosing.

When a stock feature the patch replaced now ships upstream (0.220.0 shipped production React, so
the React swap went), delete the patch rather than re-anchoring it.

## 4. Prove it

```bash
bun test && bun run verify
cp ~/.local/bin/droid /tmp/droid-test
bun run ovrdroid apply --target /tmp/droid-test
bun run ovrdroid status --target /tmp/droid-test     # applied <digest>
bun run probe ab -r 8 /tmp/droid-stock /tmp/droid-test
bun run probe highlight /tmp/droid-test              # rendered a highlighted code block
```

`--version` proves nothing: it skips the app. `probe ab` launches the binary in a PTY and waits
for the input box, so a rebuild that boots and then dies shows up as a timeout there.
`probe highlight` asks the model for a code block, which is the first thing that loads a chunk
by name at runtime; a chunk that fell out of the graph crashes there and nowhere earlier. Only
after the copy passes both: `bun run ovrdroid apply`.

`src/patch/__tests__/stock-source.test.ts` reruns every `find` against the installed binary, so
it is the regression gate for the next release: it goes red the moment Droid updates underneath.
