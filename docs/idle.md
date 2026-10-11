# Idle sessions: CPU and memory while nobody types

Measured on Droid 0.218.2, 2026-09-14, with `probe idle`. The question is how many sessions fit on
one machine. Footprint means physical footprint, not RSS ([method.md](method.md)).

## Summary

- One idle session costs **~540ms of CPU per minute** and **~300MB** of footprint.
- The patch set already cut idle CPU by 657ms/min against stock. Most of that was the production
  React swap, which stock now ships itself.
- Idle timers and forced GC are not the cost. Both were measured as nulls.
- Memory is what limits parallel sessions, and most of it is not the Droid processes.

## Patch set against stock

45s idle windows, interleaved, n=4:

| Binary  |    Idle CPU | Footprint |
| :------ | ----------: | --------: |
| Stock   | ~1180ms/min |    ~557MB |
| Patched |  ~520ms/min |    ~555MB |

Paired: -657ms/min of CPU (CI -889 to -425) and -146MB of footprint (CI -242 to -50).

## Null: the idle timers

An idle Droid wakes 227 times a minute. Four intervals make most of it:

| Fires/min | Delay  | What it does                                          |
| --------: | :----- | :---------------------------------------------------- |
|        61 | 1000ms | TTY health poll, `isatty(0)` and `isatty(1)`          |
|        61 | 1000ms | Terminal size poll, a backup for `SIGWINCH`           |
|        61 | 1000ms | Status line poll                                      |
|        31 | 2000ms | Background task list, walks processes and stringifies |

Slowing all three 1s polls to 10s moved nothing: -17.7ms/min, n=6, CI -41.9 to +6.4. Each wake-up
does microseconds of work. `probe timers` lists them.

## Null: forced GC

A full `Bun.gc()` every 10s cost 250ms/min more (n=4, CI +76 to +423) and freed nothing that
resolved. Idle memory is live: loaded modules, the session index and JIT code. Over 5 minutes idle,
the TUI grows 2.2MB/min and the exec child 0.3MB/min. That is drift, not a leak.

## One session is five processes

| Process                         | Footprint |  Idle CPU |
| :------------------------------ | --------: | --------: |
| `droid` (TUI)                   |    ~167MB | 300ms/min |
| `droid exec` (JSON-RPC worker)  |    ~126MB | 207ms/min |
| `chrome-devtools-mcp`           |    ~129MB |  38ms/min |
| `npm exec chrome-devtools-mcp`  |     ~91MB |   0ms/min |
| watchdog (`telemetry/watchdog`) |     ~16MB |   0ms/min |

The `npm exec` wrapper does nothing after startup. Pointing the MCP config at the resolved entry
file removes one process per session and returns an identical `initialize` reply:

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

The pinned path stops following `@latest`. That is a deliberate choice. Ranked by what an idle
session holds: MCP servers first, then the exec worker, then the TUI. No binary patch reaches the
MCP servers. For the whole-machine picture, see `probe census` in [subagents.md](subagents.md).

## Open items

- The 2000ms background-task interval stringifies a process list each tick. Not yet measured.
- Idle CPU has no single owning frame yet. The top frame from `probe idle-cpu` (a 24.7ms
  `findLastIndex`) shows 1031x inflation, so it is a stall, not work.
- The exec worker's 207ms/min and ~126MB idle were never explained.
- Every idle number had one MCP server configured. A run with none would separate Droid's idle cost
  from the servers'.
