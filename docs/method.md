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
  used to look 39ms faster. `probe ab` now alternates order each round and drops a warm-up round.
  Use an even round count.
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
