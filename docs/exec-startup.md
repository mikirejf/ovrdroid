# `droid exec` startup: the connectors catalog wait

Measured on Droid 0.218.2 and 0.219.0. Not patched, because the interactive TUI does not pay for it.

## The cost

Droid 0.219.0 added a blocking wait for the connectors tool catalog to `exec` startup. It costs
**~450ms on every `droid exec` launch**, `--help` included: `probe exec --stage help -r 30`, n=30
paired, first byte 450ms slower (CI 387 to 513).

## Where it is

Droid's profile shows a new blocking phase, `catalog_ready` (median 581ms), between `handler_import`
and the handler. In order, exec startup:

1. Warms feature flags.
2. Starts `catalog_prime` in the background.
3. Awaits `catalog_ready`, a 2.5s timeout race on that same promise.

The prime returns at once unless the `connectors` flag is on. With it on, it fetches the catalog
revision (`GET toolsRevision`, 2s cap) and on a miss the tool list (`POST toolsList`, 10s cap).

## Verified with the flag off

`FACTORY_FEATURE_FLAGS_OVERRIDES='{"connectors":false}'` drops both phases to ~0ms.

| Binary                        | First byte, median |
| :---------------------------- | -----------------: |
| 0.218.2 stock                 |              949ms |
| 0.219.0 stock                 |             1316ms |
| 0.219.0 stock, connectors off |              819ms |

Without the wait, 0.219.0 is ~130ms faster than 0.218.2. The rest of that release was a win.

## Why it is not patched

The TUI runs the same wait, but the input box paints before it resolves: `probe ab -r 20` with and
without the flag gave 965ms and 966ms (CI -118 to 226). If exec speed matters later, drop only the
`catalog_ready` await. The agent turn already fetches the catalog lazily with its own 2.5s cap when
nothing is primed.

## Notes

- `probe exec` strips `FACTORY_*` from the child, so the flag override needed a wrapper script
  (`work/bins/droid-0.219.0-nocatalog`).
- Old Droid releases have no download URL. Stock and patched 0.218.2 are kept under `work/bins/`
  (gitignored), with extracted sources under `work/src/`.
