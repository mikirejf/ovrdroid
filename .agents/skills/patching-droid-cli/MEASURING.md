# Measuring Droid startup and exit

## Time to first paint

Droid is a TUI, so the number that matters is when the input box appears. Drive it from a PTY
(`pty.openpty` in Python, or a Node/Bun PTY) and stop the clock on the input box border
characters `╰` (U+2570) and `╮` (U+256E). A plain pipe changes Droid's behaviour and gives you a
different program to measure.

Discipline that keeps the numbers honest:

- Throw away the first run of each binary. A cold 269MB file reads slower, and the first run
  routinely lands 1s to 2.5s above the rest.
- Interleave the binaries (stock, patched, stock, patched) rather than running five of each in a
  block, so machine load spreads across both.
- Report the median of at least five runs plus the raw runs. Means hide the cold outlier.

Reference numbers for Droid 0.218.1 on an M-series Mac, stock against the four-patch set:

| Metric        | Stock  | Patched |
| :------------ | -----: | ------: |
| Paint         | 1.13s  |   0.70s |
| Exit          | 2.42s  |   0.87s |
| `--version`   | 0.09s  |   0.08s |

## Time to exit

Send `/exit` and Enter after paint, then time until the process exits. Exit is dominated by
telemetry flushes racing a shared deadline, so it varies more than paint and needs the same
interleaving and medians.

## Attribution before patching

Do this first; it tells you which phases are network and which are local.

- `FACTORY_AIRGAP_ENABLED=true` kills outbound calls. The gap between airgap and stock is the
  network's share of both startup and exit, and it caps what any patch can win.
- `DROID_PROFILE=1` with `FACTORY_PROFILE_DIR=<dir>` writes `profile.jsonl`. It **appends** across
  runs, so `rm -rf` the directory before each run or the timelines interleave into nonsense.
  `bootstrap_complete` and `ready` are `taskType: boundary` and carry no `startMonoMs`, so guard
  for that when sorting.
- Phases that all end at the same millisecond are waiting on one thing, not on themselves. Trace
  the shared dependency instead of optimising each phase.
- Profiling only works on a real binary. It does not work on an extracted bundle run through
  `BUN_BE_BUN`.

## Sanity, not just speed

A fast binary that cannot hold a conversation is a regression. After any patch, drive the patched
copy in a PTY: wait for paint, send a prompt whose answer you can assert on
(`reply with exactly: pong`), wait for the answer, then `/exit`. Check the newest file in
`~/.factory/logs` for errors inside your run window.
