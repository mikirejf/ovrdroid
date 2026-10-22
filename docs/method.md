# Measuring method

Read this before you measure anything or trust a number in these docs. Every rule here comes from a
number that turned out wrong. The file that holds the wrong number keeps its retraction.

How to time paint in a PTY, and the `DROID_PROFILE` gotchas, are in the `patching-droid-cli` skill's
`MEASURING.md`. `--version` is never a benchmark: it skips almost all of startup.

## Before you measure

1. **Quiet the machine.** Kill stale Droids. Check load average and swap, and write the load next to
   the result. Under load the same binary paints anywhere from 0.6s to 2.7s.
2. **Measure the noise floor first.** Run the same binary against itself (`probe ab base base`).
   That gives the smallest effect the run can resolve, and so the number of rounds you need.
3. **Stub before you build.** Replace the suspect work with a no-op and measure that ceiling. If
   deleting the work wins nothing, no optimisation of it can win anything.
4. **Stub the exact function the profiler named.** Read its callers first. The zod retraction in
   [zod.md](zod.md) stubbed the schema converter when the profile named the schema constructor.
5. **Try the zero-build test first.** An env var or a different working directory can kill a
   hypothesis in minutes.

## The control

- **The control differs from the candidate by the patch and nothing else.** Build the control from
  the same patch set minus the patch under test, in the same directory. The installed binary is not
  a control: it is warm in the page cache, and a freshly written 159MB file in `/tmp` is cold. That
  once faked a 44ms regression (n=12, CI -77 to -11) that went to +4.4ms against a proper control.
- **The harness must not leak its environment.** Run from inside a Droid session, the harness once
  passed seven `FACTORY_*` variables to the target, and one of them switched off the very code an
  experiment deferred. The harness now strips `FACTORY_*`, `DROID_*` and `HERDR_*` and forces
  auto-update off.
- **Position-balance, and require the result to survive order reversal.** The binary that ran second
  used to look 39ms faster. `probe ab` now alternates order each round, and `interleave` runs one
  unrecorded warm-up per binary before the first round. The warm-up only has to pull the binary into
  the page cache, so `keys`, `resume` and `stream` pass a plain launch to the input box and close
  (`warmWithLaunch`) instead of a full unrecorded measurement; `ab` already is a plain launch. Use
  an even round count.
- **Check that the feature runs inside the probe.** `probe keys` never submits a prompt, so a
  feature that needs a finished turn is switched off for the whole probe, and any difference it
  reports came from somewhere else.
- **Check that the stub still behaves.** A stub that hangs on exit, or paints and then dies, has
  measured nothing. `launch` rejects both.
- **A behaviour test that has never failed against stock is not validated.** Run the control first.

## Noise

Two identical binaries, interleaved, differ by a standard deviation of ~126ms on a quiet machine and
~143ms under load. Rounds needed to resolve an effect at that spread:

| Effect | Paired rounds |
| -----: | ------------: |
|   30ms |            68 |
|   50ms |            25 |
|   80ms |            10 |
|  150ms |             3 |

`probe ab` prints the smallest resolvable effect for the run you did.

## The gate's verdict: worse with confidence, and by more than the floor

Every paired probe the gate runs (`ab`, `keys`, `resume`, `stream`, `typing-start`, and `idle`)
hands its measures to `failOnRegressions` in `src/probe/regressions.ts`. A measure fails only when
both hold:

1. The patched build is worse with confidence. Each measure is tested at 1 - 0.05/m, where m is the
   number of measures that probe reports (Bonferroni), so the family of measures keeps a 5% false
   alarm rate.
2. The lower bound of that interval is above the measure's **floor**, the smallest worsening that is
   worth blocking an update for. The floor sits next to the measure's definition, in its own unit.

A difference that is resolved but stays under its floor prints a `within floor` line on stderr and
passes. Without a floor, enough rounds resolve any difference at all: on 0.245.0 the gate failed on
an echo 1.2ms slower (97.5% CI 0.6 to 1.8, n=12), which no one can feel against a 16.7ms frame at 60
Hz, and which a rebuild of the same patch set did not reproduce on a quieter machine (see
[typing.md](typing.md)).

| Probe          | Measure                                | Floor    | Why                                                     |
| :------------- | :------------------------------------- | :------- | :------------------------------------------------------ |
| `keys`         | echo (median per run)                  | 3ms      | Echo is ~4 to 6ms; a run's median moves about 1ms alone |
| `keys`         | lag                                    | 16ms     | One frame at 60 Hz                                      |
| `ab`           | paint                                  | 10ms     | Under half the 25ms the patch set wins at paint         |
| `ab`           | quit                                   | 20ms     | Over one frame; nobody waits on the exit                |
| `typing-start` | app paint, per gap                     | 20ms     | Twice the `ab` floor: typing makes paint bimodal        |
| `resume`       | input box, transcript, settled, resize | 20ms     | Over one frame; the patches win 170 to 250ms here       |
| `resume`       | resume cpu                             | 50ms     | ~2.5% of ~2100ms                                        |
| `stream`       | stream cpu                             | 30ms     | ~3% of ~930ms; the patches win 288ms                    |
| `stream`       | frames                                 | 2        | ~1% of ~160 frames                                      |
| `stream`       | bytes                                  | 2048     | ~2% of ~120KB                                           |
| `idle`         | idle cpu                               | 30ms/min | ~6% of ~520ms per idle minute                           |
| `idle`         | idle footprint                         | 5MB      | ~3% of a ~180MB footprint                               |

Raise a floor only with a number that shows the effect cannot be felt or cannot be told from noise,
and write that number into the table.

## Pick the meter that can see the effect

- **Wall clock** (time to paint) only works for large effects on a quiet machine.
- **Self CPU** (`process.cpuUsage()` read at `input_mounted`) resolves a 50ms startup effect at a
  load average of 4, where wall clock had a 206ms interval.
- **CPU attribution of a named frame** resolves a typing fix at load 7.3. It is the most robust
  meter in this repo.
- **Counters** (renders, commits, frames) say how many times work ran. CPU only says how much.
  Counts resolve cleanly where CPU cannot. See [react-concurrency.md](react-concurrency.md).
- `probe keys` measures lag with one sample per run. It needs many more rounds than echo before its
  interval means anything. Prefer paired CPU attribution for typing.

## Reading a CPU profile

1. **Profile a window.** Pass a cut-off (`untilMicros`, or split at paint and at the first key). A
   profile with no cut-off ranks startup work, even when you meant to measure typing. That once made
   a startup file watcher look like the largest typing cost.
2. **Rank by sample count, not by summed time deltas.** A large `timeDeltas` entry is a stretch with
   no sample, and the whole stall lands on whatever frame resumed. One `readFile` sample once showed
   306ms. The estimator charges each frame `samples * median(delta)` and prints the raw sum's
   inflation beside it. Real frames sit at 1.3x to 1.7x. Anything above ~2x carries someone else's
   stall.
3. **Read the right process.** Droid spawns a second Droid at startup and both write a
   `.cpuprofile`. `probe cpu` picks the right one.
4. **A phase is a bracket, not a cost.** A phase in Droid's trace lasts as long as whatever it
   awaits. The settings phases and the terminal probes both looked like 100ms of work and both
   measured zero when stubbed. See [startup.md](startup.md).
5. **A React effect is not the paint boundary.** `first_paint` and `input_mounted` fire inside
   effects that run before Ink writes the frame. For work that must not compete with paint, a short
   timer beats a lifecycle hook.

## Measuring memory

- **Use physical footprint, not `ps` RSS.** RSS charges every Droid the full 159MB binary, which the
  kernel holds once. Summed over 12 sessions it overstates the load by gigabytes.
- **Read footprint with `proc_pid_rusage`** (`ri_phys_footprint`). It takes 0.03 to 0.2ms.
- **Never put `vmmap` in a timing loop.** It suspends the target for ~650ms per call. Every lag and
  CPU number taken with `vmmap` in the loop is void.
- **A higher footprint is not a leak.** Take a heap snapshot (it forces GC) and compare live heap.
  `probe heapdiff` does that.

## Probe safety

- A probe build runs against the real `~/.factory` unless told otherwise. A probe build that
  contained an unapproved store-pruning patch once pruned the real task store. Pass
  `--without <patch>` or use a throwaway `FACTORY_HOME_OVERRIDE`.
- `probe exec` strips every `FACTORY_*` variable from the child, so an env override needs a wrapper
  script.
- `DROID_PROFILE=1` recorded zero `ink-render` events in every run. Do not trust it for render
  counts until someone finds out why.
- A probe that types into a session must start it in a trusted folder. A fresh folder under
  `$TMPDIR` (`/var/folders/...`) makes Droid show the "Trust this folder" dialog, which swallows the
  first prompt, and the probe then waits for a reply that never starts. `/tmp` is trusted in
  `~/.factory/settings.json`, so `withLiveDir` in `src/probe/live-session.ts` makes its folders
  there. Measured on 0.242.0: a prompt pasted into a `$TMPDIR` folder was never submitted, and the
  same prompt in a `/tmp` folder was answered in 9s.
