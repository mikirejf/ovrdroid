# Carrying the patch set across a Droid release

`ovrdroid update` installs Factory's newest release and applies the patch set. A release that only
renames needs nothing more: `apply` re-finds every patch by identifier shape on the new build
(`src/patch/rebase.ts`) and renames its `replace` to match. This guide covers the rest: the patches
the rebase cannot settle, reported as `markers not found (Droid version drift): <name> (<reason>)`.
`update` stops there and leaves the installed Droid and its `.orig` untouched. The pre-push hook
runs `probe builds` against the same release, so no push lands until the drift is fixed.

**Done** when the gate passes on the new release, `droid-version` and `gate-pass.json` are committed
with the patch changes, and step 8 has folded this update's lessons into the guide.

Read [the patch contract](SKILL.md#the-patch-contract) before editing any patch: it says which names
a `find`, `until`, `lookups` and `replace` may use.

The steps are below. The lessons from past updates sit in three files, each opened only when its
step needs it:

- [UPDATING-DRIFT.md](UPDATING-DRIFT.md): a patch drifted (step 3).
- [UPDATING-TESTS.md](UPDATING-TESTS.md): `bun test` is red against the new release (step 5).
- [UPDATING-GATE.md](UPDATING-GATE.md): a gate check failed (step 6).

## 1. Read the drift

```bash
bun run probe builds                    # every platform, newest release; exits non-zero on drift
STOCK=~/.cache/ovrdroid/droid-<new>/darwin-arm64/droid
bun run probe anchors $STOCK            # one line per patch; --json prints the rebased text
```

`probe builds` caches each platform's stock binary at that path. Work from those files: the
installed Droid is still the old release. `unchanged` and `rebased` patches are done. The drift list
is usually the same on both platforms, so fix it on one build and let `probe builds` prove the
other.

| Reason       | Meaning                                                               |
| :----------- | :-------------------------------------------------------------------- |
| `missing`    | the shape of `find` occurs nowhere                                    |
| `ambiguous`  | the shape occurs in more than one place                               |
| `no-tail`    | `find` matched, but `until` no longer follows it in that module       |
| `no-lookup`  | a lookup matched zero or several times in the `find`'s module         |
| `unresolved` | a short name in `replace` is captured by nothing (`free names:` says) |
| `collides`   | two names in `replace` map to one name on this build                  |

Read the list as a whole before fixing patches one by one: drift clusters, and one cause often sends
many patches stuck at once ([UPDATING-DRIFT.md](UPDATING-DRIFT.md#read-the-whole-list-first)).

## 2. Extract both releases

```bash
bun run probe extract $STOCK -o work/src/<new>
bun run probe extract <old stock> -o work/src/<old>
```

One file per module, each one line. Diff the two to see what upstream renamed or rewrote. Query a
literal with `probe grep`, `probe names` and `probe hooks`, which read the binary directly; read
around a hit in the extraction with `rg -o '.{0,200}<needle>.{0,300}' work/src/<new>`.

## 3. Fix each stuck patch

For every `missing` patch, first ask whether upstream made it obsolete. Then fix it by its reason.
Both are in [UPDATING-DRIFT.md](UPDATING-DRIFT.md). Delete an obsolete patch together with its tests
and record the evidence (the absent literal, the new stock code) in the commit message.

**Done** when `bun run probe builds` exits 0.

## 4. Build a copy

```bash
cp $STOCK /tmp/droid-test && rm -f /tmp/droid-test.orig
bun run ovrdroid apply --target /tmp/droid-test
bun run ovrdroid status --target /tmp/droid-test     # applied <digest>
```

`apply` is the first step that reads your `replace` strings as code, so `bun build failed` is a
patch bug, not a harness one.

## 5. Run the whole test suite against the new release

Tests read the installed Droid and its `.orig`, which are still the old release. Point `HOME` at a
scratch folder that holds the copy instead:

```bash
H=$(mktemp -d) && mkdir -p $H/.local/bin
cp /tmp/droid-test $H/.local/bin/droid && cp /tmp/droid-test.orig $H/.local/bin/droid.orig
HOME=$H bun test > /tmp/update-tests.log 2>&1
```

Run the whole suite, not only the tests for patches you changed: the gate's `test` check runs the
same thing, and a red there costs a full rerun of every gate check.

**Done** when the log shows `0 fail` and no `# Unhandled error between tests`. Otherwise read
[UPDATING-TESTS.md](UPDATING-TESTS.md).

## 6. Gate the copy

```bash
bun run ovrdroid gate --target /tmp/droid-test --stock /tmp/droid-test.orig
```

The checks are `src/gate/checks.ts`, and the rules they follow are in `AGENTS.md` under "Update
gate". Each check logs to `~/.cache/ovrdroid/gate/<version>-<digest>/<check>.log`.

**Done** when every check passes and `gate-pass.json` names the new version. On a failure read
[UPDATING-GATE.md](UPDATING-GATE.md).

## 7. Look at it, then install

No gate check looks at the screen. Launch `/tmp/droid-test` and look at every patch this update
touched that paints (header, logo, footer, rows): a painting patch can pass every probe and draw
nothing, or draw in the wrong place. For a setting a patch extends, drive the real settings row in a
terminal one step at a time and read the row and the settings file after each step.

```bash
bun run ovrdroid update      # the real install; the stamp from step 6 covers it, so no gate rerun
bun test                     # green against the installed new release
```

Commit `droid-version` and `gate-pass.json` with the patch changes. Each Linux host pulls within 15
minutes and runs `ovrdroid sync`, which installs the pinned version and refuses a pin the stamp does
not cover. For proof that the build compiles on Linux itself, see
[UPDATING-GATE.md](UPDATING-GATE.md#native-linux-build-proof).

## 8. Fold in what you learned

These files stay useful only while they stay short, so a lesson more often replaces text than adds
it. For each thing this update taught you:

1. **Keep only lessons.** A lesson holds on the next release too and changes what the next agent
   would do. Version numbers, minified names and the code that moved go in the commit message.
2. **Turn it into a check when you can.** A lesson the harness can enforce (a build assertion, a
   test, a probe verdict) becomes that check, and the guide keeps at most one line naming it.
3. **Find its home.** It goes under the heading where its symptom shows up, written symptom first:
   what the agent sees, then the cause, then the fix.
4. **Merge before you add.** When a bullet already covers the symptom, rewrite that bullet to cover
   both cases. A new bullet is for a new symptom.
5. **Prune what you passed.** In every section this update used, delete bullets it proved wrong,
   bullets naming code or tools that are gone, and bullets a check now enforces.

`src/patch/__tests__/patching-skill.test.ts` (part of `bun test`) holds every file in this skill to
a line budget and fails on a file path or probe command that no longer exists. The budgets are
fixed: when a file runs over, merge or cut bullets until it fits.
