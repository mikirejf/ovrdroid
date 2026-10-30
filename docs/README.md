# Findings

Measured findings about Droid's performance and the patches built from them. Each file covers one
question, names the Droid version it was measured on, and ends with its open items. Read only the
file for the area you are working on.

Every number here came from a probe in `src/probe/`. Where a number was wrong, the file keeps the
retraction, because how it went wrong is the reusable part.

## Checks due

Dated follow-ups. Run the check once it is due, record the result in its file, and delete the line.

- 2026-11-06 and 2026-11-13: how often Opus calls Read or Grep top level now that they are
  Script-only again ([script-mode.md](script-mode.md#open)).
- 2026-11-13: which Edit refusals are left after the 2026-10-30 file-tracker fixes
  ([stale-edits.md](stale-edits.md#open-items)).

## Areas

- [method.md](method.md): how to measure without fooling yourself. Read before any A/B, profile,
  memory reading, or probe run.
- [startup.md](startup.md): time to paint, what is CPU and what is waiting, the settings watcher
  delay, and the startup costs that turned out not to be costs.
- [zod.md](zod.md): the zod v3 schema constructor patch, its safety rules, and why upgrading zod is
  upstream work.
- [typing.md](typing.md): what a keystroke costs and the four fixes that halved it.
- [react-concurrency.md](react-concurrency.md): why `useDeferredValue` and `startTransition` made
  typing worse, and the render counter that showed it.
- [rendering.md](rendering.md): what drawing a streamed reply, a resumed session and a resize costs,
  and the render patches that cut it.
- [turn-clock.md](turn-clock.md): adding a live footer display without repaint cost.
- [idle.md](idle.md): CPU and memory of an idle session, and what limits parallel sessions.
- [exec-startup.md](exec-startup.md): the connectors catalog wait in `droid exec` startup.
- [first-message.md](first-message.md): showing the first message at once, and how MCP servers
  start.
- [subagents.md](subagents.md): what a subagent costs, and what fills the machine's memory.
- [script-mode.md](script-mode.md): which models get the Script tool, the remote list that decides,
  and the Sonnet patch.
- [menu-rescans.md](menu-rescans.md): why one new Droid makes every other Droid's slash menu rescan.
- [stale-edits.md](stale-edits.md): why Edit refused files that changed since they were read, what
  the credit patch left, and the unique-match patch.

Prompt cache and token spend:

- [token-spend.md](token-spend.md): start here. Where the quota goes, what is in place, what is
  next, and the open claims.
- [cache-lifetime.md](cache-lifetime.md): how long a cached prefix lives, and what writes and reads
  cost on the subscription meter.
- [cache-busts.md](cache-busts.md): what rewrites a cached prefix, and the fixes for the tools
  array.
- [cache-patches.md](cache-patches.md): the cache usage log, the shared GPT cache key, the cache
  warmer, and compaction reuse.
- [cache-reopens.md](cache-reopens.md): how often a reopened session reads its history from the
  cache, and the proxy's date note that broke it at midnight.
- [openai-cache.md](openai-cache.md): how GPT caching differs, and why its write field reads zero.
- [ttl-choice.md](ttl-choice.md): why choosing between 5m and 1h is closed, and the two wrong turns.
- [cache-data.md](cache-data.md): where token data lives on disk, transcript shapes, Droid's hooks,
  and the `probe ttl` schedules.

## Adding a finding

Put it in the file for its area, or start a new file when it answers a new question. Record the
Droid version, the date, the exact command and n. Lead with the result, then the evidence, then open
items. Add the file to the list above. A rule about measuring belongs in `method.md`, once.
