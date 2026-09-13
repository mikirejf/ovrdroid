# Startup findings

Measured on Droid 0.218.1, Bun 1.3.14, M-series Mac. First pass 2026-09-13; audited the same day
after the measurement tooling was repaired.

Everything here is a measurement, not a theory. Where a measurement was wrong, the retraction is
kept alongside it, because the way it went wrong is the reusable part.

## Read this before trusting any number below

The tooling that produced the first pass had four defects that each manufacture a plausible wrong
number. All four are now fixed, and the numbers they touched are marked **VOID** where they could
not be re-measured.

| Defect                                                 | What it faked                                       |
| :----------------------------------------------------- | :-------------------------------------------------- |
| Raw `timeDeltas` charged as time spent                 | Any stalled frame, at any size                      |
| `probe cpu` picked an arbitrary one of two profiles    | A different program each run                        |
| Module dump discarded everything at or below 0.2ms     | Total module cost, and the module count             |
| Harness leaked its own `FACTORY_*` env into the target | Whole features silently disabled during measurement |

The exit clock was also started 50ms late, so every exit number in the first pass was understated by
up to that much. Stock exit measures **1.10s**, not the 0.07s previously recorded.

## The headline

Stock paints in ~600ms once the machine is quiet. The five-patch set is already applied in every A/B
below; `probe build` always includes it, so the control is base-5, not stock.

| Question                          | Answer                                                    |
| :-------------------------------- | :-------------------------------------------------------- |
| Is there anything left to win?    | Yes. **47ms verified**, in the zod v3 schema constructor  |
| Is any single remaining fix big?  | Yes. That 47ms beats the entire existing patch set's 36ms |
| What dominates the critical path? | I/O waits, not CPU. Only ~590ms of ~1400ms is CPU at all  |
| Was the zod retraction correct?   | No. It cleared the wrong function. See below              |

## Retraction of the retraction: zod is back, as a different cost

**First pass claimed:** zod costs 124-146ms. **Then retracted:** stubbing `zodToJsonSchema` saved
nothing, so "the ceiling on all zod work is zero."

**Both were wrong, in opposite directions.** The retraction stubbed schema **conversion**
(`zodToJsonSchema`, turning a schema into JSON Schema for the API). The profile points at schema
**construction**, which is a different function that runs at import time and was never stubbed.

With sample-count attribution on a stock binary cut at paint, across two independent profiles:

| Frame                      | Samples | Robust CPU | Raw sum | Inflation |
| :------------------------- | ------: | ---------: | ------: | --------: |
| `Sq@zod/v3/types.js:255`   |     137 |     34.3ms | 191.6ms |      5.6x |
| same frame, second profile |     106 |     26.5ms | 172.6ms |      6.5x |

`Sq` is the zod v3 `ZodType` constructor. Every schema object it builds runs **23 `.bind(this)`
calls** in its constructor body, confirmed by reading the bundled source. Its callers are schema
module bodies executing at import: `schemas/plugins.ts`, `schemas/client.ts`, `settings/schema.ts`
and others.

Measured cost of that bind block in isolation: **0.21us per schema object**. So 34ms of constructor
time implies on the order of 10^5 schema objects built before paint, which is consistent with 3817
modules where the largest group is zod schema definitions.

### Stubbed and confirmed: 47-51ms, the largest verified win to date

The bind block was deleted outright and measured, as the method requires.

| Run                                   | n   | Result                                  |
| :------------------------------------ | :-- | :-------------------------------------- |
| `ab base zodstub`                     | 40  | stub faster by **51.0ms**, CI 38.4-63.6 |
| `ab zodstub base` (arguments flipped) | 40  | stub faster by **47.1ms**, CI 34.0-60.1 |
| `ab base base` (self-control)         | 20  | -3.3ms, CI -13.6 to 7.0, not resolved   |

It survives order reversal, and the same binary against itself correctly resolves to zero. Both
intervals sit far above the ~13ms the sample size could resolve.

Confirmed in the profile as well: zod v3 CPU falls from **53.8ms (130 samples)** in base to **16.0ms
(39 samples)** in the stub, which is the same size of effect the A/B reports.

The stub is functionally sound, not just fast: it paints, answers `/help` with byte-identical output
length, exits cleanly, and the bundle contains no detached references to the bound methods (no
`.map(x.parse)`, no destructuring) that unbinding could break.

### Why 51ms, when the binds themselves cost ~9ms

Counted directly with an instrumented build: **15,215 zod v3 schemas are constructed before
`input_mounted`**, stable to the object across runs, which is 349,945 `.bind()` calls.

| Measurement                             |    Cost |
| :-------------------------------------- | ------: |
| 15,215 constructions, objects discarded |   3.2ms |
| 15,215 constructions, objects retained  |   8.7ms |
| Measured in the real binary             | 47-51ms |

Retaining the objects, which the real code does, nearly triples the cost. The remaining gap is
memory pressure: 350k retained closures that the stub never allocates, which shows up as GC and
allocator work spread thinly rather than as one hot frame. This is why the microbenchmark
understates it and why only the end-to-end A/B gets the real number.

**Status: verified win, not yet a shipped patch.** The stub deletes the binds wholesale, which is a
ceiling measurement rather than a safe patch. The likely real fix is prototype methods instead of
per-instance bound copies, or moving the startup path onto zod v4. That work has a measured 47ms
budget to justify it.

### What is still true from the first pass

- The bundle ships zod 4.x, which has its own `toJSONSchema`, yet the startup path runs the **v3**
  compatibility layer. Confirmed again here: every hot frame is under `zod/v3/`.
- Migrating to v4 remains correct for upstream reasons. Whether it helps startup depends on the
  constructor, not the converter.

## Module evaluation: the count was understated 24-fold

**First pass:** "153ms across 156 modules ... spread too thin to attack."

The dump discarded every module body costing 0.2ms or less before the parser ever saw it, then the
survivors were reported as the totals.

With the threshold removed, three consecutive runs:

```
204.6ms across 3817 modules (3782 under 1ms, 99.8ms)
184.1ms across 3817 modules (3779 under 1ms, 89.4ms)
188.0ms across 3817 modules (3780 under 1ms, 91.0ms)
```

| Metric      | First pass |      Measured |
| :---------- | ---------: | ------------: |
| Total       |      153ms |         184ms |
| Modules     |        156 |          3817 |
| Hidden tail |          0 | 89.4ms, 48.6% |

Nearly half of module evaluation was invisible, spread across 3779 modules. The largest single body
is 9.7ms (highlight.js registering languages).

**The "spread too thin" conclusion survives, but for a sharper reason:** the tail is real and large
in aggregate, and no individual module in it is worth touching. Attacking it means shipping fewer
modules, not making a module faster.

## The CPU/wall split, which reframes everything

From the repaired `probe cpu` on stock, cut at paint:

```
sampling period 0.41ms (median), 1420 samples
587.9ms estimated CPU, 1400.8ms of wall time in the window
```

**Roughly 40% of time to paint is CPU. The rest is waiting.** No amount of CPU optimisation touches
the other 60%, which is terminal probes, the keychain, and file I/O. This is the single most useful
number in this document and the first pass never had it.

## Verified experiment results

Position-balanced, 72 samples per arm, control is base-5. These predate the env fix, so they were
all measured with `FACTORY_DISABLE_SETTINGS_PERSISTENCE=true` leaked into both arms.

| Experiment                             | Saving | Verdict     |
| :------------------------------------- | -----: | :---------- |
| All seven together                     |   36ms | REAL        |
| `lazy-highlight-languages`             |   12ms | real, small |
| `skip-sandbox-ensure`                  |   11ms | real, small |
| `ensure-built-in-droids-no-block`      |    3ms | noise       |
| `ink-maxfps-60`                        |    0ms | noise       |
| `defer-resource-monitor-terminal-caps` |   -1ms | noise       |
| `defer-tools-module`                   |   -5ms | noise       |
| `defer-cloud-session-defaults`         |   -5ms | **VOID**    |

`defer-cloud-session-defaults` is void, not noise. The leaked
`FACTORY_DISABLE_SETTINGS_PERSISTENCE=true` makes the cloud-session-defaults path return
`"disabled"` before doing any work (`GOu` checks `$GR()` and returns immediately). The experiment
deferred work that the environment had already switched off, so it could only ever measure zero.
Re-run it in a clean environment or discard it.

## The leaked environment: measured, not resolved

The harness copied its own environment into the binary under test. Run from inside a Droid session,
that injected seven `FACTORY_*` variables a real user's shell does not have.

Direct A/B of clean versus polluted environment, same binary, n=40 paired:

```
paired difference (polluted minus clean), n=40
  mean -6.3ms  sd 143.1ms  95% CI -50.7 to 38.0
  minimum resolvable effect at this spread: 44.3ms
  the difference is not resolved: the interval contains zero
```

The machine was loaded (1-minute average 3.6 rising to 7.4), which is why the spread is 143ms and
the resolving power is only 44ms. **This does not clear the confound.** It shows the total paint
effect is under ~44ms, while leaving the specific `defer-cloud-session-defaults` result void,
because that patch targeted precisely the code the variable disables.

The harness now strips `FACTORY_*`, `DROID_*` and `HERDR_*`, and forces auto-update off so a
benchmark can never trigger an update.

## What the noise actually is

Two **identical** binaries, interleaved, differ by a standard deviation of **126ms** run to run on a
quiet machine, and 143ms under load.

| Effect to resolve | Paired rounds needed |
| ----------------: | -------------------: |
|              30ms |                   68 |
|              50ms |                   25 |
|              80ms |                   10 |
|             150ms |                    3 |

`probe ab` now prints the minimum resolvable effect for the run you actually did, so this table is a
sanity check rather than something to compute by hand.

### Position bias, now handled

`probe ab` used to launch binaries in argument order every round, and the binary that ran **second**
looked faster: 39ms of pure artifact, enough to flip a result's sign. It now alternates order every
round, discards a warm-up round, and warns when an odd round count leaves the bias uncancelled.

## Retraction: the settings phases are not work

This one survives the audit and is still correct.

| Test                                    |           Result | Meaning                      |
| :-------------------------------------- | ---------------: | :--------------------------- |
| Run from depth 18 vs depth 2            | -2ms, CI -26..22 | Parent depth does not matter |
| `FACTORY_AIRGAP_ENABLED=true` vs normal |  12ms, CI -4..28 | Network already off the path |
| Folder-discovery walk deleted entirely  |  -3ms, CI -14..7 | Ceiling on a cache is zero   |

The walk stops at the **Git root**, not the filesystem root (`while(K!==B&&...)` where `B` is the
Git root, offset `3064829`). It `stat`s `.factory`, `.agents` and `.agent` only, roughly `3d` stats
for `d` levels, no `readFile` or `readdir`. A handful of syscalls, which is why removing it changes
nothing.

`settings_local` is a **window**, not a unit of work. Its 121ms is spent awaiting credentials
storage, embedded keytar, dotenv and telemetry init:

```
settings_local   156.8 -> 278.0   121ms
  truecolor_probe  156.7 -> 184.5    28ms
  telemetry_init   168.5 -> 170.4     2ms
  certificates     170.5 -> 221.8    51ms
  kitty_probe      184.5 -> 268.8    84ms
  auth_token       259.7 -> 282.2    23ms   (keychain)
```

**Rule:** a phase in this trace is a bracket around whatever it awaits. Never read its duration as
its cost.

## Why the profiler lied, precisely

The first pass blamed gap-ranking alone. There were three causes stacked on top of each other.

1. **Ranking single no-sample gaps.** A large `timeDeltas` entry is a period where the profiler took
   no sample. The stack printed is whatever resumed afterwards.
2. **Summing raw deltas.** Fixing (1) by summing per node is still wrong: one descheduling stall
   lands entirely on one frame. Measured on a real profile, `readFile` showed **306ms from a single
   sample**, and `NY@auth/common/cache.ts` **144ms from a single sample**. Ranked by raw sum, a
   1224x-inflated artifact was the top cost in the program.
3. **Profiling two processes.** Droid spawns a second Droid during startup, both write a
   `.cpuprofile`, and the reader picked whichever `readdirSync` returned first. That is the real
   reason two profiled runs blamed different functions.

The repaired estimator charges each frame `samples * median(delta)`, ranks by that, and prints the
raw sum's `inflation` factor beside it. Real frames land at 1.3-1.7x. Artifacts stand out at 30x and
up. The sampling period is derived from the profile (0.41ms achieved against 0.25ms requested)
rather than assumed.

## Method that works

1. Quiet the machine. Kill stale droids, check load average and swap. Under load the same binary
   spans 0.6s to 2.7s and nothing is measurable. Record the load with the result.
2. Establish the noise floor first: identical binary against itself. That sets the minimum
   resolvable effect and therefore the sample count.
3. **Stub before you build.** Replace the suspect work with a no-op and measure the ceiling. If
   deleting it entirely wins nothing, no optimisation of it can win anything.
4. **Stub the thing the profiler actually named.** The zod retraction stubbed the converter when the
   profile pointed at the constructor, then generalised the null result to all of zod. Name the
   exact function and check its callers before believing a ceiling.
5. Prefer a zero-build test when one exists. An env var or a changed working directory can kill a
   hypothesis in minutes.
6. **Control the environment.** The harness must not leak its own variables into the target. A
   feature silently disabled by an inherited variable turns a real effect into a null result.
7. Position-balance, and require the effect to survive order reversal.
8. Check the stub still behaves. A stub that hangs on exit, or a binary that paints and then dies,
   has measured nothing. `launch` now rejects both instead of reporting a fast time.
9. **Trust sample counts, not delta sums.** Any frame whose inflation is above ~2x is reporting
   someone else's stall.

## Where the remaining time is

| Item                | Duration | Status                                                  |
| :------------------ | -------: | :------------------------------------------------------ |
| Waiting, not CPU    |   ~810ms | ~60% of paint. Terminal probes, keychain, file I/O      |
| `runtime_boot`      |     76ms | Bun itself. Hard floor.                                 |
| `kitty_probe`       |     84ms | Waits for two replies; resolves only when both arrive   |
| zod v3 constructor  |  47-51ms | CPU plus GC. **Verified by stub.** Largest single item  |
| Sub-1ms module tail |    ~89ms | CPU, across 3779 modules. Only fixable by shipping less |
| `certificates`      |     51ms | Already patched to skip; residue                        |
| `truecolor_probe`   |     28ms | Terminal                                                |
| `auth_token`        |     23ms | Keychain                                                |

## Open items

- **Turn the zod stub into a shippable patch.** The ceiling is measured at 47-51ms; what exists
  today is a wholesale deletion of the bind block, which is a measurement, not a fix. Prototype
  methods or a zod v4 startup path are the candidates, and they have a 47ms budget to justify them.
  The stub lives at `/tmp/od-zodstub.json` and the built binaries at `/tmp/od-base` and
  `/tmp/od-zodstub`.
- Re-run `defer-cloud-session-defaults` in a clean environment. Its null result is void.
- Re-measure the seven verified experiments with the repaired harness. Their relative ranking is
  probably intact, but every absolute number was taken with a leaked environment and a 50ms-late
  exit clock.
- The 64ms untraced gap at 392-457ms still has no confirmed owner.
- `kitty_probe` at 84ms resolves only once **both** `ESC[?u` and `ESC[c` replies arrive (offset
  `13474379`). Worth testing whether it is on the critical path or merely overlapping.
- The harness answers four terminal queries but stock Droid 0.218.1 only ever sends three; the DCS
  truecolor query is never sent when `COLORTERM=truecolor` is inherited. Under a clean environment
  Droid may now send it, which would add a probe the old numbers never included.
