# Carrying the patch set across a Droid release

Patches do not carry release-scoped names. `apply` and `status` re-find every patch by identifier
**shape** on the target build (`src/patch/rebase.ts`, tokenizer in `src/patch/tokens.ts`), rename
the `replace` to match, and only then patch. A release that only renames needs no hand work, and
one patch set fits both supported builds (darwin-arm64 and linux-x64), whose minified names differ.

The hand work is the patches the rebase cannot settle. They surface as
`markers not found (Droid version drift): <name> (<reason>)`.

A new release reaches the Mac when you run `ovrdroid update`. It follows Factory's
`factory-cli/LATEST`, and the session header says `↓ vX available · run ovrdroid update`. When the
patch set does not fit, `update` stops with the drift list and leaves the installed Droid and its
`.orig` untouched. Linux boxes never fetch a release on their own: they run `ovrdroid sync` on a
timer, which installs the version `update` pinned in `droid-version` on the Mac. The pre-push hook runs `probe builds` against the same newest release, so
it blocks every push until the drift is fixed. Start here.

Done when the gate passes for the new release. The gate (`ovrdroid gate`, run for you by `update`
when it moves to a new Droid version) covers speed against stock (`probe ab` never slower), prompt
cache, compaction, MCP servers, sub-agents, the tools sent to the model, and `probe builds` for every platform. Faster is
not the bar: as Droid moves its own waits after paint, the paint gap shrinks toward zero, and an
interval that straddles zero at `-r 24` is a pass. Then record what you learned (step 7) and
commit `droid-version` and `gate-pass.json` together with the patch changes.

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

When many patches across unrelated areas drift at once, look for a **reworded log prefix** before
anything else. Upstream renaming a module's log tag (`[Foo] …` to `[Bar] …`) breaks every `find`
and lookup that quotes one of its messages, while the code beside them is unchanged. `probe grep`
the message without its prefix: the new wording is the single hit, and the fix is a string edit in
`find`, `replace` and lookups alike, so payload log lines keep matching stock's format.

Fix by reason:

- `missing`: first ask whether the patch is still needed (step 3 opens with that). If it is, the
  code moved or was rewritten. Before assuming a rewrite, check whether only a **neighbour** moved:
  a `find` that reaches past the code its `replace` touches goes missing when that extra code
  changes, for example when Droid splits a leading call into its own statement. Keep every `find`
  to what its `replace` actually changes. A patch that only inserts code before a function needs
  nothing from its parameter list but the name: a destructured parameter that turns into
  shorthand (`t:n` to `t`) sends a `find` that quotes the whole list `missing`.
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
- `no-lookup` with several matches: the lookup snippet is not unique in the module. Widen it, or
  pick a different use of the same binding.
- `no-lookup` with no match: usually only the snippet's **surroundings** moved, not the binding it
  captures, such as a leading keyword or an argument the payload never reads. Trim the lookup to
  the names the `replace` uses plus just enough text to match once in its module. A lookup only
  captures names, so every character past that can drift.

To find **which** lookup broke (the report names only the patch), feed each one to
`probe grep $STOCK`. Grep only its stable part: names longer than 3 characters, dotted properties,
strings. The lookup is written in one build's short names, so a literal grep of the whole snippet
can miss on a build where it would still match. The lookup that comes back with no place, or with
several in the `find`'s chunk, is the broken one. When even the stable part finds nothing, shrink
it further (one property like `modelContent:`) and read every place it prints. The new form of
the line is one of them.

When you rewrite a lookup, prefer one that captures its binding from a structural use (a call
shape, a property chain) over one that quotes a log message: log text is reworded more often than
code. `probe grep` counts across all modules, but a lookup is matched only in
the `find`'s module, so "2 places across 2 modules" can still be fine for a lookup. Check the chunk
names.

When the `find` still matches and only a lookup broke, the code the patch rewrites is usually
unchanged. Do not port anything. Still read the patched site in the new extraction for two things:
upstream may now do what the payload adds, and the change around the binding may break something
the payload assumes about it. For example, a payload that reassigns a binding needs it to stay in
a `let`, not move into a `const`.

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

- **The fix may be older than this release.** A patch can keep matching after upstream fixed the
  problem some other way, and then do nothing until a neighbouring edit finally makes it go
  `missing`. Read the stock code for what it does now, not just the diff since the last release.

When you delete a patch, check its **companion** patches in the same file too. A patch that still
matches can be dead: it styled rows of a list upstream removed, and the code it hooks is now shared
by other rows that never carry its field. A clean `rebased` says nothing about whether anything
still reaches the payload.

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

Feed `names` the **rebased** `find` from `probe anchors --json`, not the source `find`, which is
in another build's names and finds no module. It reports a function's own parameters and names
bound by destructuring (`{key:X}=hook()`) as an unrelated same-letter definition, or as free.
Settle those from the `find` itself: if the `find` binds the name, it is the right one.

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
- `rm-safety-patches.test.ts` carries three copies of stock code, each patched by its own payload:
  the Execute tool's hard block list (`STOCK_HARD_BLOCKS`), the rules engine's `rm` safeguard
  (`STOCK_GUARD`: its `P`, `xe`, `V`, `Ee` and `T` functions, with stand-ins for the dequoting
  helpers) and the shell-word screen the runtime safeguards use (`STOCK_SCREEN`). Copy each off the
  bundle again when its patch goes `missing`.
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
- Match a minified name with `[\w$]+`, never `\w+`: the minifier hands out `$`-prefixed names, and
  a regex that skips them breaks the release it first picks one.
- Compare a stock piece with `holePattern`, which ignores minified names (`stock-source.test.ts`).
- A test that writes a chunk to `/tmp` and imports it must write the chunk's whole import closure,
  with `/$bunfs/root/` rewritten to `./`, or it fails with `Cannot find module`.
- A test that cuts a function body out of its module must also carry the module-level `var`s the
  body uses (`scanner-source.ts` prepends every `var NAME="…"`), or the evaluation throws
  `… is not defined`.
- Assert a patch landed by its rebased `replace` (`rebasedNamed(name).replace`), never by a
  literal in one build's names: `toContain('toolUseId:a.id')` fails on the first rename.
- A test that runs a payload with a copied stock tail can close the function right after the
  patched expression and return the value under test, rather than faking the I/O that upstream
  keeps adding to the body.
- The 400-line lint limit applies to test harnesses too. Move a helper into its own file
  (`mcp-fake-fs.ts`, `scanner-source.ts`) instead of trimming code.

These tests read the **host's installed** build (or its `.orig`). Until the host runs the new
release they test the old one, so before the real install they fail for patches you already fixed,
and they cannot see the new release at all. Expect that. The order is: copy passes step 6's probes,
`ovrdroid update` for real, then `bun test` must be fully green.

The gate's `test` check automates this: it runs `bun test` with `HOME` pointed at a scratch
directory holding the target and its stock as `.local/bin/droid` and `droid.orig`, so the tests see
the new release before it is installed. By hand, do the same: point `HOME` at a scratch directory
whose `.local/bin/droid` is a copy of the new stock binary, and run the tests for the patches you
changed there.

Run the **whole** `bun test` that way before the gate, not only the tests for patches you changed.
Patch sets the build does not ship (the render counters, instrumentation) are not in `probe
builds`, so their drift shows up only in the gate's `test` check, and the gate cannot rerun one
check: a red there costs a full rerun of every probe.
`bun test` can exit 1 with `0 fail`: a stock-reading helper that throws while a file loads shows
up as `N errors` and `# Unhandled error between tests`, and that file's tests never run. Search
the output for that header, not only for `(fail)`.

When a patched method's stock text changes but the patch still applies, the payload may silently
drop the new upstream behaviour. `stock-source.test.ts` and `probe hub` flag it, and the gate's
`test` check runs them against the new release, so read a red there as a payload to update, not
noise.

When several people or agents fix drift in parallel, a test that applies only its own file's
patches (`rebaseAll` on that list, not the whole set) keeps working while the other files are
still mid-edit. A deleted patch file breaks every probe until the list that imports it is fixed,
so delete the import in the same change.

## 5. Install the new release on a copy

```bash
bun run probe builds                     # every platform, newest release; rerun until clean
rm -f /tmp/droid-test /tmp/droid-test.orig
bun run ovrdroid update --target /tmp/droid-test   # installs the newest release for this host, sha256-verified, applies
```

`ovrdroid update` installs Factory's newest release for the host (darwin-arm64 or linux-x64) and
checks its sha256 before applying. A target that does not exist yet counts as not on that release,
so a fresh `/tmp` path runs the same install-then-apply path every machine runs.
Before it finishes, `update` builds to `<target>.tmp` and runs the gate on that build. A failure
leaves the target, its `.orig` and `droid-version` untouched, deletes the build, and prints which
check failed and where its log is (`~/.cache/ovrdroid/gate/<version>-<digest>/<check>.log`).
Then prove it, below, and push. The real `ovrdroid update` pins the new version in `droid-version`
only when `gate-pass.json` covers that version; push both files. The stamp key is the Droid
version and the Bun version (`BUILD_BUN_VERSION`); the patch digest is recorded, not compared, so a
patch change alone needs no gate run. Within
15 minutes each Linux host pulls ovrdroid and runs `ovrdroid sync`, which runs no probes and
refuses a pin the stamp does not cover. Otherwise it installs the pinned version. A patch set that
fits only one platform makes that step fail, and the host keeps its current Droid. The `builds`
check catches it.

## 6. Prove it

The gate runs the after-update checks for you: `update --target /tmp/droid-test` already ran it, so
a copy that finished installing has passed them. The list is `src/gate/checks.ts`.

```bash
bun run ovrdroid status --target /tmp/droid-test     # applied <digest>
bun run ovrdroid update                              # only now, the real install; the stamp from the copy run covers it, so the gate is skipped
bun test                                             # green against the installed new release
```

On a FAIL, read that check's log under `~/.cache/ovrdroid/gate/<version>-<digest>/`. While fixing,
rerun just that probe by hand instead of the whole gate: `bun run probe <name> <binary>`
(`probe --help` lists them). Stock paint has outliers several times the median, so `probe ab` at
`-r 8` rarely resolves anything; the gate uses 24.

When a probe fails on the **stock** binary, the probe's model of Droid drifted, not your patches.
Fix the probe in `src/probe/` with a test, then rerun. When Droid started exiting 130 on Ctrl-C,
`probe ab` read it as a crash until the probe learned that exit code.

A failing gate check can be the check, not Droid. Before fixing a patch, run the probe on stock and
on the previous release's patched build. A check that fails on both was drifted or broken: a footer
string Droid dropped a release earlier, a wait that returned on the launch result instead of the
completion notice, a cache rule stricter than Droid's own tail churn, a probe that sent a settings
`${VAR}` api key literally. Fix the probe, with a test, before touching a patch.

Probes that read `~/.factory/settings.json` must expand `${VAR}` references the way Droid does
(`expandEnv` in `src/probe/credentials.ts`).

No gate looks at the screen. A patch that paints (header lines, logo accents, footer text) can
build, pass every probe, and draw nothing or draw in the wrong place. Launch the copy and look.

`bun run ovrdroid apply` is the first gate that reads your `replace` strings as code, so treat its
`bun build failed` as a patch bug and not a harness one. `--version` proves nothing: it skips the
app. `probe ab` launches the binary in a PTY and waits for the input box, so a rebuild that boots
and then dies shows up as a timeout there.
Only after the copy passes the gate: `bun run ovrdroid update`, then push to main with
`droid-version` and `gate-pass.json`.

`src/patch/__tests__/stock-source.test.ts` reruns the rebase of every patch against the host's
stock binary, so it goes red the moment Droid updates underneath.

### Adding a check to the gate

A new behaviour probe joins the gate by an entry in `src/gate/checks.ts`. It must:

- cover speed, prompt cache, compaction, MCP servers, sub-agents or token cost; anything else stays
  an optional probe;
- exit non-zero exactly when the behaviour is broken, decided by a pure verdict function that has
  a test;
- fail, not pass, when the run could not exercise the behaviour (the feature never appeared, the
  session never started): a probe that cannot see the behaviour has proven nothing;
- run on Haiku (`PROBE_MODEL`) when it spends tokens, unless the behaviour is specific to a model
  family.

Leave out probes that only measure or query an API.

## 7. Record what you learned

Before you commit, add to this skill whatever the update taught you about the **workflow and the
techniques**: a way to find a broken site faster, a check that caught a mistake, a step the guide
was missing, a probe that answered a question. Put each lesson where the next agent will look for
it, usually beside the drift reason or step it belongs to.

Write the lesson so it holds for any release. Leave out version numbers, minified names, and the
code that moved this time; those belong in the commit message. If nothing new came up, add
nothing. Commit the skill change with the patch fix.
