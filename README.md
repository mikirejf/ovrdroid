# overdroid

A patch harness for the [Droid CLI](https://docs.factory.ai/droid-cli/overview).

Droid ships as a Bun standalone binary with its application bundle embedded as
plain JavaScript. This project locates that bundle, applies byte-level patches,
and re-signs the binary so macOS will run it.

Status: **scaffold only.** No implementation yet.

## Why

Measured on a real terminal, time until the input box appears:

| Setup | Time to interactive |
| :-- | :-- |
| Stock | 1.17s (up to 2.9s under load) |
| Without startup network calls | 0.72s |
| Projected, after probe + cert fixes | ~0.55s |
| Hard floor (Bun boot + module import) | ~0.45s |

Most of the gap is three blocking Factory API calls (`whoami`, then
`feature-flags` and `managed-settings` behind it) plus a hardcoded 150ms
terminal capability probe.

## How it works

1. **Locate** the embedded bundle by scanning for Bun's `// @bun @bytecode`
   header and its `//# debugId=<hex>` footer. Offsets move every release, so
   they are always derived.
2. **Patch** with literal find/replace pairs. Every replacement is the exact
   same byte length as what it replaces, because the binary is code-signed and
   cannot shift.
3. **Re-sign** with `codesign --force --sign -`. Without this macOS kills the
   process on launch.

The original binary is always backed up first.

## Layers

The harness is deliberately three separate things, in increasing fragility:

1. **Plugin and hooks.** Official Factory extension points. Separate processes,
   survives updates, no patching. Covers subagents, commands, and lifecycle.
2. **Extracted bundle plus `--preload`.** A development tool for iterating on a
   patch. Runs 4x slower because it loses bytecode, so it is not for daily use.
3. **Patched binary.** What you actually run. Breaks on every Droid update and
   must be re-applied.

## Setup

```bash
bun install
bun run verify
```

## Safety

- Droid auto-updates and will silently replace a patched binary. Disable it in
  `~/.factory/update-policy.json` before relying on a patch.
- Never patch `~/.local/bin/droid` in place without a backup.
- Test on a copy first.
