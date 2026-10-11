# The zod v3 constructor: `zod-v3-lazy-bound-methods`

Measured on Droid 0.218.1, 2026-09-13. Read this before you change the zod patch or fit it to a new
release.

## The cost

The zod v3 `ZodType` constructor runs 23 to 24 `.bind(this)` calls for every schema it builds.
Schema module bodies build their schemas at import time, so this runs before paint.

- An instrumented build counted **15,215 v3 schemas built before `input_mounted`**, the same every
  run. That is ~350,000 bound closures.
- The binds alone cost 3.2ms with the objects discarded and 8.7ms with them kept. The real binary
  paid 47 to 51ms. The gap is memory pressure from 350k retained closures (GC and allocator work),
  which only an end-to-end A/B can see.

The bundle carries three zod copies. The v3 compatibility layer builds 15,215 schemas before paint,
v4.0.0 builds 1,018 and v4.3.6 builds 88. So the v3 path is the cost.

## Measured

Deleting the bind block outright (the ceiling):

| Run                         | n   | Result                              |
| :-------------------------- | :-- | :---------------------------------- |
| base against stub           | 40  | stub faster by 51.0ms, CI 38.4-63.6 |
| stub against base (flipped) | 40  | stub faster by 47.1ms, CI 34.0-60.1 |
| base against base           | 20  | -3.3ms, CI -13.6 to 7.0             |

The shipped lazy version, measured by self CPU at `input_mounted` because the machine was at load 4:

| Run               | n   | Result                         |
| :---------------- | :-- | :----------------------------- |
| base against base | 12  | 7.8ms, CI -11.7 to 27.3        |
| base against lazy | 16  | lazy 67.7ms less, CI 50.6-84.8 |
| lazy against base | 16  | lazy 79.2ms less, CI 62.4-96.0 |

## How the patch works

The constructor binds nothing. The class installs a getter for each of the 24 method names once, on
the prototype. The first read of `schema.parse` binds the method, stores the bound copy as an own
property of that instance, and returns it. A name nobody reads costs nothing. A detached
`schema.parse` still carries its instance, so `arr.map(schema.parse)` keeps working.

Three details each fixed a real bug, and tests lock all three:

1. **`Object.hasOwn` guard.** Reading a method off the prototype must not cache a copy bound to the
   prototype. Without it, one read of `Sq.prototype.safeParseAsync` broke every later instance.
2. **The setter installs on its own receiver.** `Sub.prototype.parse = fn` must land on `Sub`, stay
   lazy, and leave the base class alone. An earlier draft rewrote the base prototype instead.
3. **No shared descriptor object.** Reusing one mutable descriptor across `defineProperty` calls
   breaks under a Proxy whose trap reads a second lazy method mid-call. The payload passes the value
   through a local. Two Proxy reentrancy tests cover it.

## Accepted difference

The accessors are not enumerable. `Object.keys(schema)` returns 2 names instead of 26, and a spread
of a schema loses its methods. Nothing in the bundle spreads or enumerates a schema: all 172 spreads
in the zod region work on parse contexts and `_def`.

## Precondition

**No subclass may declare one of the 24 names as a method.** A class method shadows the accessor and
is never bound. No subclass does today. `src/patch/__tests__/stock-source.test.ts` checks all 36
direct subclasses against the shipped bundle on every run.

## Would a newer zod fix it?

Partly, and only upstream. Measured on the published packages, 15,215 five-field object schemas:

| Version                   | Construct | Retained heap | Own props per schema |
| :------------------------ | --------: | ------------: | -------------------: |
| 3.25.76, what Droid runs  |   110.3ms |         365MB |                   29 |
| 3.25.76 with this patch   |    28.7ms |          44MB |                    7 |
| 4.3.6, also in the bundle |   241.8ms |             - |                   42 |
| 4.6.4, latest             |    95.4ms |         137MB |                    2 |

zod 4.6.4 moved the methods onto the prototype, the same idea as this patch. The patch still cuts
more heap. Which zod each module imports is decided in Factory's source, so moving the schemas to v4
is an upstream change.

## History

The first pass blamed zod for 124 to 146ms. A follow-up stubbed `zodToJsonSchema` (schema
conversion), saw nothing, and cleared all of zod. Both were wrong: the profile named the
constructor, which the stub never touched.
