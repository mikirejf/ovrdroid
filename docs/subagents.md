# Subagents and machine memory

Measured on Droid 0.238.0, 2026-10-10 and 2026-10-11. The question: what does a subagent cost, and
would running each one as its own process be lighter? Load average was 40 to 200 on 10 cores, so CPU
numbers are noisy and n is small. Memory numbers are steadier.

## Summary

- Subagents run **inside the parent TUI process**, because the `shared_process_agents` flag is on
  for this account (cached in `~/.factory/cache/feature-flags.json`).
- Separate processes are heavier. A patch that forced them was built, measured and dropped.
- The parent keeps a higher footprint after subagents end, but it is not a leak.
- What fills the machine is orphaned dev servers, not subagents.

## How subagents run

`Sc()` picks the host. With `SharedProcessAgents` on, the in-process host builds a fresh runtime
scope per subagent with 44 services (settings, the MCP hub, skills, the droids catalog, the tool
registry, the session services) and tears it down when the subagent ends. With the flag off, each
subagent would be a `droid exec --input-format stream-jsonrpc` child.

All in-process subagents share the parent's JS thread, so the parent's event loop is where their
cost adds up.

There is no cap at 10 here. The code has `max_active_task_subagents_per_daemon:10` and
`max_active_descendants_per_root:5`, but only when `nested_task_delegation` is on, and it is off.
The only active limit is the in-process host's 50.

The `nesting-*` patches turn nested delegation on and read three limits from the top-level
`nestedTaskDelegation` object in `~/.factory/settings.json`:

- `maxDepth`: the deepest level any subagent may sit at. 1 to 3, default 2. Anything else falls back
  to 2. The binary caps it at 3.
- `maxActiveDescendantsPerRoot`: default 25.
- `maxActiveTaskSubagentsPerDaemon`: default 100.

A droid's own `maxDepth` (default 1) can stop its subagents earlier, but never lets them go deeper
than this ceiling.

## In-process is lighter

Sleeping subagents, peak footprint of the whole process tree:

| Subagents | Host       | Peak tree footprint | CPU                    |
| --------: | :--------- | ------------------: | :--------------------- |
|        10 | in-process |              +308MB | 9.9 cpu-seconds        |
|        10 | processes  |              +930MB | 13.7 cpu-seconds       |
|         4 | in-process |      +112 to +228MB | 5.2 to 5.8 cpu-seconds |
|         4 | processes  |             ~+700MB | 8.6 to 9.7 cpu-seconds |

Each child process pays for its own runtime. Stock already picks the lighter host, so the
`subagent-process-host` patch was dropped.

## Working subagents load the parent lightly

Each subagent reads 4 files and writes a summary:

| Subagents | Parent CPU while running | Event loop busy |  Worst stall |
| --------: | -----------------------: | --------------: | -----------: |
|         4 |   11.4 to 12.8 cpu-s/min |     2.5 to 6.4% | 154 to 263ms |
|        10 |   11.0 to 13.0 cpu-s/min |        4 to 10% | 244 to 799ms |

With 10 subagents the parent averaged 0.13 cores. The busiest 5 seconds were the spawn burst at 0.80
to 0.85 cores. Each spawn also adds a ~30 to 80MB spike.

## Shipped: the task store patches

`~/.factory/state/task-invocations.json` is shared by every Droid. Stock never prunes it and
rewrites it synchronously several times per subagent. Each rewrite:

1. Takes a lock, then reads and parses the file.
2. Validates it.
3. Pretty-prints it.
4. Writes a temp file, copies the old one to `.bak`, and renames.

At 2.8MB and 2,580 entries one rewrite took ~83ms on the parent's thread. At 0.44MB compact it took
~2ms.

- `task-store-prunes-old-invocations` drops entries older than 48h that are not pending or running.
- `task-store-writes-compact-json` writes without indentation.

Two losses: `TaskOutput` on a task older than 48h returns "not found", and undelivered background
completions older than 48h are not replayed. With the store already small, an A/B showed no CPU or
lag difference (n=2 per arm). The patches keep the store from growing back. They are not a measured
speed-up.

## Shipped: nested subagents in the TUI

Measured on 0.238.0 with a level 1 droid that launches a level 2 droid running four `sleep 8` calls.

The TUI already holds a grandchild's messages. A `child_session_available` notification arrives on
the child's session, and `handleChildSessionAvailable` registers and hydrates the grandchild the
same way it does a direct child. The task ledger (`lp`, `hn`, `Ol`) is a file every Droid reads, so
it knows the grandchild too. Stock just never drew it: the Task row looks the child up under the
current session, `cE` drops the tool use id, and the Task box is clamped to `height:2`.

`nested-subagent-ui-patches.ts`:

- The child's latest Task step reads `↳ <type> "<description>"`, with one more line under it that
  carries the grandchild's latest step, then `Done (N tool uses · Xs)`. It nests down to level 3.
- The Task box grows from 2 rows to at most 4 (`minHeight:2,maxHeight:4`). Without that the nested
  line renders but stays hidden. A long header that wraps now shows its second line, where stock
  clipped it.
- The detailed view (Ctrl+O) reads the child's steps live from the session store. Stock read the
  tool's progress updates, which stayed empty for a foreground Task, so stock showed
  `Initializing...` for the whole run. A Task step there lists the grandchild's steps 4 columns in.
- `N background agents running` counts every running descendant once. It walks the sessions and the
  ledger breadth first from the current session, and a visited set stops a lineage cycle. It read 2
  while the grandchild ran, 1 after it ended, then went away.

The `(N) sub-agents running` panel above the footer lists running sessions from the session store.
Stock listed direct children only, so a foreground child that had launched a grandchild read `(1)`.
It now walks the descendants depth first, so the same run read `(2)`. When opened with ↓, each
nested row sits 2 spaces under its running parent, and Enter opens its details as it does for a
direct child. A running child under a finished parent moves up a level. The panel ignores `Task`
tool executions, as stock does, because each Task already appears as its child session.

## Shipped: running agents follow a rewind

Measured on 0.240.0 with `probe rewind`, which holds two background agents in a stub model while it
rewinds past the second one's turn.

A rewind forks the chat into a new session. Stock left every running background agent with the old
session. The new chat's footer showed no running agent, `TaskOutput` said `No task found`, and the
completion notice and token count went to the old session, which nobody had open any more. Droid
runs the TUI, its sessions and their subagents in one process, so no part of it held a stale id: the
task store (`~/.factory/state/task-invocations.json`) still named the old session as the parent.

`rewind-patches.ts` hands the agents over in `handleExecuteRewind`, the one place every rewind runs:

1. It moves the store records whose agent still runs in the background and whose Task call the new
   transcript kept. A call the rewind cut away stays with the old session.
2. It tracks the child again under the new session, so the completion notice goes there.
3. It points the child's `subagent` tag at the new session through `updateSessionSettings`. The
   child's `session_start` line keeps the old id. Droid reads the parent from the store first, and
   the store keeps a record for 48 hours after the task ends.

The TUI drops the child's session state when it switches to the new chat. So `TaskOutput` now loads
a running background child of its own session when it finds no state for it. Stock had the same gap
after any resume while a child ran.

Patched, the probe saw: footer `1 background agent running`, `TaskOutput` answered
`Status: running`, the notice and the token count landed in the new chat, and the cut agent stayed
with the old chat. Stock failed the first three.

## Null: the memory left after subagents

After 6 subagents ended, the parent's footprint stayed ~80 to 170MB higher. A heap snapshot (which
forces GC) showed live JS heap went from 130.0MB to 131.4MB. The rest is the allocator's high-water
mark and JIT code, which the OS gets back slowly. The only new live strings are prompt copies,
~250KB in total.

## The probes

All live in `src/probe/`:

- `probe build --heap` adds `OD_HEAP` rows and a heap snapshot on `SIGUSR1` (`SIGUSR2` belongs to
  `signal-exit`).
- `probe build --lag` adds `OD_LAG`, a 50ms timer that logs stalls, at ~0.12% of a core.
- `probe sample <pid>` samples CPU and footprint of a running process.
- `probe subagents <binary> --count --work sleep|read --heap --lag` runs N subagents and records the
  cost. `probe subagents-read <dir>` turns the output into the tables above.
- `probe heapdiff <a> <b>` compares two heap snapshots.
- `probe census` lists every process by footprint and finds orphans.
- `probe rewind <binary>` rewinds while background agents run and says which chat each one belongs
  to afterwards. It needs a folder Droid already trusts (`--cwd`, default the current one).

## What fills the machine

One `probe census` on the 64GB Mac found 83.4GB of footprint:

| Group                                | Count | Footprint |
| :----------------------------------- | ----: | --------: |
| `droid` processes (0.52 cores total) |    34 |    11.6GB |
| `node` processes                     |   151 |    16.5GB |
| Orphaned dev processes, parent gone  |   112 |    10.2GB |
| OrbStack                             |     - |      14GB |
| VS Code plugin hosts                 |     - |     8.5GB |

The orphans were Convex local backends, Next.js dev servers alive 1.5 days, and a 16-day-old
trigger.dev server. They outlive the session that started them, because Convex and Next start
detached grandchildren that the Execute tool's process-group kill does not reach. `kill-leftovers`
in the dotfiles repo now kills them every 15 minutes. On 2026-10-11 `probe census` found 71MB of
orphans left, none of them dev servers.

## Open items

- A fix in how Droid tracks background processes would stop orphans at the source.
- Each spawn builds 44 services from disk on the parent's thread. Sharing read-only catalogs across
  subagents could cut the spawn burst. Not tried.
- The `--timers`, `--trace` and `--modules` probe patches anchor on `// @bun @bytecode`, which now
  matches 671 modules. They need new anchors.
