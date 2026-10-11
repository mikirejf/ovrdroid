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
