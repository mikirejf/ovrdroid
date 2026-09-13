# Droid CLI startup: what we changed, what we measured, what we ruled out

Droid 0.218.1, Bun 1.3.14, Apple silicon. Everything below is a measurement. Where a measurement
turned out to be wrong, the correction is kept next to it, because how it went wrong is the part
worth passing on.

---

## 1. Summary

We made the Droid CLI start faster by patching its compiled binary, and we rebuilt the measuring
tools after discovering the old ones were producing confident, wrong answers.

The headline change is a single fix in zod, the schema validation library. Droid builds **15,215
schema objects before the input box appears**, and each one was copying 24 functions onto itself.
Removing that copying is worth **68-79ms of CPU** and roughly **320MB of memory pressure** at
startup.

Three things are worth your attention beyond the number:

1. **Most of what we tried did nothing.** Seven of nine candidate optimisations measured as noise.
   The report includes them because the failures are cheaper to read than to repeat.
2. **Our own tools lied to us**, twice, in opposite directions. Both a false positive and a false
   negative on the same library. Section 5 covers how.
3. **The upstream fix already exists.** zod 4.6.4 solves this properly. Our patch is a bridge until
   Factory adopts it, and it retires itself safely when they do.

---

## 2. Background: what this project is

Droid ships as a single executable with ~20MB of compiled JavaScript embedded inside it. We cannot
change Factory's source, so the harness:

1. Extracts the embedded JavaScript from the binary.
2. Applies exact find-and-replace edits to it.
3. Rebuilds it with the identical toolchain version the binary was built with.
4. Writes the result back into the original binary and re-signs it.

Step 3 matters more than it looks. The binary carries a precompiled cache of its own code. Editing
the bytes in place invalidates that cache, and Droid then has to re-parse 20MB of JavaScript on
every launch, which costs far more than any patch saves. Rebuilding properly keeps the cache valid.

The rebuilt parts must also fit back into the space they came from, so patches have a size budget.

---

## 3. What we shipped

### 3.1 The zod fix

**The problem.** zod's schema constructor ran 24 `.bind()` calls on every schema object it created,
giving each schema its own private copy of every method. With 15,215 schemas built before the UI
appears, that is roughly **350,000 function copies**, all retained in memory.

**Why it was done that way.** Those copies exist so you can pull a method off a schema and call it
on its own, for example `list.map(schema.parse)`. That has to keep working.

**The fix.** Bind on first use instead of at construction. Each method name gets an accessor on the
shared prototype. The first time anything reads `schema.parse`, it binds the method, caches the
result on that instance, and returns it. A method nobody reads costs nothing. A detached method
still carries its instance, so the behaviour above is preserved.

**Results.** Measured against the real published zod packages, building 15,215 object schemas
(~91,000 zod objects), medians stable over three runs:

| Build                    |  Construct | Memory retained | Copies per schema |
| :----------------------- | ---------: | --------------: | ----------------: |
| zod 3, as Droid ships it |    110.3ms |           365MB |                29 |
| **zod 3 + our patch**    | **28.7ms** |        **44MB** |             **7** |

Measured end to end in the real binary, CPU consumed before the input box appears:

| Test                    | n   | Result                                   |
| :---------------------- | :-- | :--------------------------------------- |
| Same binary vs itself   | 12  | 7.8ms, interval spans zero, not resolved |
| Stock vs patched        | 16  | patched **67.7ms** less CPU              |
| Reversed argument order | 16  | patched **79.2ms** less CPU              |

The control correctly resolves to zero and the effect survives order reversal.

**Why the memory matters more than the instruction count.** A microbenchmark of the bind calls alone
says they cost ~9ms. The real binary shows 68-79ms. The gap is memory pressure: 350,000 retained
closures produce garbage collection and allocator work spread thinly across the whole startup,
rather than one hot spot. Only the end-to-end test sees it.

**Safety.** Before measuring anything, we verified against the compiled bundle that:

- No subclass overrides any of the 24 method names. All 36 subclasses were checked.
- Nothing anywhere in the 20MB bundle detaches a schema method. No `.map(x.parse)`, no
  destructuring.
- No schema object is ever copied or enumerated. All 172 spread operations in that region act on
  parse contexts, never on a schema.

The patched binary launches, renders, answers `/help` with identical output, and exits cleanly.
Eighteen automated tests lock the behaviour. They build a class from the exact text that gets
patched in and exercise it, so a change to the patch text that breaks the behaviour fails the suite.

**One bug worth naming.** Our first version had a real defect: reading a method off the prototype
rather than off an instance cached a broken copy, and every schema created afterwards returned
garbage. It was caught by a test written before the fix was measured, not in review. There is now a
permanent test named after it.

### 3.2 The rest of the patch set

| Patch                      | What it does                          | Why                                                                 |
| :------------------------- | :------------------------------------ | :------------------------------------------------------------------ |
| `whoami-no-block`          | Stops waiting on an identity API call | Cost 450-800ms; the data it gates already falls back to disk cache  |
| `certificate-count-skip`   | Skips a certificate count             | Spawned three shell pipelines to validate a cache with a 7-day life |
| `kitty-probe-timeout`      | 150ms terminal wait down to 30ms      | The terminal answers in a few milliseconds                          |
| `session-search-warm-skip` | Skips a search cache warm-up          | Scanned every saved session before the UI existed                   |
| `shutdown-flush-deadline`  | 1000ms exit wait down to 10ms         | Waited the full deadline for uploads that never finished in time    |

Time to first paint went from ~1.23s to ~0.68s. The zod fix is on top of that.

---

## 4. What we tried that did not work

This is the more useful half of the report. Every item below was built and measured, not reasoned
about.

| Attempt                                    | Result                     |
| :----------------------------------------- | :------------------------- |
| Deleting the entire terminal probe chain   | **No gain** (15.8ms worse) |
| Lazy-loading syntax highlighting           | Noise                      |
| Skipping a sandbox check                   | Noise                      |
| Deferring the tools module                 | Noise                      |
| Non-blocking built-in agent setup          | Noise                      |
| Raising the UI frame rate cap              | Noise                      |
| Deferring resource and terminal monitors   | Noise                      |
| Deleting the project folder discovery walk | Noise                      |
| Switching zod versions                     | Not possible from here     |

### 4.1 The terminal probes: the most instructive failure

At startup Droid asks the terminal several questions about its capabilities. Tracing showed these
running **one after another**, with the rendering path waiting on the end of the chain, totalling
around 112ms. Serial, blocking, on the critical path: a textbook find.

We replaced the entire chain with a fixed answer and measured. **It saved nothing**, and came out
15.8ms slower.

The probes overlap other startup work. Their duration was a bracket around waiting, not a cost. The
only part of this area that ever mattered was a fallback timeout that fires when no reply arrives,
which was already patched.

**The rule this produced:** a phase's duration is not its cost. Delete the work entirely and measure
before building anything. If deleting it wins nothing, no amount of optimising it can win anything.

### 4.2 Module loading: real in aggregate, untouchable in practice

Startup evaluates **3,817 modules** taking ~184ms. Nearly half of that, 89ms, is spread across 3,779
modules that individually cost less than a millisecond each. The largest single module is 9.7ms.

There is nothing to optimise here. It only improves by shipping less code, which is an upstream
decision.

### 4.3 The ceiling nobody can raise

Only about **40% of startup is CPU work**. The other 60% is waiting: keychain access, terminal
round-trips, file I/O. That caps what any CPU optimisation can achieve, and it is the single most
useful number we produced, because it tells you when to stop.

---

## 5. How our tools lied, and what we did about it

We take this section seriously because every number in the first pass was produced by tooling with
four independent defects, each capable of manufacturing a plausible wrong answer.

| Defect                                            | What it faked                                      |
| :------------------------------------------------ | :------------------------------------------------- |
| Charging stalls as time spent                     | Any paused function looked enormous                |
| Reading the wrong process's profile               | A different program blamed on each run             |
| Discarding everything under 0.2ms before counting | Module count understated **24-fold**, 156 vs 3,817 |
| Leaking our own environment into the test subject | Features silently disabled during measurement      |

The worst case: a file-read operation appeared to cost **306ms** on the strength of a single sample.
Ranked by that method, an artifact inflated 1,224x was the top cost in the entire program.

### The same library, wrong twice, in opposite directions

zod was first blamed for 124-146ms. Someone then tested that claim by stubbing out zod's schema
**conversion** function, saw no improvement, and concluded that all zod work was worthless to
optimise.

Both were wrong. The profiler had been pointing at schema **construction**, a different function
that was never tested. The negative result was real but cleared the wrong code, and the retraction
buried a genuine 68ms win for a day.

**The rule this produced:** stub the exact function the profiler named, and check its callers,
before believing a negative result.

### The machine itself

Two identical binaries, run alternately on this hardware, differ by a standard deviation of 126ms.
Under load, the same binary spans 0.6s to 2.7s. A 50ms effect is invisible to wall-clock timing
here.

We switched to measuring **CPU consumed inside the process**, sampled at the moment the UI appears.
That ignores other programs entirely and resolves effects down to about 17ms on a loaded machine.

We also alternate which binary runs first each round, because the one that ran second was appearing
39ms faster purely as an artifact, enough to flip a result's sign.

---

## 6. The zod version question

A fair challenge: zod has shipped performance work, so is upgrading the real answer?

We installed the actual packages and measured rather than guessing.

| Version                           |  Construct | Memory retained | Own properties |
| :-------------------------------- | ---------: | --------------: | -------------: |
| 3.25.76 (what Droid runs)         |    110.3ms |           365MB |             29 |
| **3.25.76 + our patch**           | **28.7ms** |        **44MB** |          **7** |
| 4.3.6 (already inside the bundle) |    241.8ms |               - |             56 |
| 4.6.4 (latest)                    |     95.4ms |           137MB |              2 |

**zod 4.6.4 fixed this exact class of problem** by moving methods onto the shared prototype, the
same insight as our patch, made upstream. Credit where due.

Three findings fall out:

1. **Newer is not automatically faster.** Version 4.3.6, which is _already bundled inside Droid_, is
   the slowest of all at 241.8ms, because it assigns 42 properties to every schema instance. The
   improvement is specific to 4.6.4.
2. **Our patch still wins**, cutting memory by 88% against 4.6.4's 62%, because the older version
   has less per-schema machinery left once the copying is removed.
3. **We cannot switch versions.** Which zod each file imports is written in Factory's source. This
   harness edits compiled output, and migrating thousands of schema definitions between two
   incompatible APIs is not a find-and-replace.

Separately: Droid bundles **three copies of zod simultaneously** (3.x, 4.0.0 and 4.3.6). The
expensive path is the 3.x compatibility layer, which builds 15,215 schemas before paint against
1,018 and 88 for the other two.

---

## 7. Recommendations

**For us, now:** keep the patch. It is measured, tested, and already in use.

It also fails safely. If Factory upgrades zod, the patch stops matching and the installer refuses to
run, naming itself in the error. It cannot silently break a binary. On that day we delete it and
lose nothing.

**For Factory, if anyone has the channel:**

1. **Upgrade to zod 4.6.4 and retire the v3 compatibility layer.** It is the fix we are
   approximating from the outside, and it would benefit every Droid user. Our numbers are available.
2. **The v3 layer appears to exist for one conversion helper** used in a single place. Worth
   checking whether it can simply be dropped.
3. **The real remaining question is not which zod, but why 15,215 schemas exist before the UI
   appears.** Building fewer of them beats making each one cheaper, and only Factory can do that.
4. **Three bundled copies of the same library** is worth a look on binary-size grounds alone.

---

## 8. Method, for anyone repeating this

1. **Quiet the machine, and record the load with every result.** Under load nothing is measurable.
2. **Establish the noise floor first**, by testing an unchanged binary against itself. That tells
   you the smallest effect you can detect, and therefore how many runs you need.
3. **Delete before you optimise.** Replace the suspect work with nothing and measure the ceiling. If
   deleting it wins nothing, stop.
4. **Stub exactly what the profiler named**, and check its callers. Do not generalise a negative
   result to a whole library.
5. **Control the environment.** Our harness was leaking its own configuration into the program under
   test, silently disabling the features being measured.
6. **Alternate the order**, and require the effect to survive reversal.
7. **Verify the thing still works**, not just that it started faster. A binary that renders and then
   dies has measured nothing.
8. **Measure what you are actually changing.** For a CPU fix on a busy machine, CPU time beats wall
   time.
