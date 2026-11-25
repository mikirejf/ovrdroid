# Fixing a drifted patch

Lessons from past updates, keyed by what you see. Find your drift reason's heading, then the bullet
whose symptom matches. Keep this file to the rules in [UPDATING.md](UPDATING.md#8-fold-in-what-you-learned).

## Read the whole list first

- **Many patches in unrelated areas drift at once.** Upstream reworded a module's log prefix
  (`[Foo] …` to `[Bar] …`), breaking every `find` and lookup that quotes one of its messages.
  `probe grep` the message without its prefix; fix the string in `find`, `replace` and lookups
  alike, so payload log lines keep stock's format.
- **Several patches in one file drift together.** They share one stale module-scope constant: a
  `find` reused as another patch's lookup, or a lookup one file exports and others import. Read the
  shared constants first and fix the one in the file that owns it.
- **Every patch is `missing`.** The module layout changed under the harness. Compare `status`'s
  `source N bytes across M modules` with the last good run; fix `src/binary/` before any patch.

## Is the patch still needed?

Ask this for every `missing` patch before hunting for its new site. Read what the old site did,
then the stock code where it was, both extractions side by side. Often upstream fixed it:

- **The code is gone.** A literal can outlive its code in an enum or registry; check for a caller
  before re-anchoring on the one hit left.
- **Stock now does the payload's job:** a cheap call replaced the slow one (read it before calling
  it cheap), a guard now tests what the payload tests, or stock persists what the payload caches.
  Delete the patch.
- **Stock adopted part of the idea** (a field the payload added, its own optimistic or undo
  machinery). Use stock's version and keep only what stock still lacks; hook into upstream's handle
  rather than re-porting private flags, and delete companion patches that became dead.
- **The release notes say Droid does it now.** Notes describe server flags and often skip custom
  models. Find the flag or model list in the bundle, then launch stock on your model and watch.
- **A big release.** A patch can keep matching while stock already does its job, or while the code
  it hooks sits behind a flag that is off. Diff stock around every matching site between releases
  with minified names masked, and read the sites that changed.

When you delete a patch:

- Delete its tests and its import in the same change; a dangling import breaks every probe.
- Check its companions in the same file. A clean `rebased` says nothing about whether anything
  still reaches a payload (it may style rows of a list that is gone).
- When upstream drops a prop or callback, search the whole patch set for its name: a payload can
  list prop names as data that no `find` quotes.
- When upstream drops a whole feature, the companions spread to UI, roster, frontmatter and probes.
  Have a read-only agent classify every patch, probe and test that mentions it as dead, partly dead
  or live, with evidence from the new extraction. Names mislead across files.

## missing

- **The code is still there, nearly unchanged.** The `find` reaches past what its `replace`
  changes, and that extra code moved (a call split into its own statement, a parameter list that
  gained a parameter or turned `t:n` into `t`). `probe grep` a literal from the body on both
  releases, then cut the `find` to the span the `replace` edits.
- **The literal you walk out from lands in code of a different form.** Upstream rewrote the site;
  port the payload's intent (see [Porting rewritten code](#porting-rewritten-code)).

## ambiguous

- **The `find` is mostly names.** It matches by shape in many places. Anchor it on a neighbouring
  keyword or literal, or extend it into the literal value it assigns.
- **A new module copies your constants** (a timeout list declared twice). Widen into the whole
  declaration, then `probe grep` the result to confirm it is the module you meant.
- **Upstream added a second reader of the flag you patch.** Patch where the flag is built rather
  than where one reader reads it, so every reader, and the next, is covered.

## no-tail

- Re-anchor the `until` on the literal that now follows the span (a string, a keyword), not on
  names. The tail is searched only in the `find`'s module.

## no-lookup

Find which lookup broke by calling `rebasePatch` (`src/patch/rebase.ts`) on the extracted modules
with `lookups.slice(0, i)` for each `i`: the first `i` that reports `no-lookup` names it.

- **It matches several times.** A lookup made of short names and punctuation is unique as text but
  not by shape, and `probe grep` counts text. Widen it within its declaration until a literal or a
  dotted name pins it. It can break with its own site untouched when upstream adds a same-shaped
  function elsewhere in the module.
- **It matches nowhere, but the binding is still there.** Its surroundings moved. Trim it to the
  names the `replace` uses plus just enough text to match once.
- **Upstream stopped calling a helper where the lookup quoted it.** Capture the helper from its
  definition (`X=(a)=>…`), not from another call the next rewrite can drop.
- **The snippet is in the bundle, but in another chunk.** Capture the same binding from a use that
  stayed in the `find`'s module and check it with `probe names`; when none is left, move the `find`.
- **It quotes a function header.** Upstream added a parameter. Read what it does and check the
  payload's calls, which pass fewer arguments, never reach the code that reads it.
- **Only a lookup broke.** The rewritten code is usually unchanged; still read it for upstream now
  doing the payload's job, and for a binding that changed kind (a `let` the payload reassigns
  becoming a `const`).

Write lookups from a structural use (a call shape, a property chain) rather than a log message,
which is reworded more often. `probe grep` counts across all modules, but a lookup is matched only
in the `find`'s module, so check the chunk names it prints.

## unresolved

- Add a lookup from the same module that binds the name, widen `find` or `until` to reach it, or,
  when the payload owns it (a parameter, a `let`, a `globalThis` name), rename it `$OD…`.

## collides

- A lookup or `find` captures the wrong binding for one of the two names. Settle both by role
  ([below](#settle-every-name-by-role)).

## Finding the new site

Start from a literal the minifier cannot rename (a log message, an event name, an action type, a
glyph) and walk outward to the code the patch touches. Use `probe grep`, `probe names` and
`probe hooks`: a chunk is one line, often over a megabyte, so shell `grep -c` counts lines, long
`-E` context patterns fail, and a recursive grep times out. A `find` is written in whichever build's
names its author had open, so search the other platform by shape, or read the rebased text with
`probe anchors --json`.

## Settle every name by role

- **`probe names` says a name resolves.** That proves it exists, not that it is the right binding:
  a chunk reuses short names many times. Read the name's role at the old site (which destructured
  key, prop, import or hook), find what plays that role at the new site, and capture it with a
  lookup shaped like that role. Two letters can swap roles in one release.
- **`probe names` calls a parameter free or unrelated.** It misreads a function's own parameters
  and destructured names. Settle those from the `find` itself, and feed `names` the rebased `find`
  from `probe anchors --json`, not the source `find`.
- **A hook letter.** Hooks arrive through the import header under names that change per release;
  `probe hooks <binary> '<find>'` names them. Capture a hook with a lookup that uses it.
- **It rebased cleanly and reads garbage at runtime.** A lookup captured a neighbouring function's
  local, which the splice point cannot see. Capture a module-scope binding (an import, a getter),
  call it inside the payload, and test the payload spliced into real stock text.
- **A flag hung on a function (`X.$done`) is never seen.** Writer and reader sit in different
  chunks. Hang it on an exported name the reader imports; `probe names` on the reader's anchor says
  which.

## Porting rewritten code

- Port the payload's intent into the new form instead of forcing the old form back. When inline
  styles replace a style registry, the patches that registered styles merge into those that paint.
- **Upstream split one method in two** (a thin wrapper around a new method holding the old body).
  Move the patch onto the method with the old body and rename the patch to match.
- **The payload replaces a whole method.** Diff the old and new stock text of every method it
  replaces, not just the `find`, and port each new guard (a `shuttingDown` check, say).
- **A value the payload reads changed shape** (a list became one verdict, a boolean a mode string).
  `.length>0` keeps compiling and silently switches the payload off. Read every value it consumes
  in the new extraction, and test each shape and mode.
- **A setting's API changed** (boolean to enum, a flagged resolver, a legacy mapping). Follow the
  value through validation, mapping, flag-dependent resolution and persistence, and test setter and
  resolver together under each flag and after a reload from stored preferences.
- **The payload leaves a dormant placeholder in a stock object.** Audit new readers of that object:
  one may need to wake it before reading live state, another must read cached state without waking
  it. Test each reader as well as execution.
- **Upstream moved a step into a helper.** Call the helper instead of redoing the step: one borrowed
  binding instead of several, and upstream's validation comes free.

Borrow as few bindings as possible: each lookup is one more to keep working and one more chance to
bind a stranger. `require("fs")` and `require("os").homedir()` work in any chunk and need no lookup.

A `replace` built from module-scope constants is renamed as a whole, so the contract covers the
expanded string. A stale name in it that collides with an import fails `bun build` with
`Cannot assign to import`; one that collides with nothing compiles and crashes at runtime. A helper
one patch declares and another calls must land in the same module, or the build fails in
`assertPayloadNamesBound`; declare it inside the calling payload, or publish it with
`globalThis.$ODx=`.
