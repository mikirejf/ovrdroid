# Startup findings

Measured on Droid 0.218.1, Bun 1.3.14, M-series Mac. First pass 2026-09-13; audited the same day
after the measurement tooling was repaired.

Everything here is a measurement, not a theory. Where a measurement was wrong, the retraction is
kept alongside it, because the way it went wrong is the reusable part.

Typing cost is a separate investigation with its own section at the end of this document. It does
not share a critical path with startup, and none of the startup numbers below describe it.

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

**Status: shipped as `zod-v3-lazy-bound-methods`.** The wholesale deletion was the ceiling
measurement. The shipped patch keeps every method reachable.

### The shipped fix: lazy accessors on the prototype

The constructor no longer binds anything. The class installs, once, a getter for each of the 24
names. The first read of `schema.parse` binds the method, caches the bound copy as an own property
of that instance, and returns it. A name that is never read costs nothing.

This preserves the property the eager binds existed to provide: a detached `schema.parse` still
carries its instance, so `arr.map(schema.parse)` keeps working.

Three details had to be preserved deliberately, and tests lock all three:

| Detail                   | Why it matters                                                                      |
| :----------------------- | :---------------------------------------------------------------------------------- |
| `Object.hasOwn` guard    | Reading a method off the **prototype** must not cache a copy bound to the prototype |
| `set` trap on instances  | `schema.parse = fn` must overwrite per instance, without touching the class         |
| `set` trap on prototypes | `Sub.prototype.parse = fn` must land on `Sub`, stay lazy, and not touch the base    |

The guard is not hypothetical. The first draft omitted it, and one read of
`Sq.prototype.safeParseAsync` poisoned the cache so every later instance returned
`undefined:safeParseAsync`. The test
`reading a method off the prototype does not poison later instances` exists for that bug.

The prototype write was the second bug. An earlier draft reinstalled the accessor on the **base**
prototype whenever the receiver had no own `_def`, so `Sub.prototype.parse = fn` silently rewrote
every schema in the process and never landed on `Sub` at all. The setter now installs on its own
receiver, which is what a plain assignment did in stock zod.

The third bug was a shared descriptor. To save bytes, one mutable descriptor object was reused
across every `defineProperty` call, on the reasoning that the descriptor is copied synchronously.
That holds for ordinary objects and fails for a Proxy: a `defineProperty` or
`getOwnPropertyDescriptor` trap that reads a second lazy method mutates the descriptor mid-flight,
and the first install lands the wrong function. The payload now passes the value through a local, so
two installs can never cross. Two Proxy reentrancy tests cover it.

One divergence remains and is accepted: the accessors are non-enumerable, so `Object.keys(schema)`
returns 2 names instead of 26 and a spread of a schema no longer carries its methods. Nothing in the
bundle spreads or enumerates a schema, and making the accessors enumerable would give back part of
the win.

One precondition the design depends on: **no subclass may declare one of the 24 names as a method.**
A class method is a plain data property on the subclass prototype, so it shadows the accessor and is
never bound. Stock zod bound whatever the subclass resolved to. Today no subclass does this, and
`src/patch/__tests__/stock-source.test.ts` re-checks all 36 direct subclasses against the shipped
bundle on every run rather than trusting a one-time scan.

Safety was established against the bundle before measuring:

- No subclass of `Sq` overrides any of the 24 names. All 36 direct subclasses were checked, and the
  6 other `this.<name>=` sites in the bundle belong to unrelated classes (commander, simple-git,
  grpc, pdf.js).
- No detached reference to a schema method exists in the bundle: no `.map(x.parse)`, no
  destructuring, and no `.spa(` call site at all.
- No schema instance is spread or enumerated. All 172 spreads in the zod region operate on parse
  contexts and `_def`, never on a schema.

### Re-measured with a self-CPU meter, because wall time could not resolve it

On a machine that never drops below load 4, two identical binaries differ by a 95% interval of
**206ms** of wall time. A 50ms effect is invisible there, so the shipped patch was measured by CPU
consumed inside the process, read at `input_mounted` via `process.cpuUsage()`.

| Run                    | n   | Result                                    |
| :--------------------- | :-- | :---------------------------------------- |
| base vs base (control) | 12  | 7.8ms, CI -11.7 to 27.3, **not resolved** |
| base vs lazy           | 16  | lazy **67.7ms** less CPU, CI 50.6 to 84.8 |
| lazy vs base (flipped) | 16  | lazy **79.2ms** less CPU, CI 62.4 to 96.0 |

The control resolves to zero, and the effect survives order reversal. This agrees with the 47-51ms
the wall-clock A/B measured on a quieter machine; CPU time is the larger number because it counts
work the process does in parallel with its own waiting.

### What is still true from the first pass

- The bundle ships zod 4.x, which has its own `toJSONSchema`, yet the startup path runs the **v3**
  compatibility layer. Confirmed again here: every hot frame is under `zod/v3/`.
- Migrating to v4 remains correct for upstream reasons. Whether it helps startup depends on the
  constructor, not the converter.

### Would upgrading zod fix this instead? Partly, and upstream only

The bundle carries **three** zod copies at once. Counting constructions before `input_mounted` with
an instrumented build:

| Copy in the bundle | Schemas before paint |
| :----------------- | -------------------: |
| v3 compatibility   |           **15,215** |
| v4.0.0             |                1,018 |
| v4.3.6             |                   88 |

The expensive path is the v3 one, by three orders of magnitude.

Measured against the **real published packages**, not a reconstruction of them: 15,215 object
schemas of five fields each, roughly 91,000 zod objects, medians stable across three runs.

| Version                             |  Construct | Retained heap | Own props per schema |
| :---------------------------------- | ---------: | ------------: | -------------------: |
| 3.25.76, what Droid runs at startup |    110.3ms |         365MB |                   29 |
| **3.25.76 + this patch**            | **28.7ms** |      **44MB** |                **7** |
| 4.6.4, latest                       |     95.4ms |         137MB |                    3 |

**zod 4.6.4 did fix this class of problem.** It moved the methods onto the prototype: a 4.3.6 schema
carries 56 own properties, a 4.6.4 schema carries 2. That is the same insight as this patch, made
upstream.

Two things follow:

1. **Upgrading would help, but less than the patch does.** Latest cuts retained heap by 62%; the
   patch cuts it by 88%, because v3 has less per-schema machinery left once the binds are gone.
2. **It is not reachable from here.** Which zod each module imports is decided in Factory's source.
   This harness rewrites compiled output, and moving thousands of schema definitions from the v3 API
   to the v4 API is an upstream change, not a find-and-replace.

Newer is not automatically faster: 4.3.6, already in the bundle, is the **worst** of the three at
construction (241.8ms) because it assigns 42 properties per instance. The win in 4.6.4 comes
specifically from moving them to the prototype.

The `toJSONSchema` precompilation in 4.3.6+ is lazy. `Q0h` (offset `16323824`) returns a closure
rather than computing at construction, so it neither costs nor saves anything at startup.

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

| Item                | Duration | Status                                                    |
| :------------------ | -------: | :-------------------------------------------------------- |
| Waiting, not CPU    |   ~810ms | ~60% of paint. Keychain and file I/O, **not the probes**  |
| `runtime_boot`      |     76ms | Bun itself. Hard floor.                                   |
| `kitty_probe`       |     84ms | **Off the critical path.** Deleting the chain won nothing |
| zod v3 constructor  |  47-80ms | CPU plus GC. **Shipped.** Largest single item             |
| Sub-1ms module tail |    ~89ms | CPU, across 3779 modules. Only fixable by shipping less   |
| `certificates`      |     51ms | Already patched to skip; residue                          |
| `truecolor_probe`   |     28ms | Terminal. Same chain as `kitty_probe`, same null result   |
| `auth_token`        |     23ms | Keychain                                                  |

## Retraction: the terminal probes are not on the critical path

The probes really are serial. `MCh` awaits the truecolor probe, which resolves a gate that starts
the kitty probe (offset `15266417`), which then starts terminal-appearance detection. The render
path does await the end of that chain, at `15277983`.

That reads like a 112ms serial stall, so the whole chain was replaced with a constant and measured:

| Run             | n   | Result                                    |
| :-------------- | :-- | :---------------------------------------- |
| base vs ceiling | 14  | ceiling **15.8ms slower**, CI 2.3 to 29.3 |

Deleting the entire probe chain does not speed up paint. The probes overlap other startup work, so
their duration is a bracket around waiting, not a cost. The existing `kitty-probe-timeout` patch is
the only part of this area that ever mattered, and only because a timeout fires when no reply comes.

**Rule confirmed, again:** a phase's duration is not its cost. Stub it before building anything.

## Open items

- Re-run `defer-cloud-session-defaults` in a clean environment. Its null result is void.
- Re-measure the seven verified experiments with the repaired harness. Their relative ranking is
  probably intact, but every absolute number was taken with a leaked environment and a 50ms-late
  exit clock.
- The 64ms untraced gap at 392-457ms still has no confirmed owner.
- The sub-1ms module tail (~89ms across 3779 modules) is the largest untouched CPU item left. It
  only moves by shipping fewer modules, which is an upstream change.
- The harness answers four terminal queries but stock Droid 0.218.1 only ever sends three; the DCS
  truecolor query is never sent when `COLORTERM=truecolor` is inherited. Under a clean environment
  Droid may now send it, which would add a probe the old numbers never included.

# Typing findings

A separate investigation into what a keystroke costs, measured 2026-09-13 with `probe keys` and
paired CPU profiling of the typing window. Startup work and typing work share almost nothing, so
none of the numbers above apply here.

## The headline

| Question                           | Answer                                                        |
| :--------------------------------- | :------------------------------------------------------------ |
| Is a single keypress slow?         | No. **4ms** median echo, idle input box                       |
| Is typing expensive anyway?        | Yes. **580ms of CPU** per 120 keys, ~10x idle                 |
| Where does it go?                  | 40% React reconciler, 25% a model-policy scan inside render   |
| Is the bundled React a prod build? | **No. It is the development build**                           |
| Is React Compiler applied?         | No                                                            |
| Biggest verified win               | One line: **194ms** of model-registry work per 100 keystrokes |

## Droid ships React's development build

Decisive, and the single most important fact in this section.

| Marker                                                | Build it proves |  Hits |
| :---------------------------------------------------- | :-------------- | ----: |
| `Minified React error`                                | production      | **0** |
| `Invalid hook call`                                   | development     |     2 |
| `Should have a queue`                                 | development     |     1 |
| `Rendered more hooks than during the previous render` | development     |     1 |
| `captureOwnerStack`                                   | development     |     1 |
| `Internal React error`                                | development     |     3 |

Production React replaces every invariant message with a numbered `Minified React error` link. Zero
of those exist in the bundle, while the dev-only assertions all do. There is no second prod copy to
switch to at runtime, so the dev build is what executes.

React is 19.2.3, the reconciler reports 19.2.0, and the renderer is Ink.

**React Compiler is not applied to application code.** No `react/compiler-runtime` import exists,
and no component shows the compiler's `$[0] !== x` memo-cache shape. The four `useMemoCache` hits
are React's own dispatcher plumbing.

`StrictMode` is referenced only as an exported symbol and a `getComponentName` case; nothing wraps
the tree in it, so renders are not doubled.

## Typing costs ten times idle

CPU in a 6.4s window, stock binary, against an idle control of the same length:

| Window                 |   CPU |
| :--------------------- | ----: |
| Idle, no keys          |  64ms |
| 120 keys at 40ms apart | 643ms |

Attribution of the typing window:

| Owner                                 |   CPU | Share |
| :------------------------------------ | ----: | ----: |
| React reconciler                      | 258ms | 40.2% |
| model-registry / `resolveModelPolicy` | 162ms | 25.2% |
| other                                 |  80ms | 12.4% |
| ink `string-width` / emoji regex      |  77ms | 11.9% |
| ink `log-update` + output diff        |  65ms | 10.1% |
| yoga layout                           | 0.4ms |  0.1% |

Yoga layout is not a factor. The renderer is not the problem; what runs _inside_ the render is.

## Every keystroke re-renders the whole app

The profile resolves the full path. Input state lives at the top of the tree in `app.tsx:679`, so a
keypress re-runs the root component and everything below it:

```
values@:0
lC@packages/utils/src/llm/model-registry.ts:272
mKR@packages/utils/src/policy/resolveModelPolicy.ts:20
ajA@packages/utils/src/policy/resolveModelPolicy.ts:33
bKR@packages/utils/src/models/policy/utils.ts:340
vlT@src/utils/modelValidation.ts:22
getAllowedCycleModelIds@src/services/SettingsService.ts:1140
getModelCycleCandidates@src/services/SettingsService.ts:1149
useMemo@react-reconciler:18175
_rD@src/app.tsx:679
```

A second path reaches the same scan through `hasAnyAvailableModel@SettingsService.ts:1082`, which is
**not** inside a `useMemo` at all.

The offending line is `lC`, the model alias lookup:

```js
function lC(T,R){...if(T in RO)return T;if(Object.values(RO).includes(T))return T;return}
```

`Object.values(RO)` rebuilds an array on every call, then scans it linearly. `lC` is called once per
model id, inside `.map`, inside `.filter`, inside a render that runs on every keystroke. `RO` is
never mutated anywhere in the bundle, so the array is rebuilt to produce an identical result.

## Verified: hoisting that lookup into a Set

The patch caches the value set and invalidates it if `RO` is ever replaced:

```js
if ((lC.$o !== RO && ((lC.$o = RO), (lC.$s = new Set(Object.values(RO)))), lC.$s).has(T)) return T;
```

Paired CPU profiling of the typing window, 5 rounds, position-balanced, 100 keys per run:

| Owner            |    base | patched | paired difference | 95% CI           | Verdict      |
| :--------------- | ------: | ------: | ----------------: | :--------------- | :----------- |
| model-registry   | 230.1ms |  35.6ms |      **-194.4ms** | -203.0 to -185.9 | **RESOLVED** |
| react reconciler | 784.2ms | 577.7ms |      **-206.6ms** | -253.6 to -159.6 | **RESOLVED** |
| ink string-width | 101.1ms | 103.6ms |            +2.5ms | -1.0 to 6.0      | not resolved |
| ink output diff  | 190.4ms | 193.9ms |            +3.5ms | -10.4 to 17.3    | not resolved |

Total CPU in the typing window falls from 907.5ms to 724.6ms. The reconciler figure drops because
the scan runs _inside_ render, so its cost is charged to both categories; the two numbers overlap
and must not be added.

**This resolved under a load average of 7.3**, where wall-clock A/B could not. That is the reusable
part: CPU attribution of a named frame is far more robust to machine noise than paint or lag timing.

## Why wall-clock could not resolve it

`probe keys`, 30 paired rounds, same two binaries:

| Metric | base median | patched median | paired difference | 95% CI       | Verdict      |
| :----- | ----------: | -------------: | ----------------: | :----------- | :----------- |
| echo   |         5ms |            6ms |            -5.2ms | -12.6 to 2.2 | not resolved |
| lag    |        40ms |           40ms |            -3.6ms | -15.8 to 8.6 | not resolved |

Echo latency is ~4ms and the patch does not move it, which is expected: one keypress on an idle box
never reaches the expensive path often enough to matter. The cost is CPU burned during _sustained_
typing, and the machine was too loaded for a 10ms wall-clock effect to clear the noise floor.

## Shipped as `model-alias-lookup-set`

The patch is in the set. Confirmed against the rebuilt binary, whose identifiers are re-minified, so
the check is semantic rather than literal:

| Binary  | set cache | linear scan in `lC` |
| :------ | :-------- | :------------------ |
| base    | absent    | present             |
| patched | present   | absent              |

**Safety.** `RO` is a frozen model-id enum. Within 600k characters around the patch site there are
zero in-place mutations (`RO[x]=`, `delete RO[x]`, `Object.assign(RO, ...)`), and all 14 nearby uses
only read it. The guard `lC.$o!==RO` rebuilds the Set if the binding is ever replaced, so the cache
cannot go stale. The bundle already uses this exact shape elsewhere: `new Set(Object.values(RO))` is
hoisted to module scope in two other places, so the fix matches existing practice rather than
inventing one.

**Behaviour.** Driving `/model` through a real PTY and capturing the rendered picker, base and
patched produce **byte-identical screens** (5187 bytes each, 9 model rows, every provider group and
every `[disabled by admin]` marker in the same place). The picker is the densest consumer of `lC`,
since it resolves every alias and applies policy to each one.

Re-measured with the patch in the set, 5 paired rounds, load average 7.05:

| Owner            |    base | patched | paired difference | 95% CI           | Verdict      |
| :--------------- | ------: | ------: | ----------------: | :--------------- | :----------- |
| model-registry   | 228.2ms |  36.9ms |      **-191.3ms** | -197.0 to -185.6 | **RESOLVED** |
| react reconciler | 789.1ms | 559.9ms |      **-229.2ms** | -250.3 to -208.1 | **RESOLVED** |
| ink output diff  | 192.9ms | 186.9ms |            -6.0ms | -10.9 to -1.1    | RESOLVED     |
| ink string-width | 100.7ms |  99.3ms |            -1.4ms | -6.2 to 3.3      | not resolved |

Total typing CPU falls from 933.6ms to 676.8ms, a **27% cut**, and the result reproduces across two
independent build-and-measure cycles.

## What is left after the model patch: no more one-line wins

With `model-alias-lookup-set` applied, the remaining 677ms of typing CPU breaks down like this,
attributed to the deepest **application** frame on each stack rather than to the library leaf:

| Owner                                 |   CPU | What it is                           |
| :------------------------------------ | ----: | :----------------------------------- |
| no app frame (library-only stacks)    | 601ms | Ink, React and the terminal writer   |
| `missionControlInkIsolation.ts:85`    | 250ms | Ink's commit hook: measure and write |
| `app.tsx:679`                         | 231ms | The root component re-rendering      |
| `displayWidth.ts:20`                  |  55ms | App's own width measurement          |
| `ChatInput.tsx:393`                   |  53ms | The input component itself           |
| `KeypressProvider.tsx:1457/1510/1810` | ~41ms | Key decoding                         |

**The chat input component is not the problem.** `ChatInput.tsx` accounts for 53ms of 677ms. The
cost is the frame that a keystroke triggers: the whole screen is re-rendered, re-measured and
rewritten.

The single hottest leaf is `/^\p{RGI_Emoji}$/v` at **97ms**, reached from `string-width` inside
`log-update`, inside Ink's `writeFrame`. Ink measures the display width of the **entire frame** on
every commit, and Unicode-aware width measurement is expensive.

### Two candidate fixes measured, both null

Both were stubbed and measured end to end, per the method. Neither is worth shipping.

| Experiment                     | model-registry | reconciler | string-width | Verdict  |
| :----------------------------- | -------------: | ---------: | -----------: | :------- |
| Remove JSX owner-stack capture |         +1.5ms |     +0.2ms |       -0.1ms | **null** |
| `incrementalRendering: true`   |         -1.4ms |     +7.7ms |       +0.1ms | **null** |

**Owner-stack capture.** React's dev build allocates an `Error` per JSX element to record a stack,
budgeted at 10,000 per second (`recentlyCreatedOwnerStacks`, reset every 1000ms in the reconciler).
The bundle has **3,643 `jsxDEV` call sites**, so this looked like the dominant dev-build tax.
Removing it at all four creation functions (`jsxDEV`, `jsx`, `jsxs`, `createElement`) changed
nothing measurable. The allocation is cheap next to the render itself.

**Incremental rendering.** Ink ships an `incrementalRendering` option, shipped off
(`incrementalRendering:!1`). Turning it on did not help: it changes how the frame is _written_, not
how much of it is measured, and the measurement is where the time goes.

The useful conclusion is that **the width scan is not skippable by a flag**, and the dev-build tax
is not concentrated in element creation. The remaining costs are structural.

## Shipped: three structural typing fixes

All three numbers below are paired CPU profiling of the typing window, 4 rounds, position-balanced,
100 keys per run. Together they take typing from 570ms to ~300ms per 100 keys, a **47% cut**. The
first two alone are -40%.

### Memoise width per grapheme, not per line

Both width scans, Ink's `string-width` and the app's own `displayWidth`, segment a string into
graphemes and measure each one. Ink already has an LRU cache, but it keys on the **whole line**, so
typing one more character misses it and re-measures every grapheme in the line again. The cost is
quadratic in line length for what is a constant per character.

Raising Ink's cache limit was measured first and did nothing (**+6ms**, not resolved), which is the
proof that the miss rate, not the cache size, was the problem.

Memoising per grapheme instead, in two maps keyed by the narrow/wide ambiguity flag:

| Owner            | Saving    |
| :--------------- | :-------- |
| ink string-width | **-90ms** |
| ink output diff  | **-80ms** |

The output diff falls too because it measures the frame it is diffing.

Four patches ship this: one rewrite and one map-init for each of the two scans.

### Guard the draft-dismiss dispatch

`dismissAfterDraftEdit` dispatched `{type:"draft-edited"}` on every keystroke. The reducer returns
the **same state object** when the notice is already hidden or dismissed, so React bails out of
updating, but it still runs the root component function once for the dispatch itself. Bailing out is
not free when the component in question is the whole app.

Reading the current state from a ref and returning early when there is nothing to dismiss:

| Metric                   | Base | Patched |
| :----------------------- | ---: | ------: |
| Root renders per 50 keys |   65 |      18 |

### Production React

Droid ships React's development build (see above). The bundle's lazy-module helper takes a CommonJS
body, so the four dev modules can be replaced wholesale with the production files fetched from the
npm registry at pinned versions and cached under `~/.cache/ovrdroid/react`: `react`,
`react-jsx-runtime`, `scheduler` and `react-reconciler`.

| Measurement                   | Result     |
| :---------------------------- | :--------- |
| Alone, against base           | **-58ms**  |
| On top of the other two fixes | **~-30ms** |
| Source size change            | **-140KB** |

The overlap is expected: the other two fixes remove work the reconciler was being charged for.

**The cost is React's development diagnostics.** The production build still exposes the DevTools
hook, but it drops component stacks, owner stacks, hook-order checks and the readable invariant
messages. Droid 0.220.0 ships production React itself, so the swap and its `--dev-react` escape
hatch are gone.

## React concurrency on the chat input: built, measured, and it doubles the work

Measured 2026-09-14 on Droid 0.218.1. Both `useDeferredValue` and `startTransition` were built as
real binaries and measured against a counter build. Both roughly **double** React commits per
keystroke. **Neither ships.**

The question that started this was whether the chat input has render priority, and how much of the
app re-renders when the transcript is full of messages and tool calls. The answer to the second
question is what killed the first.

### First, the baseline nobody had: counting renders instead of guessing

Every earlier typing number in this document is CPU attribution. CPU says how much work happened,
never how many times it happened, and the two fixes shipped above were both really about **counts**.
So the first build here was a counter, not a candidate: five instrumentation patches that increment
a global and sample it to a file every 200ms alongside `process.cpuUsage()`.

| Counter   | Patch site                                | What it counts                      |
| :-------- | :---------------------------------------- | :---------------------------------- |
| `root`    | `_rD` prologue                            | Root component function calls       |
| `commit`  | Ink's `resetAfterCommit`                  | React commits reaching the host     |
| `frame`   | Ink's `writeFrame`                        | Terminal frames built and written   |
| `input`   | `Y6T` parameter list, via a default value | Chat input component function calls |
| `suggest` | The slash-command match call              | Slash menu scans                    |

Two shapes are worth keeping. A component's render counts cheaply from a **defaulted extra
parameter** (`function Y6T({...,__od=(...).input++,`), which needs no statement context and cannot
disturb the body. A value used in an expression counts through a **comma expression**
(`=((...).suggest++,OBh(MT,XR))`), which is the same trick `INSTRUMENTING.md` records for marks.

Measured baseline, keys at 16ms apart, empty transcript:

| Window                 | root | commits | input renders | frames |    CPU |
| :--------------------- | ---: | ------: | ------------: | -----: | -----: |
| 60 plain keys          |    4 |      62 |            62 |  22-26 | ~280ms |
| 20 keys after `/`      |  2-4 |      22 |            21 |    7-9 | ~350ms |
| 1 second idle, no keys |    2 |       1 |             1 |      1 |   44ms |

**The input already renders exactly once per keystroke, and the root is already off the per-key
path.** 62 commits for 60 keys is the floor, not a symptom. The `draft-dismiss-no-rerender` patch
took the root out of the loop already; this is the same result seen from the other side.

There was no priority problem to fix. Everything below follows from that.

### Neither hook is used by the app, and legacy mode no longer blocks them

The bundle contains 3 `useDeferredValue`, 10 `startTransition` and 21 `useTransition` occurrences,
and **every one is inside React's own library files** (lines 134, 23982, 24071 and 24089 of the
extracted source). Zero application uses.

Ink asks for a **legacy** root. `concurrent:!1` is its shipped default, nothing in Droid overrides
it, and `let h=T.concurrent?ConcurrentRoot:LegacyRoot` therefore picks `LegacyRoot`. That would
normally make every concurrency hook a no-op.

It does not, because **React 19.2 compiled legacy mode out**. `createContainer` passes `false` for
the legacy flag into `createFiberRoot`, `ConcurrentMode` appears **zero** times in the production
reconciler, and `requestTransitionLane` and `shouldYield` are both present. The root is concurrent
whatever Ink asks for. That is what made the experiment worth building rather than dismissing.

### Result: both variants are resolved losses

`useDeferredValue` on the two suggestion lists, rendering the deferred copies, 10 paired rounds,
position-balanced, 20 keys typed after `/`:

| Metric        |    base | deferred | paired difference | 95% CI       | Verdict            |
| :------------ | ------: | -------: | ----------------: | :----------- | :----------------- |
| commits       |    22.3 |     41.6 |         **+19.3** | 17.9 to 20.7 | **RESOLVED worse** |
| input renders |    21.3 |     40.6 |         **+19.3** | 17.9 to 20.7 | **RESOLVED worse** |
| CPU           | 379.8ms |  405.1ms |       **+25.3ms** | 4.9 to 45.7  | **RESOLVED worse** |
| frames        |     7.9 |      9.3 |              +1.4 | 0.8 to 2.0   | RESOLVED worse     |
| root renders  |     2.6 |      3.0 |              +0.4 | -0.4 to 1.2  | not resolved       |

`startTransition` around the same four suggestion setters, 10 paired rounds, same window:

| Metric        |    base | transition | paired difference | 95% CI       | Verdict            |
| :------------ | ------: | ---------: | ----------------: | :----------- | :----------------- |
| commits       |    22.3 |       41.8 |         **+19.5** | 18.8 to 20.2 | **RESOLVED worse** |
| input renders |    21.3 |       41.8 |         **+20.5** | 19.8 to 21.2 | **RESOLVED worse** |
| CPU           | 350.1ms |    377.0ms |       **+26.9ms** | 13.4 to 40.4 | **RESOLVED worse** |

The same patch on **plain** typing, 8 paired rounds of 60 keys, confirms it is not a slash-menu
artifact: commits 50.6 to **106.6** (CI 43.1 to 68.9), input renders 50.4 to **106.5**. CPU there
was not resolved (-50.9ms, CI -316.7 to 215.0) because a 60-key window carries far more machine
noise; the counts resolve cleanly where CPU cannot, which is the whole reason the counter exists.

Both variants land on the same number, +19 to +20 commits per 20 keys, because both do the same
thing: they split one render into two.

### Why it backfires

Deferring renders the subtree twice: once with the previous value at urgent priority, then again
with the new one. That is a win only when the second pass is **expensive and genuinely skippable**,
so the urgent pass can paint without paying for it.

Neither holds here. The suggestion list is cheap, and it is always on screen while the menu is open,
so nothing is skipped. Worse, **under Ink every commit reaches `resetAfterCommit`, which builds and
writes a terminal frame**. Two commits mean two frame builds, and frame building is where this
document has already located most of the typing cost (the width scan, the output diff). Concurrency
adds exactly the work the shipped patches were written to remove.

**Rule: concurrency is a scheduling tool, not a cost-reduction tool.** It trades total work for
responsiveness. Under a renderer that writes a frame per commit, that trade has a fixed price of one
extra frame build, and it only pays when the deferred subtree is both costly and skippable.

### Streaming output cannot be deferred at all

The obvious follow-up, wrapping streamed agent output in `startTransition`, has no patch site.

The transcript is **not React state**. `QL`, the messages array, is `cy.items` derived from
`QS=j1t(...)`, which resolves to `useSyncExternalStore` over the session store. Streamed chunks call
`notifyStreamingChange()` on the store, which schedules `emitMessageThreadUpdated("streaming")`, and
React re-renders through the store subscription.

React forces those updates to the sync lane unconditionally: `forceStoreRerender` enqueues at lane
`2`. That is by design, because a store read cannot be allowed to tear across a split render. A
transition wrapped around a store notification is ignored. There is nothing to patch.

### The transcript is already free, which is the real answer

Answering the original question precisely, from the bundle:

- Finished messages render inside Ink's `Static` (`jKT`, which sets `internal_static:!0`). Ink's
  output walker skips those nodes (`skipStaticElements`), and `jKT` renders `R.slice(h)` after its
  layout effect, so an item that has been committed is never rendered again.
- `MessageList` (`GBh`) splits units into `committedUnits`, which go to the static region, and
  `liveUnits`, which do not. The live tail is capped at **2 rows** with a pane open and up to **10**
  while streaming.
- The static region is rebuilt only when `staticKey` changes (screen clear, resize) or the epoch
  bumps, which `IHt` does for a retracted segment, a late hook, or a message landing out of order.
- `fsT`, the tool-call renderer, is a plain unmemoised component, but it sits inside the static
  region once its tool finishes, so memoising it buys nothing.

So a long transcript costs nothing per keystroke, and there is no per-message work left to schedule.
The entire per-key cost is the input box plus the frame write, which is why every idea in this
section had nothing to attack.

### Retraction: the file watcher is a startup cost, not a typing cost

An earlier draft of this section claimed the largest cost during typing was a chokidar file watcher
at 81ms per 100 keys, ahead of anything React or Ink does. **That is wrong, and the error was in the
harness, not the binary.**

`od-profile-typing.ts` passed no `untilMicros` to `selfTimes`, so it aggregated the **entire**
profile: process start, module evaluation, the first paint, and only then the keys. Startup work
outweighs a 1.6s typing window several times over, so the ranking it printed was mostly a startup
ranking wearing a typing label. `selfTimes` has always taken a cut-off; this caller simply never
used it.

Re-measured with the samples split at the first keystroke, 3 runs of 100 keys plus 1 idle run:

| Window                   |   Samples | CPU       | Watcher share                  |
| :----------------------- | --------: | :-------- | :----------------------------- |
| Startup, up to first key | 1709-2152 | 615-760ms | 397-438 samples, **140-156ms** |
| Typing, 100 keys at 16ms |   559-648 | 201-229ms | 3-37 samples, **1-13ms**       |
| Idle, same duration      |       219 | 78ms      | 4 samples, 1.4ms               |

**The watcher costs ~150ms, all of it before the first keystroke.** During typing it is 1 to 13ms,
which is noise. It is not timer-driven during a session: the watchers use native `fs.watch`
(`usePolling:!1` by default, and the polling override is `CHOKIDAR_USEPOLLING`, unset), so an idle
watcher costs nothing. The cost is the **initial crawl**, `_addToNodeFs` walking and stat-ing the
tree when the watcher is created at startup.

This also moves the watcher from a typing item to a **startup** item, where ~150ms is worth having
against a 680ms paint. It belongs with the startup findings above, not here.

**The general lesson is the expensive one.** This document already warns never to rank frames by
summed `timeDeltas`. This is the second way to get a ranking wrong: **profile a window, or you are
ranking the startup you did not mean to measure.** A profile with no cut-off answers a question
nobody asked, and it answers it confidently.

### What typing actually costs now

Typing costs 201-229ms per 100 keys, and idling the same span costs 78ms, so the keys themselves are
worth ~130ms. The top in-window frames, ranked by `samples * median(delta)` with the cut-off
applied:

| Frame                               |   CPU | Samples | What it is                       |
| :---------------------------------- | ----: | ------: | :------------------------------- |
| `stringify` under `persist`         | 9.2ms |      26 | Session state serialised to disk |
| `cloneObject`, `copyDataProperties` | 7.1ms |      20 | Object copying in the store      |
| Ink and React frames                | ~10ms |      29 | The render itself                |
| `lookup` under `net.connect`        | 3.2ms |       9 | Background network, not typing   |

`persist` is the largest single item and it **also runs while idle** (7.1ms of the idle window's
78ms), which matches the session-index `JSON.stringify` already in Open items. That is now the
best-evidenced target in the typing window, and it is a caching problem, not a rendering one.

### The session index: one 4.67MB `JSON.stringify`, and it is not per-key

`persist` belongs to `SessionIndexCache`, a singleton over `~/.factory/sessions`. Traced in full:

- `queuePersist()` sets a flag and a **1000ms** `setTimeout`, then writes the whole index:
  `writeFile(path, JSON.stringify({version, entries: Array.from(this.cache.values())}))`.
- On this machine that file, `~/.factory/sessions-index.json`, is **4.67MB**, built from **13,174**
  `.jsonl` session files across **504** directories.
- Four things call `queuePersist`: `initialize`, `fullScan`, `refresh` and `admitNewSessions`, plus
  `invalidate`. None of them is a keystroke.
- `getAll()` gates rescans behind `maybeRefresh`, which re-scans only when
  `Date.now() - lastRefreshCompletedAt >= 5000`, otherwise calling `admitNewSessions`, which
  `readdirSync`s the sessions root and every `-`-prefixed subdirectory looking for new files.

**Both `readdirSync` stacks from the original profile are this scan**, `refresh` and its recursion.
The measured cost at startup is 19.9ms plus 11.4ms.

Critically, **a 5x longer idle window does not multiply the cost**: 1.6s idle charges 9.1ms to
`persist` and 8s idle charges 8.6ms. If this were a running timer the longer window would pay ~5x
more. It does not, so what the profile catches is **one startup-tail serialisation** drifting past
the window boundary, not per-keystroke work.

That demotes it. It is one 4.67MB stringify at startup, not a typing cost, and the honest reading of
the earlier "~8ms even when idle" note is the same single event seen twice.

### Where startup time actually goes, split at first paint

Splitting the same profile three ways, at paint and at the first key, separates what **blocks the
input box** from what merely runs afterwards. Only the first table is worth patching.

Up to first paint (paint at 1017ms):

| Frame                                  |    CPU | Samples | What it is                             |
| :------------------------------------- | -----: | ------: | :------------------------------------- |
| `watch` / `FSWatcher` under `fs/watch` | 93.7ms |     261 | Watcher creation and its initial crawl |
| `spawnSync` under `commandExists`      | 18.3ms |      51 | A blocking `which` probe               |
| `memoryUsage`                          | 10.4ms |      29 | Repeated `process.memoryUsage()` calls |
| `Collator`                             |  9.3ms |      26 | Intl collator construction             |
| Zod schema construction                |  7.9ms |      22 | Still there after the lazy-bind patch  |
| `JSON.parse` under `loadFromDisk`      |  6.8ms |      19 | Parsing the 4.67MB session index       |

After paint, before the first key (a 722ms settle, 179.5ms of CPU):

| Frame                                      |    CPU | Samples | What it is                    |
| :----------------------------------------- | -----: | ------: | :---------------------------- |
| `readdirSync` under `refresh` (two stacks) | 28.8ms |      80 | Scanning 13,174 session files |
| `alloc` under the index loader             | 15.8ms |      44 | Buffers for the 4.67MB index  |
| `structuredClone`                          |  7.9ms |      22 | Copying loaded state          |

**This overturns the ranking from the un-split profile.** The session-index scan is _not_ on the
critical path to paint: `loadFromDisk` parses before paint at 6.8ms, but the expensive `readdirSync`
crawl and its allocations land in the post-paint settle. Deferring it would move work that is
already deferred.

**The watcher is the opposite, and it is the one real target.** 93.7ms sits squarely before paint,
against a ~680ms patched paint, which is about 14% of time-to-interactive and the largest single
remaining item. Nothing needs a file-change event before the input box exists.

One caveat on the index: it scales with session count. This machine has 13,174 sessions in 504
directories and a 4.67MB `sessions-index.json`. A fresh profile pays far less, and every startup
number in this document was measured here, so that cost is inside all of them.

Idle Droid also does 2 root renders and 1 frame write per second from the TTY health poll
(`setInterval` checking `isatty(0)` and `isatty(1)`).

## Shipped: `settings-watch-after-paint`, worth 92ms of paint

The watcher prediction above held. Deferring the watcher start cuts paint by **89.2ms, n=30 paired,
CI -110.5 to -67.9**, on top of the existing patch set. That is the largest single startup win since
the model-registry patch.

### The patch

`SettingsManager.enableWatching()` is called synchronously from `initializeWithManager`, well before
paint. It walks seven collections of settings sources and calls `startWatching()` on each, and each
one registers `fs.watch` handles and crawls its tree.

```js
enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,
```

The flag is still set **immediately**; only the `startWatching()` calls move. That detail is the
whole patch, and getting it wrong broke three earlier attempts.

The `$ow()` guard is the second detail, and review caught its absence. `disableWatching()` can run
inside the 400ms window: `McpService.withTargetedOperation` calls `disableWatching()` then
`enableWatching()` in a `finally`, and `stopWatching()` and `resetInstance()` both disable. Without
the guard the pending timer fires afterwards, sets the flag back to true and starts every watcher,
undoing a cleanup that already ran. Reproduced in isolation:

| Variant                           | After `enableWatching()` then `disableWatching()` |
| :-------------------------------- | :------------------------------------------------ |
| No guard                          | `watchingEnabled:true`, calls `stop` then `start` |
| `if(!this.watchingEnabled)return` | `watchingEnabled:false`, calls `stop` only        |

The `.unref?.()` is the third: a 400ms timer that holds the event loop open would delay exit for a
short-lived invocation. `--version` still exits in 0.15s.

### Three wrong versions, and the reason they were wrong

**Sources read the flag at construction time.** `ensureFolder()` builds a source with
`this.folderFactory(this.folderPath, this.watchingEnabled)`, and each source's constructor is
`constructor(T,R=!1){super();if(this.folderPath=T,R)this.startWatching()}`. Sources are created
lazily, so any patch that leaves `watchingEnabled` false while startup continues produces sources
that are **born unwatched** and never start. Watching silently dies.

| Attempt                                           | Paint                   | Behaviour    |
| :------------------------------------------------ | :---------------------- | :----------- |
| `setTimeout(...,0)` around the call               | not resolved            | fine         |
| Hold a closure, release it at `first_paint`       | watcher still pre-paint | fine         |
| Hold a closure, release it at `input_mounted`     | watcher still pre-paint | **broken**   |
| Set the flag, defer only the starts (**shipped**) | **-89.2ms**             | verified 3/3 |

`setTimeout(...,0)` fires on the next tick, roughly a second before paint, so it moved nothing. Both
React boundaries fire **before** the terminal bytes flush, so neither is "after paint" in any useful
sense. The `input_mounted` version also sat behind an early return (`if(!B||L)return;`), so the
release could be skipped entirely and the hold never ran.

**The rule: a React effect is not the paint boundary.** `first_paint` and `input_mounted` are
recorded inside effects that run before Ink writes the frame. For work that must not compete with
painting, a short timer beats a lifecycle hook, and the timer must not gate a flag that other code
reads synchronously.

### Verifying behaviour, and a harness bug worth recording

A faster binary that stopped noticing file changes would be a silent regression, so behaviour was
tested directly: create `~/.factory/commands/<name>.md` **after** paint, open the slash menu, and
require the new command's description to appear.

The first three versions of that test failed against the **stock** binary, which is the only reason
they were caught. Four separate bugs:

- A fresh `HOME` lands on the login screen, so the menu never opens. Test against the real profile.
- Writing the whole command name in one `terminal.write` produced no output at all. Keys must be
  paced (~40ms apart), exactly as the typing harness does.
- The menu filters fuzzily, so a long probe name matched nothing. A short name works.
- Matching on the probe's own name matched the **echo of the typed characters**, not the menu. Match
  on the command's description instead, and clear the transcript before typing.

**A behaviour test that has never failed against stock has not been validated.** Run the control
first; a green control is what makes a green candidate mean anything.

## Open items

- `hasAnyAvailableModel@SettingsService.ts:1082` runs the policy scan outside any `useMemo`. Worth
  checking whether the remaining ~36ms is all of it.
- `probe keys` measures lag with one sample per run, so it needs far more rounds than echo before
  its interval means anything. Prefer paired CPU attribution for typing work.
- A session-index cache runs `JSON.stringify` during typing and costs ~8ms even when idle.
- The 400ms delay in `settings-watch-after-paint` is a guess that measured well, not a tuned value.
  Worth sweeping. On a machine slow enough that paint lands after 400ms the watcher crawl lands back
  on the critical path, so the patch degrades to stock rather than regressing, but it stops paying.
- A residual ~44ms of `fs.watch` still runs before paint even with the patch applied, so at least
  one watcher starts outside `enableWatching`. Finding it is the next 40ms.
- `commandExists` runs a blocking `spawnSync("which", ...)` before paint for 18.3ms. `Bun.which` or
  a cached lookup would remove it.
- The session index is **not** worth deferring: its scan already runs after paint. Shrinking the
  4.67MB file would still help a heavy user, but it is not on the critical path.
- Every startup number in this document was measured on a machine with 13,174 sessions. The
  session-index share scales with that count, so results will differ on a fresh profile. Worth
  re-measuring against an empty `~/.factory/sessions` to separate the fixed cost from the scaling
  one.
- The TTY health poll re-renders the root twice a second while idle. Cheap, but it is the only
  reason an idle Droid renders at all.
- **Every render count above was taken with an empty transcript.** The static-region reasoning says
  a long transcript changes nothing per keystroke, but that is read from the code, not measured.
  Re-run the counter after a real session to confirm it.
- The counter patches live in `/tmp/od-counters.json` and the harness that reads them is not in the
  repo. If render counts are worth measuring again, they belong in `src/patch/trace-patches.ts`
  beside the phase and module probes.

# Feature findings

Adding a feature to a binary whose whole purpose is speed, measured 2026-09-14. The patch is the
turn clock: `↑7m ↓5m` in the footer, how long ago the prompt went out and the reply landed.

## The headline

| Question                             | Answer                                                       |
| :----------------------------------- | :----------------------------------------------------------- |
| Did it cost startup?                 | No. Not resolved, n=14, 95% CI -39 to +15ms                  |
| Did it cost typing?                  | No. 89 bytes of 33,462 for 60 keys, 0.27%                    |
| What does a continuous display cost? | One repaint per visible change. That floor is not negotiable |
| What set the cost, then?             | The **format**. Per-second text costs 60x per-minute text    |
| What did the reviewer catch?         | Timestamps read from the render, not from the session        |

## Measure a patch against a rebuild of itself, never against the installed binary

The first A/B put the new binary against `~/.local/bin/droid` and reported the installed one **44ms
faster** (n=12, CI -77 to -11), which reads as a real regression.

It was page-cache warmth. The installed binary is launched all day; a freshly written 159MB file in
`/tmp` is cold. Rebuilding a control from the same patch set **minus the three new patches**, in the
same directory, moved the same comparison to +4.4ms with the interval spanning zero.

**A control must differ from the candidate by the patch and nothing else**, including where it lives
and how recently it was written. This is the same class of error as the leaked-environment defect in
the startup section: the harness, not the app, produced the number.

## The format is the performance decision

A relative clock has one unavoidable cost: the text changes, so something must redraw it. The only
question is how often, and the **display format alone** decides that.

| Format      | Idle repaint cost        |
| :---------- | :----------------------- |
| `↑45s ↓43s` | 30,780 bytes per minute  |
| `↑<1m ↓<1m` | 3,120 bytes per 150s     |
| `↑14:32`    | zero, after the one draw |

Same feature, same code shape, 25x apart. Seconds resolution animates a digit nobody reads and pays
60 repaints per minute for it.

**Pick the coarsest format that answers the question, then let the timer match it.** Precision the
redraw budget cannot honestly support is a lie anyway: a one-minute timer printing `43s` is wrong
for most of that minute, which is why the patch prints `<1m` instead.

## Do not subscribe to a shared ticker to animate one label

Droid has `dAT(intervalMs, enabled)`, a `useSyncExternalStore` hook over one **shared 125ms
interval**. Subscribing is one line and looks like the idiomatic choice.

It is the wrong one. The interval runs for the rest of the session, at 8Hz, whether or not the
subscribed text has changed, and the hook's `intervalMs` only rounds the value it hands back.

A self-rescheduling `setTimeout`, aligned to the next boundary that changes a digit, costs one timer
that fires exactly when the display is stale:

```js
let $age = Date.now() - $last,
  $step = $age < 36e5 ? 6e4 : $age < 864e5 ? 36e5 : 864e5,
  $id = setTimeout(() => $re((V) => V + 1), $step - ($age % $step));
```

Aligning to the boundary rather than sleeping a full step is what keeps a clock that has been idle
for 40 seconds from showing the wrong minute for another full minute.

## Render-time timestamps are wrong whenever the component is unmounted

The first version stamped `Date.now()` during render, on the edge where session status left or
returned to `"idle"`. Every live test passed. `sol-reviewer` rejected it anyway, and was right.

The footer renders conditionally: `!NT&&P1.jsxDEV(Yht,{...})`, where `NT` is the command-menu
visibility state. **Opening the slash-command menu unmounts the footer.** A turn that finished while
the menu was open was recorded when the menu closed.

Reproduced by opening `/` mid-turn and waiting 70s:

| Build             | Shown after closing the menu |
| :---------------- | :--------------------------- |
| Render-stamped    | `↓<1m` (wrong by a minute)   |
| Reads the session | `↓1m`                        |

Resuming an already-busy session told the same lie: it stamped the resume, not the prompt.

The fix is to separate the two questions. **The edge says when to look; the session says when it
happened.** Droid already stores the answer:

```js
XA().getSessionStateManager().getSessionManager(S)?.getDroidWorkingStateChangedAtMs();
```

Generally: a React render is not a clock. Any timestamp derived from "the moment this component
noticed" is only correct while the component is continuously mounted, and a TUI that swaps panes
over its own footer never guarantees that.

## A probe that skips the feature's code path cannot measure it

`probe keys` reported the control **18ms faster on lag** (n=6). It never submits a prompt, so no
turn exists, so the clock is switched off for the entire probe. The number could not have come from
this patch.

Counting bytes painted during a 60-key burst **after** a real turn put the difference at 89 bytes of
33,462.

Before believing a probe, confirm the feature is switched on inside it. `probe keys`'s own lag
metric is one sample per run and was already flagged unreliable at low n in the typing section; this
is the second way it misleads.

## Open items

- The single timer aligns to whichever of the two times is newer, so the other may show its previous
  minute for up to 59s longer. A second timer would fix it and double the idle repaints.
- Idle repaint cost was measured by counting bytes written to the PTY. `DROID_PROFILE=1` recorded
  zero `ink-render` events across every run, so the profiler's render instrumentation either does
  not cover this path or does not flush. Worth finding out before trusting it for render counts.

# Idle findings

Measured on Droid 0.218.2, 2026-09-14. The question is what a Droid costs while nobody is typing,
because that cost is what decides how many sessions fit on one machine.

## The headline

| Question                              | Answer                                                          |
| :------------------------------------ | :-------------------------------------------------------------- |
| What does an idle session cost?       | **~540ms of CPU per minute** and **~300MB** of real memory      |
| Does the patch set already help?      | Yes. **-657ms/min** of idle CPU (n=4, CI -889 to -425) vs stock |
| Is the idle CPU in the timers?        | No. Slowing every 1s poll by 10x changed nothing                |
| Does forcing GC while idle reclaim?   | No. Costs 250ms/min and frees nothing resolvable                |
| What actually caps parallel sessions? | Memory, and most of it is **not** the Droid processes           |

## `ps` RSS is the wrong number, and it is wrong by 2x

A Droid process reports **350MB of RSS** and a **179MB physical footprint**. The gap is the 159MB
binary: every Droid maps the same file, and RSS charges each one the full copy even though the
kernel holds one set of pages.

That matters here more than anywhere else, because the whole question is how many sessions fit.
Summing RSS across 12 sessions double-counts the shared binary twelve times and overstates the
machine's real load by gigabytes.

**`probe idle` reports physical footprint as the headline and keeps RSS beside it as a diagnostic.**
Footprint comes from `vmmap -summary`, which costs ~1s per process, so it is read once at the end of
the window rather than on every sample.

| Metric             | One idle session pair | What it means                      |
| :----------------- | --------------------: | :--------------------------------- |
| `ps` RSS           |                ~412MB | Counts the shared binary twice     |
| Physical footprint |                ~300MB | What the machine actually gives up |

## The patch set is already the largest idle win

Stock against the same patch set, interleaved, 45s idle windows:

| Binary  |    Idle CPU | Footprint |
| :------ | ----------: | --------: |
| Stock   | ~1180ms/min |    ~557MB |
| Patched |  ~520ms/min |    ~555MB |

Paired difference: **-657ms/min of idle CPU** (n=4, 95% CI -889 to -425) and **-146MB of footprint**
(n=4, CI -242 to -50). Most of that is the React production swap: the development build's hook
checks and invariants run on every render, and an idle Droid still renders.

## Null result: the idle timers are not the idle cost

An idle Droid fires **227 timer wake-ups per minute**, which looks like the obvious target. It is
not. Four intervals dominate the count:

| Fires/min | Delay  | What it does                                                |
| --------: | :----- | :---------------------------------------------------------- |
|        61 | 1000ms | TTY health poll, `isatty(0)` and `isatty(1)`                |
|        61 | 1000ms | Terminal size poll, backs up `resize` and `SIGWINCH`        |
|        61 | 1000ms | Status line poll, re-reads the configured status line       |
|        31 | 2000ms | Background task list, walks processes and `JSON.stringify`s |

Slowing **all three 1-second polls to 10 seconds** moved nothing: **-17.7ms/min, n=6, 95% CI -41.9
to +6.4**, against a resolvable floor of 24ms. Footprint likewise unresolved.

**A wake-up is not a cost.** Each of these does a few microseconds of work and goes back to sleep;
227 of them a minute is still under a millisecond of real work. The idle CPU is somewhere else, and
counting timers cannot find it. `probe timers` is still worth having, because it is what turned a
plausible target into a measured non-target in one run.

## Null result: forcing GC while idle

Droid's own resource monitor calls `Bun.gc()` on its sampling path, so a more aggressive version
looked plausible for a long-lived idle session. A 10s forced full GC was **250ms/min more
expensive** (n=4, CI +76 to +423) and freed nothing resolvable (CI -287 to +305 MB).

Idle memory is not garbage waiting to be collected. It is live: loaded modules, the session index,
and the JIT's own code. Measured over a 5-minute idle window, growth is **+2.2MB/min** for the TUI
and **+0.3MB/min** for the exec child, which is drift, not a leak.

## The real memory story is the process count, not the process

One session is **five processes**, and the two Droid ones are the smaller half:

| Process                         | Footprint |  Idle CPU |
| :------------------------------ | --------: | --------: |
| `droid` (TUI)                   |    ~167MB | 300ms/min |
| `droid exec` (JSON-RPC child)   |    ~126MB | 207ms/min |
| `chrome-devtools-mcp`           |    ~129MB |  38ms/min |
| `npm exec chrome-devtools-mcp`  |     ~91MB |   0ms/min |
| watchdog (`telemetry/watchdog`) |     ~16MB |   0ms/min |

Across 12 live sessions on this machine: **31 Droid processes, 39 MCP processes, 9.7GB**.

**The `npm exec` wrapper is the cheapest win available and it is not a patch.** It costs ~77MB per
session on average and does nothing after startup: it resolves a package that is already on disk and
then sits there as a parent. Pointing the MCP config at the resolved entry point removes one process
per session and returns an identical `initialize` response:

```json
{
  "command": "node",
  "args": [
    "~/.npm/_npx/<hash>/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js",
    "--browserUrl",
    "http://127.0.0.1:9333"
  ]
}
```

Verified by driving both forms with a raw JSON-RPC `initialize` and diffing the reply: same protocol
version, same `serverInfo`, one fewer process. The tradeoff is that the pinned path stops following
`@latest`, which is a deliberate choice rather than a free win.

**The ranked idle list is therefore: MCP servers first, then the exec child, then the TUI.** Two
thirds of the memory behind a parallel session is not Droid's code at all, and no patch to the
binary can reach it.

## Open items

- The 2000ms background-task interval `JSON.stringify`s a process list on every tick. It survived
  the 10x sweep untested because that sweep only touched the 1s polls. Worth its own A/B.
- Idle CPU was never attributed to a single frame. `probe idle-cpu` profiles the window after paint
  and the top frame is a 24.7ms `findLastIndex` over an invocations array, but at 1031x inflation
  that is a stall holding someone else's time, not work. Needs a longer window before it means
  anything.
- The exec child costs 207ms/min and ~126MB while idle and was never investigated. It is the second
  largest item and nothing here explains what it does while nobody is typing.
- Every idle number was measured with one MCP server configured. A profile with none is the control
  that separates Droid's idle cost from its servers', and it was never run.

# Exec startup findings

## The headline

**Droid 0.219.0 added a blocking wait for the connectors tool catalog to `exec` startup, and it
costs ~450ms on every `droid exec` launch, `--help` included.** Stock 0.218.2 against stock 0.219.0,
`probe exec --stage help -r 30`, n=30 paired, first byte: 0.219.0 slower by 450ms (CI 387 to 513).
Shutdown tail did not move.

## Where it is

Droid's own profile (`DROID_PROFILE=1`) shows one blocking phase that 0.218.2 does not have:
`catalog_ready`, median 581ms, starting right after `handler_import` and ending right before the
handler runs. Its partner `catalog_prime` is a background task started once feature flags warm.

In the extracted 0.219.0 source the exec startup does, in order: warm feature flags, then `.then`
into `tG("catalog_prime", hjt)`, and later `await Xg("catalog_ready", () => s_(a, 2500))`, which is
a 2.5s timeout race on that same promise. `hjt` returns at once unless the `connectors` feature flag
is on; with it on, `pvo` fetches the catalog revision (`GET toolsRevision`, 2s cap) and, on a miss,
the tool list (`POST toolsList`, 10s cap). The interactive TUI has no equivalent wait.

## Verified with the flag forced off

`FACTORY_FEATURE_FLAGS_OVERRIDES='{"connectors":false}'` drops `catalog_prime` and `catalog_ready`
to 0.1ms and 0.0ms. Three-way `probe exec --stage help -r 30`, medians to first byte:

| binary                        | first byte |
| ----------------------------- | ---------- |
| 0.218.2 stock                 | 949ms      |
| 0.219.0 stock                 | 1316ms     |
| 0.219.0 stock, connectors off | 819ms      |

So with the catalog wait removed, 0.219.0 is ~130ms faster than 0.218.2. The rest of the release
(newer Bun, tighter bytecode) is a win, not a loss.

On the patched 0.219.0, where the settings patches already cut `feature_flags_warm` to ~5ms, the
catalog wait is most of what is left: 470 to 780ms of a 720 to 1120ms startup.

## Not patched: the TUI does not pay for it

The interactive startup runs the same `catalog_ready` wait, but the input box paints before it
resolves. `probe ab -r 20` on stock 0.219.0 with and without the connectors flag: medians 965ms and
966ms, paired difference unresolved (CI -118 to 226). Since the patch set optimises the TUI, the
exec wait is left alone. If that changes, the fix is to drop only the `catalog_ready` await: the
agent turn already fetches the catalog lazily with its own 2.5s cap (`pcc`) when nothing is primed.

## Notes

- `probe exec` strips every `FACTORY_*` variable from the child's environment, so an env override
  needs a wrapper script. `work/bins/droid-0.219.0-nocatalog` is the one used above.
- There is no download URL for old Droid releases. Stock and patched 0.218.2 are kept under
  `work/bins/` (gitignored) alongside 0.219.0, with both extracted sources under `work/src/`.

# First message findings

## The headline

**In a new session the first message, slash-command skills included, does not appear until the
`droid exec` worker has started every MCP server.** With `blockOnMcpLoad: true` in
`~/.factory/settings.json` the worker's `mcp_init` phase blocks its ready signal, and the TUI's
`runAgent` (hook `useDaemonAgent`) awaits session creation (`qe` → `initializeTuiSession`) before it
adds the optimistic message. Across 246 worker starts in the logs, ready took p50 1.8s, p90 8.5s,
max 17.8s. The turn gate is not the cause: all 173 logged gates were under 0.5s.

## Shipped: `first-message-shows-at-once`

The pre-created session id (`p().getCurrentSessionId()`) already has a session manager before `qe`
resolves, and `initializeSession` keeps optimistic messages. So the patch adds the message and sets
"Thinking..." on that manager before the await, and undoes both if session creation fails, the send
throws, or the session that comes back is a different one. The message still goes to the daemon with
the same request id, so the daemon treats it as the running turn, not a queued one.

`bun run probe first-send <binary> --cwd <project>` measures it. In fightsignal (9 MCP servers),
five alternating runs each: patched shows the message and "Thinking..." after 6 to 42ms, stock after
1.2 to 20.6s. The reply time does not change (it is still MCP start plus the model), and no run
showed "queued". A `/skill` first message behaves the same (patched 7ms, stock 3.3s).

Those numbers were taken with a probe that typed the message a key at a time, which takes ~3s and
hides most of the wait. The probe now pastes it in one write and times from Enter. On 0.227.0 in
fightsignal, `--after-clear`: stock shows the message after 1.4 to 2.3s, patched after 0.1 to 0.2s.
The working spinner is " Streaming... " on 0.227.0, so the probe keys on "(Press ESC to stop)".

The spinner offers Esc, but stock's stop callback returns at once while `xe.current` is still null,
so Esc did nothing and the turn went out once the session was created.
`first-message-cancel-before-session` fills that gap: the early message records its request id on
the manager (`$ODr`), Esc before the session exists removes the message, stops the spinner, posts
the stock "Request cancelled by user" notice, and marks it cancelled (`$ODc`); the send then returns
"accepted" without sending, so no caller re-queues it. /tmp/slowmcp (one 15s MCP server), Esc ~150ms
after the message shows: patched shows the cancel notice 0.4s later, no reply in 30s, and the next
message replies in 2.6s.

## Project MCP servers: npx is most of the stdio cost

Per-server start latency from the logs, p50: trigger (npx) 3.2s, db-local (npx) 2.2s, vercel (remote
HTTP) 2.1s, the rest under 0.5s. `npx` resolves the package against the registry on every start;
`--prefer-offline` and `--offline` do not help, and inside a pnpm workspace npx is slower still.
Running the package's own entry file with `node` from the project's `node_modules` cuts a server to
~0.45s (trigger) and ~0.05s (postgres) standalone.

A shared project file cannot name a machine path, and stdio servers start in the session cwd, not
the project root, with args not env-expanded. The portable form is
`sh -c 'exec node "$(git rev-parse --show-toplevel)/<path>" "$@"'`; it costs ~20ms. fightsignal
rewritten by hand this way: `mcp_init` went from 6.3 to 9.7s (6 runs) to 4.3 to 7.8s. trigger now
starts in 0.76 to 1.0s and db-local in 0.09 to 0.2s once warm. The spread is the remote servers.

`ovrdroid doctor` checks only the user `~/.factory/mcp.json`. A project scan with an automatic fix
was built (git stash "doctor: scan and --fix project .factory/mcp.json", ~180 lines plus tests) and
shelved: most of it was the fix, and a hand edit per repo is two lines.

## Shipped: `mcp-servers-start-together`

Stock `reloadServers` connects remote HTTP and SSE servers one after another in a `for` loop, then
starts stdio servers in parallel. With 5 remote servers in fightsignal that serial chain was the
longest part of `mcp_init`. The patch starts all of them in one `Promise.all`; each server keeps its
own try/catch, so one failure still cannot stop the others. OAuth flows can now run at once; the
callback server already keys pending flows by state, so they do not collide.

fightsignal, `droid exec --list-tools`, 8 alternating pairs against the build without it: `mcp_init`
median 3.9s against 5.1s, faster in all 8 pairs (paired median 0.87s, range 0.17 to 2.85s), and all
377 MCP tools loaded on every run.

## Shipped: `session-worker-starts-mcp-in-background`

The TUI's worker (`droid exec --input-format stream-jsonrpc`) waited for MCP twice with
`blockOnMcpLoad` on: once at worker boot (`s3`, before it answers `initialize_session`) and again
before every agent turn (`awaitMcpReadinessBeforeAgentTurnIfEnabled`, which starts MCP itself if
needed). The patch sends the jsonrpc worker down `s3`'s background branch, so the session exists at
once and the per-turn gate does the only wait. Logs confirm the order flips: `Session initialized`
now comes before `mcp_init` completes.

The exemption covers `blockOnMcpLoad` only. The first version overrode the whole condition, so
`listTools` and tool-selection flags (`Qi(e)`) lost their wait too:
`droid exec --input-format stream-jsonrpc --only-tools MCP:<server>` validated its selectors before
any MCP tool existed and exited 1 with `Unknown tool identifier(s)`. It now exits 0, as stock does.

It does not replace the TUI patches. Built without each one:

- without `first-message-shows-at-once`, a message typed as soon as the box paints showed after 1.4
  to 2.3s instead of ~0.3s: session creation still costs the worker boot.
- without `new-session-loads-in-background`, `/clear` took 1.2 to 1.4s instead of ~30ms.
- without `session-load-keeps-pending-settings`, an effort change right after `/clear` was lost.

What it buys is overlap: session setup runs while MCP starts. fightsignal,
`probe first-send --at-paint`, 12 alternating pairs against the build without it: reply median 7.5s
against 8.9s, faster in 8 of 12 pairs, paired median 0.73s. Model latency makes single pairs noisy.

With the boot wait gone, the per-turn gate is the only thing keeping late MCP tools out of turn two,
where they would grow the tools array and bust the whole prompt cache (`TOKEN_OPTIMIZER.md`, "Busts
closed"). The old `mcp-gate-timeout-15s` patch capped that gate at 15s, which was harmless while the
uncapped boot wait covered turn one; logs show `mcp_init` up to 36s and 13 of 447 starts over 15s,
so it would now cost a bust on ~3% of starts. It is dropped, and the gate keeps stock's 60s cap. The
message still shows at once either way; only the first reply waits.

## Open items

- Per-server start times reach the log only when the TUI's metrics flush, and `exec --list-tools`
  never writes them, so there is no per-run per-server number yet.
- `blockOnMcpLoad: false` skips the wait entirely, but a first turn without every MCP tool grows the
  tools array later and busts the prompt cache, so it is not an option here.

# Prompt cache findings

Work on `TOKEN_OPTIMIZER.md` starts here. Measured on Droid 0.222.0, 2026-09-18.

## Shipped: `cache-usage-log`, the first per-request record on disk

Droid never writes per-request token usage. `commitTurnTokenUsage(t,r)` in `chunk-37dfzwbw.js` is
called once per finished, non-aborted LLM request with
`{inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, thinkingTokens}` and the model
id; it only adds the numbers into session sums. The patch appends one line per call to
`~/.factory/ovrdroid/cache-usage.jsonl`:

```
{"t":1789735449729,"s":"13a0a153-...","m":"claude-opus-5","in":2,"cr":0,"cw":26108,"out":4,"th":0}
```

Gated on the directory existing, `appendFileSync` in a try/catch, never throws into a turn. A second
anchor, `cache-usage-log-promote`, writes `{"t","s","m","promote":true}` when the built-in 1h
promotion timer fires (`W4e`, still gated to JSON-RPC mode or an agent process, so it never fires in
the terminal today).

Verified: `ovrdroid apply --target /tmp/droid-test` builds and signs; one `exec` turn produced the
line above. `bun test src/patch` green.

What 0.222.0 does **not** do, read off the bundle (`probe grep`, unique anchors):

- The stream reducer reads `cache_creation_input_tokens` and `cache_read_input_tokens` only. It
  never reads `cache_creation.ephemeral_5m_input_tokens` or `ephemeral_1h_input_tokens` (zero
  occurrences in the whole bundle). So the 5m/1h split of a write cannot be logged from Droid; it
  needs `probe ttl` against the API directly.
- The `{type:"ephemeral",ttl:"1h"}` marker (`hb`) is not only for promotion: the system prompt gets
  `cache_control:hb` in `chunk-7qfj9w75.js`, and `Qi` applies it when `cacheSystemPrompt` is on.
  Whether that 1h request survives DroidProxy is an open ledger row.
- The `[Agent] Streaming result` log line carries usage but no session id or model in its own
  object; both sit in `tags`. The rotating logs are the only per-request truth for the past 3 days.

## Ground truth preserved

`~/.factory/logs/droid-log-single.log*` is copied to `~/.factory/ovrdroid/logs/` by `probe logs` (13
files, 950 MB, 2026-09-14 to 2026-09-18). Its first summary: 11,794 `Streaming result` lines across
405 sessions; 190 `prompt_cache_miss_detected` warnings, every one `prefix_mismatch`, and 189 of 190
with the mismatch at a `tools.N` segment (114 anthropic, 75 openai_responses) while the previous
request's segment at that index was `messages.0.user.metadata`. Read plainly: when Droid detects a
broken cache prefix, it is almost always the tools array that changed, not the messages.

Two caveats on the log. `callingSessionIdPresent` is `"false"` on every line, so subagent requests
cannot be told apart from the parent's in this source; the transcript lineage in Part 2 has to do
that. And the OpenAI models report `cache written 0` throughout, because that provider bills no
write; the replay must not treat that as a miss.

## Measured: DroidProxy upgrades every cache write to 1 hour

`probe ttl price --yes --prompt-tokens 8000` on `custom:droidproxy:fable-5-1`, 2026-09-18, and two
by-hand repeats with fresh 22k-token prompts:

| request asked for                             | `cache_creation` split back            |
| --------------------------------------------- | -------------------------------------- |
| `{type:"ephemeral"}` (no ttl, the 5m default) | `ephemeral_5m: 0, ephemeral_1h: 22136` |
| `{type:"ephemeral",ttl:"5m"}`                 | `ephemeral_5m: 0, ephemeral_1h: 22140` |
| `{type:"ephemeral",ttl:"1h"}`                 | `ephemeral_5m: 0, ephemeral_1h: 27136` |

The proxy (CLIProxyM on `localhost:8317`) returns the full `cache_creation` split, so the field is
trustworthy, and it never returns a 5 minute write. Two consequences:

- Through this proxy there is no 5 minute cache to optimise. Every write is already the 1h kind, and
  Droid's `cacheCreationInputTokens` (which it bills at 1.25x in its own cost estimate) is really 1h
  tokens. The whole "promote to 1h" question is moot for DroidProxy users; the open question is
  instead whether the proxy bills the 2x write rate or absorbs it.
- `probe ttl cliff` and `refresh` cannot measure a 5 minute expiry here. The verdict now says so
  whenever every 5m write comes back as 1h tokens. Those schedules need a direct Anthropic key to
  answer the ledger rows they were written for.

Two timed runs the same afternoon confirm it from the other side.
`probe ttl one-hour --yes --prompt-tokens 8000`: a 1h write of 10,313 tokens was read in full after
a 20 minute gap. `probe ttl cliff --yes --prompt-tokens 9000 --minutes 6,12`: a plain
`{type:"ephemeral"}` write of 11,576 tokens was read in full after 6 minutes and again after 12. A
true 5 minute cache would have missed both. Every send is in `~/.factory/ovrdroid/ttl-runs.jsonl`.

Also read off the run: the `3.5 chars/token` filler estimate ran 29% low (8000 asked, 10313 cached),
and 146 tokens cached nothing while 22k did, consistent with the documented minimum.

Ledger moves: `ttl:"1h"` survives DroidProxy, **measured**. 5 minute cliff through DroidProxy,
**measured as not applicable**. The economics table in `TOKEN_OPTIMIZER.md` needs a per-endpoint
caveat before any replay uses it.

**The conclusion drawn from this run was wrong and is retracted in `TOKEN_OPTIMIZER.md`.** It read
the forced 1h write as making the TTL question moot. The measurement holds; the reading of it does
not. Avoiding the 1h write is worth 21.6% of the Claude bill. Everything downstream of that run,
including the nine month replay, the oracle ceiling and the OpenAI comparison, lives in
`TOKEN_OPTIMIZER.md` under "Findings". This file keeps only the patch records and the probe runs
that produced them.

## Measured: the subscription meter has no large 1h premium

2026-09-18, `claude-fable-5-1`, straight to `https://api.anthropic.com/v1/messages` with the OAuth
token from `~/.cli-proxy-api/claude-*.json`, bypassing DroidProxy. The account is
`rate_limit_tier: default_claude_max_20x`, `billing_type: stripe_subscription`, from
`/api/oauth/profile`. Every send is in `~/.factory/ovrdroid/quota-runs.jsonl`; `probe quota` is the
command that reproduces it.

Method: send fresh, unique, uncacheable prompts of one kind until
`anthropic-ratelimit-unified-5h-utilization` rises by 1 percent, and count the tokens between rises.
The meter reports whole percents, so a span is quantised to the send size; the mean over several
spans is the number.

| kind of token         | sends |  per send | tokens per 1% of the 5h quota |
| :-------------------- | ----: | --------: | ----------------------------: |
| 1h cache write        |    36 | 90k / 30k |           210,719 (n=6 spans) |
| 5m cache write        |    36 | 90k / 30k |           220,685 (n=6 spans) |
| plain input, no cache |    34 |       30k |           261,837 (n=3 spans) |
| cache read            |   134 |       90k |   about 4.9M, **not trusted** |

What the data can and cannot say, after review (`sol-reviewer`, same day):

- **The API's 1.6x premium (2.0 over 1.25) is rejected.** If the meter charged it, the 1h arm at 30k
  per send would cross every 4 to 5 sends, about 130k tokens per percent. It crossed every 7 sends,
  three times in a row, 211k each. The 5m arm crossed at 181k to 242k. A 1.6x ratio would put the
  two arms 80k apart; they are 10k apart.
- **A small premium is not excluded.** One 30k send is about 14% of a span, so anything under
  roughly 5% to 10% is inside the quantisation. Arms ran one after another in the same 5h window
  with other Droid sessions uncontrolled, so a few percent of drift is possible.
- **Writes cost about 20% more than plain input.** Plain came out at 262k per percent against 211k
  and 221k for writes, and the ranges do not overlap. That matches the API's 1.25x write multiple
  applied to both TTLs.
- **The read number is not a measurement.** The meter fell from 0.15 to 0.14 during the read arm,
  which means older usage aged out of the window mid-run, and the two spans (5.85M and 3.96M)
  disagree far beyond the send size. All it supports is "a read is far cheaper than a write". The
  probe now flags a run where the meter fell and refuses to present its spans as clean.

So the finding is: **1h and 5m writes cost the same on the meter within a few percent, and both cost
about 1.25x plain input.** The 2.0x versus 1.25x ratio that the nine month replay in
`TOKEN_OPTIMIZER.md` turned into $837 a month is API list pricing and is not what limits this
account.

To make it solid: stop every other Droid session, wait for the 5h meter to settle, then run 1h and
5m arms interleaved (ABAB) at 10k sends, and a separate read arm asking for at least five clean
crossings. `probe quota` does each arm; the interleaving is a shell loop. **That rerun was done the
next day; see below.**

## Measured, controlled: 1h and 5m are the same, and a read is nearly free

2026-09-19, `claude-opus-5`, 700 sends, same direct endpoint and method as the run above.

The rerun moves off Fable to `claude-opus-5`, because a Fable number is not a whole number.
`/api/oauth/usage` returns a `limits[]` array beside the unified meters, and on 2026-09-19 it
carried a `weekly_scoped` entry bound to Fable at 22% and `is_active: true` while the unified 7d
read 15%. `probe quota` counts crossings of the unified 5h header only, so a Fable send spends a cap
the probe cannot see. Opus and Sonnet had no scoped entry, which makes the unified meter the whole
cost for them, and Opus is the model this machine actually runs. A direct 1h send to `claude-opus-5`
was checked the same day: 200, `ephemeral_1h_input_tokens: 11066`, no `claude_code_version_too_old`.

Two things fixed the resolution problem that spoiled the first run. Opus turned out to be about 3.7x
cheaper per token on the meter than Fable (777k tokens per percent against 211k), so a percent holds
far more sends; and the arms ran ABAB in one shell loop, so drift hits both arms alike. At 20k sends
a span is 22 to 44 sends wide, against 7 before, which is what pulled the scatter down to under 5%.

Idleness was checked rather than assumed: with other Droid sessions open but untouched, the meter
sat flat for seven readings over two minutes. An idle session spends nothing; only a running turn
does. No arm saw the meter fall, so nothing aged out mid-run.

| kind of token         | sends | spans | tokens per 1% of the 5h quota |     vs plain |
| :-------------------- | ----: | ----: | ----------------------------: | -----------: |
| 1h cache write        |   222 |     8 |       776,667, sd 36,881 (5%) |       1.245x |
| 5m cache write        |   176 |     6 |       786,094, sd 21,644 (3%) |       1.230x |
| plain input, no cache |   102 |     3 |        966,776, sd 6,334 (1%) |       1.000x |
| cache read            |   200 |     0 |    never moved the meter once | below 0.014x |

- **1h and 5m are the same, now within 1.2%.** The two arms differ by 9,427 tokens per percent with
  a standard error of 15,751, so the difference is smaller than its own noise (t = 0.60). The
  earlier "within 10%" is now within about 3% at one standard error. An API-style 1.6x premium would
  have put the arms 300k apart; the arms are interleaved and repeat, so it cannot hide.
- **Writes cost 1.25x plain input, exactly the API's write multiple.** 1.245x and 1.230x, with the
  plain arm's own scatter at 0.7%. This is the one place the API list multiple does carry over to
  the subscription meter.
- **A cache read is nearly free, and this time it is a real bound.** 200 consecutive reads of a
  35,550 token prefix, 7,110,000 tokens in total, did not move the 5h meter off 0.19 even once. So a
  read costs under 1% per 7.11M tokens, against 777k for a write: **at least 9x cheaper than a
  write, and at least 71x cheaper than plain input.** The bound is one-sided, because the arm hit
  the probe's 200 send cap before the meter ever rose. Unlike the Fable read arm this one is clean:
  the meter never fell, so no ageing-out inflated it.

Method note for anyone rerunning: `probe quota read` reports
`0 crossings; the run stopped before a span could be measured`, which reads like a failure and is in
fact the result. A ceiling needs the send count and the flat meter, not a mean. Raising `MAX_SENDS`
would sharpen the bound at linear cost in quota.

Cost of the whole rerun: about 19% of one 5 hour window, 2% to 21%.

Also measured on the same runs:

- Explicit `ttl:"5m"` sent direct comes back as `ephemeral_5m_input_tokens: 30195`, so Anthropic
  honours it. Sent through DroidProxy the same block comes back as 1h: the bundled backend
  (`cli-proxy-api v7.3.3+dirty`) overrides a client `ttl`, contrary to the upstream `main` source
  the earlier "escape hatch" reading rested on. That ledger row is now **measured as false**.
- DroidProxy forwards none of the `anthropic-ratelimit-*` headers. Quota is invisible through the
  proxy; only a direct call or `/api/oauth/usage` shows it.
- A `user-agent` older than `claude-cli/2.1.251` is rejected for Fable with
  `claude_code_version_too_old`.

Consequence for the plan: on a subscription, TTL choice costs at most a few percent, so the proxy's
forced 1h is the right setting and the 5m patch is dropped. What moves the meter is the rewrite
versus read ratio. The usage optimiser is therefore a bust optimiser: keep the prefix cached, and
stop the tools array from rebuilding it.

## Measured: the TTL is a sliding idle window, and a read refreshes it for free

2026-09-19, `claude-opus-5`, `probe ttl refresh --direct --prompt-tokens 20000 --yes`, 25,538 cached
tokens. This row had been carried as "documented" since the first pass; it is now measured.

The test needs `--direct`. DroidProxy rewrites every `ttl` to 1h, so a 5 minute schedule sent
through it measures the 1 hour cache and every gap under an hour reads, which proves nothing about
refresh. Sent direct with the OAuth token the same block comes back `ephemeral_5m_input_tokens`, so
the 5 minute clock is real and a missed gap is visible within minutes instead of an hour.

| send | gap | age of the entry |                         result |
| ---: | :-- | :--------------- | -----------------------------: |
|    1 | 0   | 0m               |      read 25,538 (from set-up) |
|    2 | 4m  | 4m               |                    read 25,538 |
|    3 | 4m  | 8m               |                    read 25,538 |
|    4 | 4m  | 12m              |                    read 25,538 |
|    5 | 6m  | 18m              | **write 25,538 at 5m**, missed |

The entry lived 12 minutes on a 5 minute TTL, more than twice its nominal lifetime, and every 4
minute gap read the full prefix. Then one 6 minute gap killed it. A fixed lifetime would have
expired it at minute 5 and made send 2 a write. So **each read pushes the expiry a full TTL past
that read**, and the cost of the refresh is the read itself, which the controlled quota run above
measured at under 1/9 of a write.

What decides a bust is therefore the gap between requests, never the age of the entry. Against the
nine month traffic profile (median gap 8.7 seconds, 98.6% of turns under 5 minutes) the window
effectively never closes on an active session, and on the forced 1h the idle gap needed to lose a
prefix is an hour. Time is not what busts this cache; the tools array is.

## Measured: the clock starts at request start, so a long answer eats the window

2026-09-19, `claude-opus-5`, `probe ttl clock-start --direct --prompt-tokens 20000 --yes`. The other
half of the sliding-window question: the gap that matters runs from the **start of the previous
request**, not from the moment its answer finished.

| send | answer time | then   |                   result |
| ---: | ----------: | :----- | -----------------------: |
|    1 |      161.2s | -      |       write 25,538 at 5m |
|    2 |        3.2s | 4m gap | **write 25,538**, missed |

161s of answering plus a 240s gap is 401s since the request began, past the 300s TTL, while the gap
by itself is well under it. The second send missed. If the clock had started when the response
ended, only 240s would have elapsed and it would have read. So the window is measured from request
start, and a slow turn spends its own TTL while it is still talking.

The first attempt at this run proved nothing and is worth recording as a method trap. The schedule
asked for 400 animals and a 3 minute gap; Opus answered in 39s, so only 219s had passed on either
theory and the send read. A hit there is consistent with both clocks, and reading it as evidence for
either would have been wrong. The schedule now asks for 1500 animals with `MAX_TOKENS_SLOW` at
16,000 and waits 4 minutes, and `clockTestDecides` refuses a verdict unless the answer plus the gap
exceeds the TTL while the gap alone stays under it. A run that cannot separate the two clocks now
says so instead of picking a side.

Consequence: the danger window is not the pause between two user messages, it is the whole turn. A
20 minute agent turn on a 5 minute TTL busts its own prefix mid-turn. On the forced 1h the margin is
comfortable, but a very long turn plus a pause can still cross an hour counted from request start
rather than from the last reply.

## Shipped: `custom-openai-shared-cache-key`, new GPT sessions start warm

2026-09-24, Droid 0.225.2. Prompted by Cursor's token efficiency post
(https://cursor.com/blog/improved-token-efficiency), whose cache section is about keeping the start
of every request stable so later requests reuse it.

Droid sends OpenAI a `prompt_cache_key` equal to the session id: `prompt_cache_key:Be??s` in the
stock `chunk-ae8takas.js`, where `Be` is a caller key that is `undefined` for custom models. OpenAI
only reuses a cached prefix inside one key, so every new session and every subagent on a custom GPT
model started cold. In `cache-usage.jsonl` (5.9 days, 192 GPT sessions) the first request of a GPT
session read 0 tokens from cache at the median and sent ~13.5k uncached; those first requests were
16.4% of all uncached GPT input. Claude does not have the problem: 63% of Opus 5 sessions already
read ~10.8k on their first request.

The patch makes the fallback `m?"ovrdroid":s`, where `m` is `isCustomModel`, so every custom OpenAI
model shares one key. Built-in models keep the session id. A prefix only matches a cache written by
the same model, so sharing the key across models cannot mix their caches; it only puts them in one
routing group.

Checked before shipping, all through DroidProxy 1.8.148 (embedded CLIProxyAPI v7.3.15, commit
673131f5, source read at that commit; Codex Plus account):

- **The proxy passes the key through.** `codex_executor_request.go` copies `prompt_cache_key` into
  `cache.ID` for OpenAI Responses input and sends it as `Session-Id`. Live: two keys against one
  prefix, 3s apart, both missed on first use and both read 28,416 on their second, so the key really
  gates reuse. A warm prefix sent under a fresh key usually read 0, but not always: in a 12-send
  alternation, 2 of 6 fresh keys read the shared key's prefix, and stock Droid read 4.6k and 9.7k on
  2 of 11 fresh sessions. The key steers routing to a machine; landing on a warm one without it is
  luck.
- **The proxy's per-key state does not bite.** Its reasoning replay cache is keyed on
  `prompt_cache_key`, but `codexReasoningReplayEnabledForSource` enables it only for Claude-format
  input, and Droid talks to custom GPT in the Responses format. Session affinity pins a key to one
  account; there is one Codex account here.
- **Concurrent sessions on one key are fine.** Four parallel requests on a warm key all read 26,368
  of ~27,200. OpenAI says traffic over ~15 requests/min per key can overflow to other machines
  (https://developers.openai.com/api/docs/guides/prompt-caching); the log's 60s rolling rate crosses
  15 for 18-37% of GPT requests on the busy models. Overflow can cost a read, never correctness, and
  the live runs show no loss at this scale.

Measured, `/tmp/droid-ck` (stock + patch set) against `/tmp/droid-ck.orig`,
`exec -m custom:droidproxy:gpt-6-luna`, two fresh sessions per binary, twice:

| binary  | session 1 cache read | session 2 cache read | uncached input |
| :------ | -------------------: | -------------------: | -------------: |
| stock   |                0 / 0 |                0 / 0 |         10,346 |
| patched |           0 / 10,752 |      10,752 / 10,752 |            114 |

The first patched session missed only because nothing had written the shared key yet. From then on
every fresh session read 10,752 of 10,866 prompt tokens (99%).

`bun run probe cachekey /tmp/droid-ck.orig /tmp/droid-ck -m custom:droidproxy:gpt-6-luna -r 8`
repeats it: stock median cache read 0 (range 0 to 9.7k), patched 10.8k on all 8. Time to first token
is not resolved (paired mean +2.8s, 95% CI -1.7s to 7.3s, sd 6.5s): single sends swing from 1.5s to
22s on both sides, and a direct API alternation of shared and fresh keys showed no latency
difference. The saving is uncached input, not speed.

Not done, and not worth it on this plan: explicit `prompt_cache_breakpoint` markers (Droid has none;
GPT-5.6+ implicit mode already breaks at the last developer message and each user turn), trimming
the system prompt, and changing Read's line numbers (Droid's Read shows none).

## Measured: what keeps a prefix warm, and the cache warmer that came out of it

2026-09-29, Droid 0.228.0. The question: while a subagent runs for longer than the TTL, can the
parent's prefix be kept warm, and by what? The answers shaped the `cache-warm-*` patches.

### An unrelated request does not reset another prefix's clock

`probe ttl unrelated --direct`, `claude-opus-5`, 5m TTL. Send the prefix, send an unrelated prompt 4
minutes later, then the first prefix again 2 minutes after that.

| send | at  | prompt    |                   result |
| ---: | :-- | :-------- | -----------------------: |
|    1 | 0m  | prefix    |             write 25,563 |
|    2 | 4m  | unrelated |             write 24,842 |
|    3 | 6m  | prefix    | **read 0**, write 25,563 |

Activity on the account refreshes nothing. Only a read of the same prefix slides its clock.

### A shared head only keeps the head warm

`probe ttl shared-head --direct`, `claude-opus-5`, 5m TTL, same schedule, where the second prompt
shares its first blocks with the first.

| send | at  | prompt           |                       result |
| ---: | :-- | :--------------- | ---------------------------: |
|    1 | 0m  | prefix           |                 write 25,571 |
|    2 | 4m  | same head, other |     read 6,437, write 18,602 |
|    3 | 6m  | prefix           | read 6,437, **write 19,134** |

The shared 6,437 tokens stayed warm. The 19,134-token tail behind them died on schedule. To keep a
prefix warm, the warm request has to carry the whole prefix, not just its start.

### The proxy's 1h entry is not a reliable hour

Through DroidProxy, which forces every write to 1h, `claude-opus-5-5`.

`probe ttl hour-refresh`: send, wait 54m, send, wait 54m, send.

| send | gap |                         result |
| ---: | :-- | -----------------------------: |
|    1 | 0m  |                   write 25,676 |
|    2 | 54m | **read 0**, write 25,676 again |
|    3 | 54m |                    read 25,676 |

The first entry died before 54 minutes; the second survived 54. `probe ttl hour-cliff` (send, wait
66m, send) wrote 25,683 again at 66m with no read, so the entry is gone by then too. A series with
gaps of 40, 45, 50 and 56 minutes is still running; until it lands, the lifetime is "usually past
54m, not always".

This is why the warmer fires at 45 minutes on Anthropic, not at 90% of an hour. A read costs next to
nothing on this plan (see the quota section above), so firing early is cheap, and a warm that fires
after the entry died is a full rewrite that keeps nothing.

### A thinking change forks the cache in real sessions

Every warm body was captured with a `--bodies` probe build and compared with `probe bodies <file>`,
which reports where each request stops extending the one it replays. Scenario: parent on low effort,
one foreground subagent running `sleep 170`, `OVRDROID_WARM_DELAY_MS=60000`.

Claude, `custom:droidproxy:opus-5-5`, parent request 2 wrote its entry (read 14,180, write 10,130 in
the first capture and 10,204 in the second):

| capture                 | warm sends                                     | warm 1                        | warm 2               | parent request 3 |
| :---------------------- | :--------------------------------------------- | :---------------------------- | :------------------- | :--------------- |
| `bodies-claude-2.jsonl` | same prompt, no `thinking`, no `output_config` | read 14,180, **write 10,130** | read 24,310          | read 24,310      |
| `bodies-claude-3.jsonl` | same prompt, same thinking and effort          | **read 24,384, write 0**      | read 24,384, write 0 | read 24,384      |

In both captures `probe bodies` reports the warm prompt as byte-identical to request 2; only the
settings after it differ. With thinking off the warm wrote its own 10,130-token entry, warm 2 read
that entry, and the parent's own entry was never refreshed. With the same thinking and effort, the
warm read the parent's entry and wrote nothing.

GPT, `custom:droidproxy:gpt-6-sol`, same shape: with reasoning off the warm read 0 on its first try
(and 7,936, the shared head, when the tools also differed); with the same `reasoning` and `include`
as the real turn it read 13,952 of request 2's 14,076.

The earlier `probe effort-cache` "thinking off" result (read 12,562, write 0) does not carry over to
real sessions. The obvious suspect, that the probe's prefix has no assistant turn, is ruled out: the
warm in `bodies-claude-2.jsonl` also replayed only two user messages and still missed. What else
differs between the probe and a real Droid request is not yet pinned down. Until it is, the rule is
the measured one: a warm must send the same thinking and effort as the turn it replays.

### The GPT warm first failed on the tool list

`probe bodies` on the first GPT capture: the warm diverged at `tools[11]`, 51% into the prompt. The
one-shot client (`createOneShotSendMessageClient`) passes `getTools`, which skips the tool-search
resolver, so it sent 17 plain function tools. The real turn sent 50 entries: a `tool_search` tool,
`ApplyPatch` as a grammar tool, and 33 tools marked `defer_loading`. Building the warm with
`createLLMStreamingCore`, the agent loop's own client, with no `getTools`, fixed it: every later
warm reports "extends request 2".

### On Claude, `maxTokensOverride` is overwritten

The captures showed Claude warms going out with `max_tokens:128000` and adaptive thinking, and
answering 175 to 180 tokens. The warm asked for 1. The thinking-config builder (`Gte`) overwrites it
for any custom model with thinking enabled:
`if(l?.maxOutputTokens!=null)f.max_tokens=l.maxOutputTokens`, and `opus-5-5` sets
`maxOutputTokens:128000`. `cache-warm-max-tokens` passes `maxOutputTokens` to `Gte` only when the
caller set no override, so the warm's 1 reaches the body. Anthropic accepts `max_tokens:1` with
adaptive thinking. Live, `custom:droidproxy:sonnet-5-5`, one subagent running `sleep 170`,
`OVRDROID_WARM_DELAY_MS=60000`: the parent's request wrote 20,798 tokens, both warms went out with
`max_tokens:1` and the turn's adaptive thinking at effort low and read 20,798 with 0 written, and
the parent's next request read 20,798.

### How pi does it

pi warms only direct Anthropic and never OpenAI (issue #9810, maintainer comment). It keys OpenAI's
`prompt_cache_key` per session, so its forks miss (#8348).

## Shipped: `compaction-reuse-exports` and `compaction-reuse-prefix`, compaction reads the cache

Stock 0.233.0 summarises with a request that shares nothing with the conversation. `xV()` builds it
through `as()`: the summarizer system prompt, no tools, and one user message holding the whole
transcript flattened to text. Different system, zero tools, one message, so it read 0 from the cache
and wrote the entire transcript at the 1h rate on every compaction. At 178k tokens on Opus that is
about $0.89 each time.

The bundle already keeps what is needed to avoid it. Every main-agent request stores a snapshot
(`sessionId`, `modelId`, `reasoningEffort`, `systemMessage`, `preparedHistory`, `tools`,
`citableMessageIds`) and `h4` returns it for four minutes. The local-signals classifier sends over
it with `Jte`, which appends one user message to `preparedHistory`. `compaction-reuse-exports`
publishes `h4` and `Jte` as `globalThis.__odReuse` (the summarizer chunk imports neither).
`compaction-reuse-prefix` makes the first summarizer attempt:

- take `snapshot(sessionId)`, and use it only when its `modelId` is the compaction model and every
  message about to be summarised is in the snapshot's `citableMessageIds` (see the restriction
  below);
- build a client with the snapshot's tools and send the snapshot's system, history, model and effort
  through `Jte`, with the summarizer prompt (plus any `/compress` instructions) and one line telling
  the model to summarise the entire conversation above and call no tools as the appended message,
  and the output cap the stock path uses;
- check cancellation first: once `Jte` returns, an aborted signal throws `AbortError` before the
  content is looked at. `Jte` drops the `wasAborted` flag, and an aborted Responses-API stream can
  return partial text, which would otherwise be saved as the summary;
- then accept the reply only when it has text and no tool call. A missing snapshot, another model,
  unseen messages, an empty reply, a tool call or a thrown error each fall back to the stock `as()`
  request once, and the reuse path is never retried. An abort is never swallowed into a fallback.

`tool_choice` is not set, because it would change the request head and break the cache. Each outcome
writes one extra `cache-usage.jsonl` line with `compact` set to `reuse`, `no-snapshot`,
`other-model`, `unseen-messages`, `tool-call`, `empty` or `error`.

### The restriction: only when the reply the snapshot misses is kept

The snapshot is the last request's body, so it misses that request's reply and tool results. The
first version reused it for a manual `/compress` too, and the summary came out wrong: after three
trivia turns it listed the third question as "pending, answer not given yet" although the reply
existed (sessions `5f24a940` and `b21e5550`). Manual `/compress` (`compactCurrentSession` in
`chunk-zytfh7ht.js`, which calls `XX` in `chunk-j1ga2f9w.js`) summarises every message and keeps no
tail, so the missing reply is lost. Context-limit compaction (`VX`) summarises
`messages.slice(0, k)` and keeps `slice(k)`, so the reply survives in the tail and the summary only
needs to be right about the prefix.

`xV()` is the shared callee and only receives the messages to summarise, never the conversation, so
"is there a kept tail" is not visible to it, and testing the caller would take a patch in both
`chunk-j1ga2f9w.js` callers. What it can check exactly is the property that matters: every message
about to be summarised was in the snapshot's prompt (`citableMessageIds`). A reply the snapshot
missed is, by construction, not in that set. Manual `/compress` after an answered turn always fails
the check and logs `unseen-messages`. A compaction whose prefix stops before the unseen messages
passes. A manual `/compress` with nothing unseen (the snapshot already holds every message, for
example after an interrupted turn) also passes, and loses nothing.

### Measured

Live on `custom:droidproxy:sonnet-5-5` at low effort, the 0.233.0 patched copy:

- Manual `/compress` after three turns (session `27cbeb0b`): `compact:"unseen-messages"`, then the
  stock request, read 0, wrote 1,170.
- Automatic compaction, forced with `compactionTokenLimitPerModel` set to 26,000 and three turns
  that each read a 17KB file (session `0e8430b2`). It fired twice. The request before the first one
  had read 30,001 and written 46 (30,047 tokens); the summary request read 30,047, wrote 780 (the
  appended summarizer prompt) and logged `compact:"reuse"`. The second: prior request 38,177 read
  and 87 written, summary read 38,264, wrote 809, `reuse`. Both summaries listed only the file the
  user had just asked for as pending, and not the files already answered.
- A `/compress` after waiting past four minutes (session `b21e5550`, first version) logged
  `no-snapshot` and ran stock: read 0, wrote 1,497, full summary.

One limit remains. The summary covers the whole conversation, including the messages compaction
keeps, where stock summarises only the part it drops. And because the instruction is appended to the
final user turn, a summary can carry a stray line such as "the summary request came in the same
message"; telling the model it is a system request reduced the leak but did not remove it.
