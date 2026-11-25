# Tests that go red on a new release

Lessons from past updates, keyed by what you see. Keep this file to the rules in
[UPDATING.md](UPDATING.md#8-fold-in-what-you-learned).

A red test on a new release is either your patch or the test's own copy of stock code, which drifts
on the same schedule and which the rebase never touches. Tell them apart first:

- **`bun test` exits 1 with `0 fail`.** A stock-reading helper threw while its file loaded: search
  the log for `# Unhandled error between tests`. That file's tests never ran.
- **Many `… applies on top of every other shipped patch` tests fail with one drift list.** They all
  apply the whole set; count them as one failure until step 3 is clean, and look past them.
- **A test fails for a patch you never touched.** It may belong to a patch set the build does not
  ship (render counters, instrumentation), which `probe builds` never checks. Only the full suite
  sees it.

## Tests that carry a copy of stock code

Copy the code off the new bundle again when the patch it feeds goes `missing`. Renaming letters by
hand misses real changes.

- **`command-menu.test.ts`** wraps the payload in the opening of stock's command ranking function.
  Keep the test's own `internalMenu` field where stock reads the suggestion kind.
- **`rm-safety-patches.test.ts`** carries three copies, each patched by its own payload:
  `STOCK_HARD_BLOCKS` (the Execute tool's block list), `STOCK_GUARD` (the rules engine's `rm`
  safeguard, with stand-ins for the dequoting helpers) and `STOCK_SCREEN` (the shell-word screen).
- **`mcp-hub-stock.ts`** is stock's MCP hub class in fixed names, patched and run by
  `mcp-idle-harness.ts`. `stock-source.test.ts` checks each piece still occurs in the bundle up to
  minified names. When a piece fails, run `bun run probe hub $STOCK` (stock only): it diffs every
  piece, votes out the renames, and prints the new method in fixture names. Before pasting it:
  - give every new outside name it reports a stand-in in the harness's `BINDINGS` and arguments,
    and check each name it left unmapped;
  - settle a tie it left in the bundle's spelling by reading the code;
  - split any two stock bindings the vote merged into one letter (the `holePattern` count drops to
    0 when it does);
  - read each change: a copy that takes only the first of two new guards still passes;
  - it reads only `async` methods, so trust `stock-source.test.ts` on a sync method it calls gone.

When a patched method's stock text changes but the patch still applies, the payload may silently
drop the new behaviour. A red `stock-source.test.ts` or `probe hub` there is a payload to update.

## Writing a stock-reading test that survives renames

Every other stock-reading test finds its code by shape, so it survives renames and both platforms.

- **Find code by shape.** A regex of the function body, its export name read from the module's
  `export{…}` (`denylist-heredoc.test.ts`). Match a minified name with `[\w$]+`; `\w+` breaks the
  release the minifier first hands out a `$` name.
- **Take stock names from the rebase, never from a letter.** Count `rebase.find` from `rebaseAll`,
  not a raw `PATCH.find`; read a captured binding with `renamed(rebase)`
  (`session-mention-keys.ts`); slice stock text on rebased markers. Assert a patch landed by
  `rebasedNamed(name).replace`.
- **A stub keyed on a name binds nothing.** `renamed(rebase)` maps only names the `replace` uses; a
  name read from a `find` or lookup that the payload never names comes back in the source build's
  spelling. Find that binding by its role in the stock text.
- **A literal became a constant reference** (`llmId:"X"` to `llmId:K.X`). Match both forms, and
  check the constant's value in the reference form.
- **Compare a stock piece** with `holePattern`, which ignores minified names.

## Evaluating stock code in a test

- **`Cannot find module` from a chunk written to `/tmp`.** Write its whole import closure, with
  `/$bunfs/root/` rewritten to `./` (`denylist-heredoc.test.ts`).
- **`… is not defined` after cutting a function out of its module.** Carry the module-level
  declarations the body uses; `module-closure.ts` collects them.
- **A `SyntaxError` inside the evaluation.** The import stripper missed a form the minifier emits:
  namespace, default, combined, or a Node built-in that is not a record in the binary.
- **`import.meta is only valid inside modules`** under `new Function`. Replace each `import.meta`
  with a stand-in parameter carrying the test's own metadata and a `require` (`stock-scanner.ts`).
- **A harness evaluating several functions breaks when one moves chunk.** Evaluate each in its own
  chunk's scope and pass the names one imports from the other as overrides, read from the
  importer's `import` header. Resolve imports by lexical scope: a short name used as a local may
  also name an unrelated import.
- **A harness joining one file's finds defines a name under one build and calls it under another.**
  All of a file's finds must be in one build's names; re-anchoring one means rewriting the rest.
- **A payload with a copied stock tail.** Close the function right after the patched expression and
  return the value under test, instead of faking the I/O upstream keeps adding.
- **A renderer gained a pass over its cell grid.** Run the stock writers on the cells a patch
  guards and compare with stock; tests of the old drawing operations miss the new path.
- **A harness over 400 lines.** The lint limit covers tests; move a helper into its own file.

## Fixing in parallel

Split by patch file: each owner takes one file (or two that share constants) and every test that
imports it (`rg "from '../<file>.ts'" src/patch/__tests__`). A test that applies only its own
file's patches (`rebaseAll` on that list) keeps working while other files are mid-edit; a run of
the whole suite does not. Give a shared exported constant to the file that owns it, and rerun
`verify` and the whole `bun test` once every owner has reported.
