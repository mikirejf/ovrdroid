# Measuring Droid startup and exit

## Time to first paint

Droid is a TUI, so the number that matters is when the input box appears. Drive it from a PTY
(`pty.openpty` in Python, or a Node/Bun PTY) and stop the clock on the input box border
characters `╰` (U+2570) and `╮` (U+256E). A plain pipe changes Droid's behaviour and gives you a
different program to measure.

Discipline that keeps the numbers honest:

- Throw away the first run of each binary. A cold 269MB file reads slower, and the first run
  routinely lands 1s to 2.5s above the rest. On a machine under memory pressure the pages get
  evicted again within a minute, so an idle gap re-creates the cold run.
- Interleave the binaries (stock, patched, stock, patched) rather than running five of each in a
  block, so machine load spreads across both.
- Report a paired confidence interval, not a gap between medians. Identical binaries differ by a
  126ms standard deviation, so at ten runs nothing under ~80ms exists. If the interval contains
  zero, the honest result is "not resolved at this sample count".
- Alternate which binary launches first. Launching in a fixed order makes the second one look 39ms
  faster, which is enough to flip a result's sign.
- Answer the terminal's capability queries and scrub the environment: strip `FORCE_COLOR` and every
  `FACTORY_*`, `DROID_*` and `HERDR_*` variable, or you are measuring a different program. An
  inherited `FACTORY_DISABLE_SETTINGS_PERSISTENCE` disables whole features, so a patch that defers
  them measures zero and looks like a null result. See [`INSTRUMENTING.md`](INSTRUMENTING.md).
- Check the load average before believing a delta. At load 10 the same binary spans 0.6s to 2.7s,
  which swamps anything a patch can win. Record the load beside the result.
- Reject a run whose binary painted and then crashed or hung. A dead process reports a very fast
  paint and a near-instant exit.

Reference numbers for Droid 0.218.1 on an M-series Mac, stock against the five-patch set:

| Metric      | Stock | Patched |
| :---------- | ----: | ------: |
| Paint       | 1.23s |   0.68s |
| Exit        | 1.10s |       - |
| `--version` | 0.09s |   0.08s |

The exit figures above replace earlier ones taken with a clock that started 50ms after the first
Ctrl-C, which understated every exit time by up to that much.

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
- `BUN_OPTIONS="--cpu-prof --cpu-prof-interval=250 --cpu-prof-dir=<dir>"` works on the compiled
  binary and gives a `.cpuprofile` with `nodes`, `samples` and `timeDeltas`. Cut the samples at
  `first_paint` before aggregating, or post-paint work dominates the totals. Zero idle samples
  before paint means the waiting is gone and no further patch will help.
- **Two `.cpuprofile` files appear.** Droid spawns a second Droid during startup and it profiles
  itself too. Pick the one whose filename carries the pid you launched; picking by directory order
  profiles a different program on different runs.
- **Never rank frames by summed `timeDeltas`.** A delta is wall time since the previous sample, so a
  descheduling stall lands entirely on whichever frame was on top. A real profile showed 306ms
  charged to `readFile` from a **single** sample. Rank by `samples * median(delta)` and treat any
  frame whose raw sum exceeds that by more than ~2x as an artifact.
- **Always cut the samples to the window you are asking about.** A profile runs from process start,
  so ranking the whole thing ranks startup no matter what you did afterwards. Measuring a 1.6s
  typing window without a cut-off put a file watcher at the top at 81ms; splitting the samples at
  the first keystroke showed the watcher was ~150ms of **startup** crawl and 1-13ms of typing. The
  ranking was real, of a question nobody asked. Record the timestamp when your window opens and drop
  every sample before it.
- The achieved sampling period is not the requested one: 250us requested measured 410us. Derive it
  from the profile.
- The built-in profile timeline also lands in `~/.factory/logs/droid-log-single.log` as
  `[tui-startup] Startup phase completed` lines, but batched, late, and shared across concurrent
  Droids. Instrument the binary instead.

## Validate the behaviour test against stock first

A patch that defers work can make the deferred feature stop happening, and a paint benchmark will
happily report that as a win. So write a behaviour test, and **run it against the stock binary
before you trust it on the candidate**. A test that has never passed against stock proves nothing.

Driving a TUI to check a feature has its own traps, all of which produced false failures:

- A fresh `HOME` is not a logged-in profile; the app stops at a login screen and no feature under
  test is reachable.
- Writing a whole string in one terminal write can produce no output at all. Pace the keys ~40ms
  apart, like a person.
- Fuzzy filters ignore long names. Use a short, unusual probe name.
- Searching the transcript for text you just typed matches your own echo, not the app's response.
  Clear the transcript before acting, and assert on output only the app can produce.

## Sanity, not just speed

A fast binary that cannot hold a conversation is a regression. After any patch, drive the patched
copy in a PTY: wait for paint, send a prompt whose answer you can assert on
(`reply with exactly: pong`), wait for the answer, then `/exit`. Check the newest file in
`~/.factory/logs` for errors inside your run window.
