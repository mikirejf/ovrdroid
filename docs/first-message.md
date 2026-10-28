# The first message and MCP server start

Measured on Droid 0.219 to 0.235, mostly in fightsignal (9 MCP servers). Read this before you touch
the first-message patches, session creation, or how MCP servers start.

## The problem

In a new session the first message, slash-command skills included, did not appear until the
`droid exec` worker had started every MCP server. With `blockOnMcpLoad: true`, the worker's
`mcp_init` blocks its ready signal, and the TUI awaits session creation before it shows the message.
Across 246 worker starts in the logs, ready took p50 1.8s, p90 8.5s, max 17.8s. The turn gate was
not the cause: all 173 logged gates were under 0.5s.

## Shipped: `first-message-shows-at-once`

The session id is created early and already has a session manager. Stock's send keeps an optimistic
message handle, `{remove, isConfirmed}`, and the patch plugs into it. When there is no session yet,
the placement is end_of_turn and the current session's manager is idle, the patch adds the message
to that manager at once and sets "Thinking...". It sets the handle so `remove` also stops the
spinner. Stock's own paths then undo it: a failed session creation or a failed send calls stock's
withdraw function, which calls `remove`. If the session that arrives is a different one, the patch
withdraws and lets stock add the message on the right manager. The message goes to the daemon with
the same request id, so the daemon treats it as the running turn, not a queued one.

Stopping before the session exists needs no patch of ours. On 0.251.0 stock's stop withdraws every
pending submission and posts "request cancelled by user", and the send returns
"rejected_with_notice", so nothing reaches the daemon. `first-message-cancel-before-session` and the
`$ODr`/`$ODc` flags it kept on the manager were deleted, and so was
`first-message-shows-at-once-undo`. Esc itself never triggers that stop: `escape-keeps-turn-running`
swallows Esc while a turn runs or a submission is pending, as it has since it shipped.

`src/patch/__tests__/first-message-patches.test.ts` covers: show and Thinking before the session
exists, a stop withdrawing it with nothing sent, a different session coming back, a failed session
creation, a failed send, and a busy or non end-of-turn message left to stock.

`bun run probe first-send <binary> --cwd <project>` measures it. The probe pastes the message in one
write and times from Enter. On 0.227.0 in fightsignal, `--after-clear`: stock shows the message
after 1.4 to 2.3s, patched after 0.1 to 0.2s. The reply time does not change. The probe keys on
"(Press ESC to stop)", because the spinner text changes between releases. That measurement predates
the handle rewrite and has not been repeated on 0.251.0.

## Shipped: `mcp-servers-start-together`

Stock connected remote HTTP and SSE servers one by one, then started stdio servers in parallel. The
patch starts all of them in one `Promise.all`. Each server keeps its own try/catch, so one failure
cannot stop the others. Parallel OAuth flows do not collide: the callback server keys them by state.

`droid exec --list-tools`, 8 alternating pairs: `mcp_init` median 3.9s against 5.1s, faster in all 8
pairs, all 377 tools loaded every run.

## Shipped: `session-worker-starts-mcp-in-background`

With `blockOnMcpLoad` on, the TUI's worker waited for MCP twice: at boot, before it answered
`initialize_session`, and again before every agent turn. The patch sends the JSON-RPC worker down
the background branch at boot, so the session exists at once and the per-turn gate does the only
wait. Logs show `Session initialized` before `mcp_init` completes.

The exemption covers `blockOnMcpLoad` only. The first version skipped the whole condition, so
`--only-tools MCP:<server>` validated before any MCP tool existed and exited 1. It now exits 0, as
stock does.

It does not replace the TUI patches. Without each one, measured:

- without `first-message-shows-at-once`, the message showed after 1.4 to 2.3s instead of ~0.3s;
- without `new-session-loads-in-background`, `/clear` took 1.2 to 1.4s instead of ~30ms;
- without `session-load-keeps-pending-settings`, an effort change right after `/clear` was lost.

What it adds is overlap. `probe first-send --at-paint`, 12 pairs: reply median 7.5s against 8.9s,
faster in 8 of 12.

## Why the per-turn MCP gate keeps its 60s cap

With the boot wait gone, the per-turn gate is all that keeps late MCP tools out of turn two. Late
tools grow the tools array and bust the whole prompt cache. The old `mcp-gate-timeout-15s` patch was
dropped: logs show `mcp_init` up to 36s and 13 of 447 starts over 15s, so it would bust the cache on
~3% of starts. `blockOnMcpLoad: false` is not an option for the same reason.

## Stock's tool-list cache does not replace `mcp-idle`

Since 0.235.0 stock saves each MCP server's tool list under `~/.factory/cache/mcp/catalogs/`. Both
caches stay, because stock:

- saves only for a logged-in user;
- keys a stdio server's list by the working directory too, so the first session in a new folder or
  worktree finds nothing and starts every stdio server at launch.

The `mcp-idle` file is keyed by name and config only, so one list serves every folder. On the day
0.235.0 was installed, stock held 1 list and `mcp-idle` held 4.

## Project MCP servers: `npx` is most of the stdio cost

Per-server start, p50: trigger (npx) 3.2s, db-local (npx) 2.2s, vercel (remote) 2.1s, the rest under
0.5s. `npx` resolves the package against the registry every start, and `--prefer-offline` does not
help. Running the package's entry file with `node` from the project's `node_modules` cuts trigger to
~0.45s and postgres to ~0.05s.

A shared project file cannot name a machine path, stdio servers start in the session cwd, and args
are not env-expanded. The portable form costs ~20ms:

```sh
sh -c 'exec node "$(git rev-parse --show-toplevel)/<path>" "$@"'
```

fightsignal rewritten this way: `mcp_init` went from 6.3 to 9.7s down to 4.3 to 7.8s. The rest of
the spread is the remote servers.

`ovrdroid doctor` checks only the user `~/.factory/mcp.json`. A project scan with an automatic fix
was built and shelved (git stash "doctor: scan and --fix project .factory/mcp.json"), because a hand
edit per repo is two lines.

## Open items

- Per-server start times reach the log only when the TUI flushes metrics, and `exec --list-tools`
  never writes them. There is no per-run per-server number yet.
