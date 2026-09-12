# AGENTS.md

Guidance for coding agents working in this repo.

## What this is

A patch harness for the Droid CLI binary (`~/.local/bin/droid`). Droid ships as
a Bun standalone executable with its application bundle embedded as plain
JavaScript. This project reads that bundle, applies byte-level patches, and
re-signs the result.

The goal is startup performance first: stock time-to-interactive is ~1.17s, of
which ~0.5s is three serial blocking API calls and ~0.15s is a hardcoded
terminal probe timeout.

## The one rule that shapes everything

**Every patch replacement must be exactly the same byte length as what it
replaces.** The binary is code-signed and Mach-O; growing or shrinking any
region shifts following bytes and corrupts the layout. This is why patches are
literal find/replace pairs over minified text rather than generated code.

Same-length moves that are known to work:

| Move | Example |
| :-- | :-- |
| Swap a numeric constant | `,150)` to `,30.)` |
| Flip a boolean | `hidden:!0` to `hidden:!1` |
| Neutralize an await | `await ` to `/**/  ` (both 6 chars) |

After any edit the binary must be re-signed with `codesign --force --sign -`,
otherwise macOS sends SIGKILL on launch.

## Two languages, on purpose

- **The harness** is TypeScript on Bun. Normal code, normal tooling.
- **Patch payloads** are hand-written minified JavaScript. They land inside
  already-bundled code, so no compiler can reach them. Do not try to author
  them in TypeScript.

## Do not rebuild the bundle

`bun build --compile` fails on the extracted bundle (top-level await blocks
bytecode; a plain compile runs out of memory). It is also counterproductive:
bytecode is what makes Droid start in 0.09s for `--version` rather than 0.35s.
Patch in place; never rebuild.

## Verify before committing

```bash
bun run check    # bunx tsc --noEmit
bun test
```

Patch changes additionally need an end-to-end check on a **copy** of the
binary, never the installed one:

```bash
cp ~/.local/bin/droid /tmp/droid-test
# apply, then:
codesign --force --sign - /tmp/droid-test
/tmp/droid-test --version
```

## Conventions

- Errors to stderr, data to stdout.
- Never write to `~/.local/bin/droid` without an explicit backup first.
- Droid auto-updates (`~/.factory/update-policy.json`). A patched binary gets
  silently replaced, so any apply flow must detect version drift and re-apply.
- Offsets into the binary change with every Droid release. Always derive them
  by scanning for markers; never hardcode a byte offset.

## Measuring startup

`--version` is **not** a valid benchmark (0.09s, skips almost everything).
Measure time-to-first-paint in a real PTY by watching for the input box border
characters `╰` (U+2570) and `╮` (U+256E).

Droid has built-in instrumentation: `DROID_PROFILE=1` plus
`FACTORY_PROFILE_DIR=<dir>` writes `profile.jsonl`. Gotchas:

- It appends across runs. Always `rm -rf` the profile dir first, or timelines
  interleave and look nonsensical.
- `bootstrap_complete` and `ready` are `taskType: boundary` and carry no
  `startMonoMs`. Guard for that when sorting.
- It does not work on an extracted bundle run via `BUN_BE_BUN`; profile the
  real binary.

## Background

Full investigation notes, including the measured phase breakdown and the ranked
fix list, live in the handoff document referenced in `README.md`.
