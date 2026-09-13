# Instrumenting the binary

Sampling profilers tell you roughly where time went. Patches that make Droid report its own timings
tell you exactly. Both matter, and the instrumented build is the one that settles arguments.

The harness in `~/dev/overdroid` ships these as `bun run probe`; the patches themselves live in
`src/trace-patches.ts` and are worth re-deriving for a new release.

## The two instrumented builds

**Phase timeline.** Droid already brackets its startup in named phases (`runtime_boot`,
`settings_local`, `react_mount`) and in boundaries (`first_paint`, `input_mounted`). Two patches on
the functions that close a phase and record a boundary append a TSV row each. Read the phase object
for `phase`, `join`, `startMonoMs`, `endMonoMs`; boundaries carry only `name` and `monoMs`.

**Per-module cost.** A `bun build` bundle wraps every module in a lazy initialiser:

```js
var o=(T,R)=>()=>(T&&(R=T(T=0)),R);                              // ESM
var yT=(T,R)=>()=>(R||T((R={exports:{}}).exports,R),R.exports);  // CommonJS
```

Both are unique strings, and every module goes through them. Replace them with versions that give
each module an index, time its body, and subtract the time its nested imports charged, using a
stack. Dump the array at `input_mounted`. Also capture the first ~140 chars of the module function
as its label; the bundle has no source paths, so the body is the only way to recognise a module.

The two patches must be applied CommonJS-first: the ESM wrapper's replacement references helpers the
CommonJS replacement declares.

## Gotchas that cost real time

- **`process.pid` in every row.** Droid spawns a second Droid during startup that inherits the env
  and appends to the same file. Without a pid column the two timelines interleave and look
  impossible. Filter to the process that logged `first_paint`.
- **`FORCE_COLOR` in the parent env.** It makes Droid skip its truecolor and background-colour
  probes, so an agent shell that sets it measures a different program. Strip it.
- **A PTY that never answers.** Droid asks the terminal for its capabilities (`ESC[c`, `ESC[?u`,
  `ESC]11;?`, `ESC P$qm ESC\`). A harness that stays silent makes it wait out every timeout. Answer
  them, or you are timing your own harness.
- **Statement versus expression context.** A mark injected before a `let` continuation or inside a
  `useEffect` argument breaks the syntax. Wrap it in a comma expression: `(mark(),original)`.
  A patch that produces `error: Unexpected if` from `bun build` is this.
- **A crashed app reports a fast paint.** If the instrumented binary dies before drawing, the
  harness sees the marker never arrive, or worse, sees garbage. Sanity-check the timeline's last
  boundary before trusting any number.

## Reading the output

- Phases that all end within a millisecond of each other are waiting on one shared thing. Find the
  thing; optimising them individually wins nothing.
- A phase marked `detached` is not on the critical path to paint. Neither is any phase whose result
  is not in the render barrier's `Promise.all`.
- Self time per module already excludes nested imports, so the column sums to the real total. If the
  sum is 184ms and paint is 650ms, module evaluation is not your problem.
- **Dump every module, threshold nothing in the payload.** An early version dropped bodies at or
  below 0.2ms before the parser saw them, which reported 156 modules when there were 3817, and hid
  89ms, half the real total, in the sub-millisecond tail. Aggregate in TypeScript where it is cheap
  and testable.
- A module whose body throws must still be charged. Time it in a `try`/`finally`, or the frame it
  pushed is popped by its catching parent and the parent is charged the child's cost.

## A/B discipline

Build the candidate, then interleave it against the baseline in one process, alternating which one
launches first on every round. Machine load on a busy laptop swings paint from 0.6s to 2.7s, which
is larger than any patch being evaluated. Throw away the first round, then judge the candidate by a
paired confidence interval over 30 or more rounds, not by the gap between medians. Fixed launch
order alone makes the second binary look 39ms faster, so a result that flips when you reverse the
arguments is an artifact.
