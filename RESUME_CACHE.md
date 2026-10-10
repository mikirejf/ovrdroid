# Reopened sessions lose their prompt cache

Handoff for whoever picks this up. Branch `resume-cache-match`. The `resume-cache/` folder named
below (spike bodies and throwaway scripts) was deleted on 2026-10-01: `probe reopens` and
`probe bodies` replace the scripts, and `move-work` lives in the dotfiles repo. Paths into it below
are history only.

## The problem

**Status: Droid's resume is correct apart from one fixed key. Read "Results (2026-10-01)" at the end
first.**

What was seen: a reopen of the long live Opus session `9503eab9`, via the move-work probe on the
same machine with the same Droid and settings, did not read the chat history from the Anthropic
prompt cache. The live session had cached that history minutes earlier. Tools, system prompt and
`messages[0]` still hit (27k); everything after missed and was written again at full price.

Why it matters: the user reopens sessions often. On a long session this re-sends ~100k tokens
uncached on every reopen. It also blocks the `move-work` script in the dotfiles repo (moves a
checkout and its live Droid sessions to another machine): a moved session is a reopened session, so
it can never keep its cache until this is fixed.

`TOKEN_OPTIMIZER.md` already lists "session resume within the TTL hits the cache" as **open**
(`probe busts --event resume`). The Results section at the end answers it: **mostly yes**.

## Goal

A reopened session's first request must send the same bytes, up to the last cache breakpoint, as the
live session's last request, so it reads the whole history from cache. Fix it as an ovrdroid patch;
also file the upstream bug with Factory ("resume must rebuild the exact request the live session
sent").

Done when: a realistic session (see Reproduce), closed and reopened within the TTL, reads ≥ ~95% of
its prompt from cache on the first reopened request, and two consecutive reopens match each other.

## Cache rules that shape every test

From the Anthropic prompt caching docs
(https://platform.claude.com/docs/en/build-with-claude/prompt-caching, read 2026-10-01):

- **Minimum cacheable prompt length.** A shorter prompt is never cached, even with `cache_control`,
  and no error is returned; both `cache_creation_input_tokens` and `cache_read_input_tokens` come
  back 0.
  - 512 tokens: Opus 5.5, Opus 5, Sonnet 5.5, Fable 5.1, Fable 5, Mythos 5.1, Mythos 5
  - 1,024 tokens: Opus 4.8, Sonnet 5, Sonnet 4.6, Sonnet 4.5
  - 2,048 tokens: Opus 4.7, Mythos Preview
  - 4,096 tokens: Opus 4.6, Opus 4.5, Haiku 4.5

  A test session must clear the minimum for its model. Droid's tools and system prompt alone are
  ~14–27k tokens, so any real Droid request does. A hand-made tiny request may not, and then a "0
  read" means nothing.

- **OpenAI** caches only prompts of at least 1,024 tokens, per its docs. That is from memory and was
  not checked here; verify it before relying on it for GPT sessions.
- **Writes happen only at breakpoints.** Each `cache_control` block writes one entry, a hash of
  everything before and including it. A read finds only entries an earlier request wrote.
- **20-block lookback.** From each breakpoint the API checks at most 20 earlier positions for an
  entry. A run of consecutive `tool_use` or `tool_result` blocks counts as one position. If a
  reopened request adds more than ~20 blocks after the live session's last write point, it misses
  even with identical history. Count the blocks between the live session's last breakpoint and the
  reopened request's breakpoint.
- **Exact match.** Any byte difference at or before the breakpoint changes the hash. Thinking or
  effort changes kill the messages cache. Opus 5.5 and Sonnet 5.5 keep earlier thinking blocks by
  default, but a thinking block the API drops changes the prefix from that point on.
- **Lifetime** runs from the _start_ of the request that wrote or read the entry. It is 5 minutes by
  default and 1h with `ttl: "1h"`. Droid puts the 1h ttl on `system[3]`, but usage showed every
  write as `ephemeral_1h`.
- **Caches are per organisation and workspace.** Both machines' proxies must use the same Claude
  account.

## What is measured so far

### 1. Real session misses on reopen (the symptom)

Session `9503eab9-2f72-47b6-b622-d3fdca415530` (Opus 5.5 via the local CLIProxyAPI at
`localhost:8317`, reasoning effort medium, ~138 messages, live and warm at the time; its own
requests read ~94k from cache per `~/.factory/ovrdroid/cache-usage.jsonl`).

It was reopened in a throwaway copy (same transcript under a temp id, same folder) via the move-work
probe (`resume-cache/scripts/mw-spike.py`, hidden subcommand `cache`): the TUI resumes, gets the
prompt `move-work cache probe`, and a local server catches the request and forwards it to the proxy.

| Probe variant                                                   | cache read |   total |
| :-------------------------------------------------------------- | ---------: | ------: |
| overlay `--settings` with only one custom model                 |          0 | 111,861 |
| overlay with the full `customModels` list                       |     27,214 | 112,849 |
| same, uncapped `max_tokens`, stream, stop after `message_start` |     27,214 | 135,071 |

Learned:

- **`--settings` overlays replace arrays.** An overlay with a single custom model changes the tool
  text (tools describe every custom model) and busts everything. Always overlay the full list.
- 27,214 = tools + system + `messages[0]` (breakpoints: `system[3]` with ttl 1h, `messages[0]`
  blocks 3 and 5, last user message's last block).
- The output cap (`max_tokens: 1`) is **not** the cause: an uncapped streamed request read the same.

### 2. Ruled out

| Suspect                      | How it was ruled out                                                                              |
| :--------------------------- | :------------------------------------------------------------------------------------------------ |
| tiny `max_tokens` / `stream` | uncapped streamed probe read the same 27,214                                                      |
| reasoning effort             | session settings and the reopened request both say `medium` (`output_config.effort`)              |
| thinking blocks              | reopened request carries the same `thinking` text and `signature` as the `.jsonl`; none are empty |
| proxy login switching        | one Claude login in `~/.cli-proxy-api/` (`claude-*.json`)                                         |
| a cut far back in history    | see 3: cut points from the last 15 minutes miss too                                               |

### 3. Cut-point test (`resume-cache/scripts/bisect-cache.py`)

The captured reopened body was truncated after user message _k_, a breakpoint was put on its last
block, and it was sent with `max_tokens: 1`.

- **Caveat that voids early cut points:** each cache entry lives 1h (5 min for the message
  breakpoints without ttl, but usage showed `ephemeral_1h`). Only cut points the live session itself
  sent within the last hour can hit, so k=1 and k=30 tell nothing.
- k = 127, 129 and 133 were each the last message of a live request a few minutes earlier. All read
  only 27,214 and wrote ~100k. **So the reopened history differs from the live one somewhere before
  message 127**, and most likely early, since even the k=1 probe first read only 14,588 (tools and
  system) before writing.
- The cache can't bisect further: older live entries have expired. The live body is needed (see Next
  steps).

### 4. Spike 1: a simple session reopens fine (`resume-cache/spike1/`)

A logging proxy (`spike1/proxy.py`) sat between Droid and CLIProxyAPI and saved every request
(`req-N.json`, headers with the key redacted) and its usage (`usage.jsonl`). Model Sonnet 5.5.

- Session A was text only: "one", "two", reopen "three", reopen "four", and later "five" after a gap
  of more than 5 minutes. The shared prefix was **byte-identical**: tools, system, messages, every
  top-level field. Reopened requests read ~24.7k of ~24.7k.
- Session B had one `Execute` tool call. Its only difference: on reopen every `tool_result` gains
  `"is_error": false`, placed before `content`. Live requests never carry it, and the `.jsonl`
  stores it. **The cache still hit (24,899 read)**, so the proxy or Anthropic seems to normalise it.
  It is still a real divergence and should be fixed in the patch.
- The live path has a partial miss of its own: `req-3` read 22,512 and wrote 2,199 for text `req-2`
  had already cached. Not investigated.
- Not covered by spike 1: thinking blocks, subagents, system reminders injected mid-session,
  mid-turn steering messages, background-task notifications, Skill activation, images, compaction.

### 5. Spike 2: recorded realistic session (RUNNING at handoff time)

A logging proxy (or `OD_BODIES`) records a live Sonnet 5.5 session (reasoning low) in
`~/.cache/resume-spike2`, which goes through:

1. reading `sub/notes.txt`, which triggers the "Additional project instructions discovered" reminder
   from `sub/AGENTS.md`;
2. editing that file outside Droid and reading it again ("modified externally" reminder);
3. a TodoWrite;
4. a steering message sent mid-turn;
5. a background Task subagent completion notification;
6. "Say ok".

The session is then reopened and the requests compared. Output: `/tmp/resume-spike2/`, with the
proxy, `proxy.log`, the overlay and the bodies. **`/tmp` is not permanent: copy what you need into
`resume-cache/spike2/`.** If its report was not appended below, rerun it from the description above.

## First hypothesis (ruled out by spike 2)

The first guess was that Droid persists the notes it injects mid-session (instructions discovered,
file modified externally, steering messages, background Task completions, todo reminders) in a
different form, so the reopen rebuilds them differently. Spike 2 exercised all of these and the
reopen matched byte for byte, apart from the harmless `is_error`. See "Where that leaves the
problem" for the leads that remain.

The scripts in `resume-cache/` are throwaway. Per `AGENTS.md` ("Every tool you build lands in this
repo"), any that earn their keep should become a `probe` subcommand in `src/probe/`. Split the part
that drives Droid from a pure reader, and cover the reader with tests. A natural pair is a
`probe resume` that records live, reopens and diffs, and a reader that compares two request bodies
with `cache_control` stripped.

## Tools you have

- **`OD_BODIES=<file>`** (`src/patch/body-patches.ts`): one JSON line per outgoing model request,
  with `sessionId` and the body. Body capture is **not** in the installed droid or the normal patch
  set. It is only in a probe build: `bun run probe build --bodies --out /tmp/droid-bodies`. Run that
  binary with `OD_BODIES=<file>` set. `bun run probe bodies` reads and diffs the recorded bodies.
  Start a live session with it set, then reopen with it set, and diff. Herdr's
  `agent start --kind droid` ignores PATH and runs the installed droid, so launch the probe binary
  directly in the herdr pane.
- `~/.factory/ovrdroid/cache-usage.jsonl`: cache read/write per request, per session.
- `bun run probe reopens` (new): finds real reopens in the logs and says which ones missed. The
  option `probe busts --event resume` never existed.
- `bun run probe grep <binary> '<literal>'` and `bun run probe extract <binary> -o <dir>` to find
  the code that rebuilds history on resume (see `.agents/skills/patching-droid-cli/SKILL.md`).
  Cached unpatched binaries: `~/.cache/ovrdroid/droid-<version>/<host>/droid`.
- `resume-cache/spike1/compare.py`: compare two request bodies with `cache_control` stripped; prints
  the first differing message.

## Reproduce

1. Make a scratch folder under `$HOME`, which Droid trusts, and `git init` it.
2. Write an overlay with the full `customModels` list. If you use a proxy, change only the chosen
   model's `baseUrl`. Set `sessionDefaultSettings.model` and `reasoningEffort` there, since `droid`
   has no `-m` flag.
3. Start the TUI through herdr with `OD_BODIES` set: `herdr workspace create --cwd X --no-focus`,
   `herdr agent start NAME --kind droid --pane P -- --settings overlay.json`, then
   `herdr agent prompt NAME "..."` and `herdr agent wait NAME --until idle`.
4. Drive it through the steps in spike 2, then close it and confirm with `pgrep -f <id>`.
5. Reopen with `--resume <id>`, the same overlay and the same env. Send one prompt.
6. Diff the last live main request against the reopened one. Ignore title side requests, which have
   a different system prompt and one message. Find the first differing message and match it to the
   `.jsonl` line it was rebuilt from.
7. Cleanup: delete the spike session files under `~/.factory/sessions`, and remove the spike prompts
   from `~/.factory/state/history.json` (see `forget_probe` in `resume-cache/scripts/move-work.py`).

Cost: Sonnet at low effort, a few cents of subscription usage per run.

## Then the patch

1. For each divergence, find which side is "wrong". The live request is what the cache holds, so the
   reopen rebuild must reproduce it exactly, including key order.
2. Find the resume/history rebuild in the extracted bundle, then patch it to match. Follow
   `AGENTS.md` and the patching skill: anchors that survive renames, `$OD` names, a test, a README
   table row, and `bun run probe builds` against the pinned version.
3. Verify with Reproduce: the reopened request is byte-identical in the shared prefix and reads ≥
   ~95% from cache. Also run one long real session if possible.
4. Update `TOKEN_OPTIMIZER.md`: the resume rows move from open to answered.
5. Draft the upstream bug report for Factory with the minimal repro and the diff.

## Related, not part of this task

`move-work` (dotfiles repo, `common/.local/bin/move-work`; a copy is in `resume-cache/scripts/`)
will stop probing the cache and only compare a setup fingerprint before a move: Droid version,
skills, droids, plugins, MCP config, custom models, global AGENTS.md, proxy key fingerprint and
Claude account. This fix is what makes a moved session actually keep its history cache.

## Spike 2 report: a realistic session reopens fine

Files are in `resume-cache/spike2/`. `bodies.jsonl` has 19 requests (body, usage and phase),
`proxy/` holds the raw requests, and `compare.py` runs as `python3 compare.py 17 18`. The session
files were deleted after the run.

Sonnet 5.5, effort low, session `fb461989-…`. Every in-conversation note from the spike 2 list was
present live and in the `.jsonl`:

- the instructions-discovered reminder (message 4);
- the modified-externally reminder (message 6);
- TodoWrite, with thinking blocks;
- the mid-turn steering message (message 19);
- the background Task completion (message 29);
- repeated "TodoWrite plan still has open items" reminders.

The proxy captured requests 1–17 live and 18–19 reopened.

- **The reopened request read the full history from cache.** Request 18 read 27,757, which is
  exactly request 17's read plus write (27,608 + 149).
- The only difference in the shared prefix is again `"is_error": false` added to all 5 `tool_result`
  blocks on reopen. The `.jsonl` stores it; the live request omits it. It is harmless in this chain.
- Everything else matched byte for byte: tools, system, thinking, effort and every message. The
  saved thinking blocks also carry `durationMs` and `signatureProvider`, but both sides drop those
  keys.
- The installed `droid` (0.228.0) is patched, but it has **no `OD_BODIES`**: body capture is not in
  the normal patch set. The spike used the proxy instead. To get body capture, build the probe
  binary with `bun run probe build --bodies --out /tmp/droid-bodies` and run it directly (see "Tools
  you have").

## Where that leaves the problem

The bug is **narrower than first thought, and may not be in Droid's resume at all.** Two controlled
sessions reopen with a full cache hit. Only one case missed: the probe of the long live Opus session
`9503eab9` (section 1). This was checked and does _not_ explain it: the live session (pid started
2026-10-01 19:53) and the probe ran the **same** droid binary.

How that probe differs from the spikes, each an untested lead:

1. **Opus 5.5 at effort medium**, against Sonnet at low.
2. **Size.** ~138 messages and ~110k tokens. Droid may prune or trim old tool output on live
   requests once the context is large, and rebuild it differently on reopen. Check
   `TOKEN_OPTIMIZER.md` and the bundle for tool-output pruning.
3. **Mid-turn at probe time.** The session was in the middle of a tool call, so the `.jsonl` ended
   in a `tool_use` with no result, and the reopen synthesised one (message 135). That should only
   touch the tail, but the reopen may sanitise more than the tail when the last turn was cut off.
4. **Content the spikes lacked:**
   - Skill activations (`delegate`, then `managing-worktrees` mid-session);
   - the mid-session "Additional skills now available" reminder (a skill installed while the session
     ran);
   - a `<system-notification>` skill invocation inside the first user message;
   - long Task, TaskOutput and FetchUrl results;
   - `is_error: true` tool results (a cancelled AskUser);
   - a user-cancelled tool call.
5. **The probe harness itself.** Section 1 used a temp copy of the session file under a new id and
   an overlay `--settings`. Spike 1 showed two reopens under different temp ids match each other,
   but nobody compared the probe's request with a **plain** `droid --resume` of the real session.

All of these leads were followed up. The real-reopen data, a recorded Opus 5.5 session and the
`is_error` fix are in Results below. Recording 3 covered lead 1 and most of lead 4 (not skill
activation) and reopened byte-identical. Not covered: lead 2 (it reached only 45k tokens) and lead 3
(it was closed while idle, not mid-turn).

## Results (2026-10-01)

### Real reopens

Data: `cache-usage.jsonl`, plus the `SessionStart` hook with matcher `resume` in the transcripts.

- 151 reopens had a gap of 1–60 minutes. 123 of them read the full history (81.5%).
- Same-session gaps without a reopen: 92.2% read the full history.
- Claude reopens under 5 minutes: 33 of 35 full. Over 5 minutes: 36 of 54.
- Since 2026-09-20, gaps of 10–48 minutes mostly hit fully.

### Proxy date note flips at local midnight

CLIProxyAPI 8.0.5 puts "Today's date is YYYY-MM-DD." as the first block of the first user message,
using `time.Now()` in the configured zone (`Europe/Ljubljana`). Source:
https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.5/internal/runtime/executor/claude_executor_cloaking.go#L1157
(`claudeCodeCurrentTime` near L1084, `injectClaudeCodeCurrentDate` at L1157, called near L1450). At
local midnight the bytes of `messages[0]` change, so everything after tools and system misses.

Recomputed 2026-10-01 from `cache-usage.jsonl`, Claude request pairs in one session with a gap of 3
to 55 minutes and a previous request of at least 40,000 tokens:

- both requests on one local day: 1,489 of 1,599 read the full history;
- the pair crosses local midnight: 1 of 13.

The same holds for a live session that sits idle across midnight, not only for a reopen. Among the
reopens, the 4 Claude ones that cross local midnight read 0 of 4 in full (75 of 91 inside one local
day). GPT is not hit: 2 of 3 GPT reopens across midnight read in full. `probe reopens` now flags the
crossing (`--time-zone`, default the system zone, Claude models only).

No proxy setting avoids it. The time-zone setting only moves midnight. The fix had to come from
CLIProxyAPI, and it has (next section).

### Upstream fix shipped in CLIProxyAPI 8.0.12

Issue https://github.com/router-for-me/CLIProxyAPI/issues/6282 was closed by commit 6d57ac90
"fix(claude): pin session date in cloaked reminder to prevent prompt cache invalidation". It shipped
in v8.0.12 (2026-10-02). PR #6283 from a contributor proposed the same idea and is still open. The
maintainer's commit is what shipped.

What it does: the first request of a session saves that day's date. Later requests of the same
session reuse it, so `messages[0]` stays byte-identical across local midnight. New sessions take the
current date. Source:
https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.12/internal/runtime/executor/helps/claude_diagnostics.go
(`PinClaudeSessionDate`).

Limits:

- The saved date lives only in the proxy's memory. A proxy restart forgets it. A Homebrew upgrade
  restarts the proxy.
- It expires one hour after the session's last request. The next request then saves the new date.
  Anthropic's cache lasts at most an hour anyway, so this costs little.

How the proxy finds the session for Droid: Droid sends no session header or body field on requests
to BYOK custom models. In the current pinned Droid release the call is
`Qo=pe?void 0:await t.platform.createProxyHeaders(...)`. For a custom model (`pe`) it skips the
helper that adds `x-session-id`. So CLIProxyAPI falls back to a hash of the first 100 characters of
the system prompt, the first user message, and the first assistant reply. Source:
https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.12/sdk/cliproxy/auth/selector.go
(`extractMessageHashIDs`). That ID changes once, between turn 1 (no reply yet) and turn 2. Then it
stays fixed for the rest of the session and across a reopen, because the history is the same.

So the pin protects live sessions idle across midnight, and reopens, from turn 2 on. One small gap:
on turn 1 every Droid session likely shares one hash (the system prompt and the first user message
start with the same boilerplate). A session started just after midnight can get yesterday's date on
turn 1 and today's on turn 2. That misses the cache once, for turn 1's small prefix.

Status here: Homebrew upgraded the proxy to cliproxyapi 8.0.20 on 2026-10-08, so the fix is live.
`probe reopens` found no midnight miss from then to 2026-10-10. The probe's "crossed midnight" cause
stays valid for proxies older than 8.0.12 and for the data recorded before the upgrade.

A possible further step, not done: an ovrdroid patch that adds `x-session-id: <Droid session id>` to
BYOK requests. That would give the proxy an exact session key and remove the turn-1 gap. CLIProxyAPI
reads `X-Session-ID` case-insensitively and does not strip it for non-Claude-Code clients. Source:
https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.12/sdk/cliproxy/session/info.go

### The 29 misses

`probe reopens` sorts them by cause, one each, midnight first: crossed midnight 4, setup changed 6,
unexplained 19.

- Crossed midnight (4): `9cfa168a` and `347cf80a` on 2026-09-24 (read 0), `0ea51e93` on 2026-09-28
  (10,296), `338c2cf4` on 2026-09-30 (9,594, 23:49 to 00:09 local). The zero reads of 2026-09-24/25
  are this, not a setup change.
- Setup changed (6): another session of the same provider started within 10 minutes and read the
  same amount (within 500 tokens) as the reopen. Four Claude reopens on 2026-09-30 that read 9,594
  (`b4ca2341`, `0e61d7b5`, `0223b60b`, `66ae2ad8`), the GPT reopen that day that read 3,584, and one
  on 2026-09-23 that read 11,819. The first three of those Claude reopens sit between 00:24 and
  00:50 local on 2026-10-01 (after midnight on both sides), and the 9,594 group overall lines up
  with the 2026-09-30 midnight flip, which is probably the cause. Why a reopen after the flip still
  misses is not shown by the data.
- Unexplained (19): cancelled turns, odd sizes, GPT, and reads of tools, system and `messages[0]`
  only.

The first hand count (28 misses, 8 setup change, 9 unclear, 11 reading only the start) was made
before `probe reopens` existed. Trust the probe's current output.

### Session 02c9bdb9

Opus 5, 2026-09-18. It missed on all three reopens. Each time, the SECOND request after the reopen
read exactly the old live prefix (previous total minus 2). So the history on disk matched. Only the
first request after the reopen differed. Without its bodies this cannot be explained.

That day ran DroidProxy, most likely v1.8.122 (released 2026-09-17), which bundled CLIProxyAPI
7.3.6. The version is inferred: it was the newest release and auto-update was on. A code audit found
no first-request-only branch in either. CLIProxyAPI's known cache bugs (#5730, #4855) were fixed
before 7.3.6. DroidProxy stripped old thinking blocks from history (its log
`/tmp/droidproxy-debug.log` shows this at 13:20 UTC), but that strip is stateless and cannot explain
request 2 going back to the old prefix. DroidProxy was replaced by Homebrew CLIProxyAPI on
2026-09-28, so this pattern no longer applies to the current setup.

### Ruled out

- Reminder-block collapse. Droid runs the same collapse live and on load. An offline replay of every
  suspect transcript gave identical histories live and on load.
- Side requests. The first request after a reopen writes the whole history.
- The proxy time zone change of 2026-10-01 22:41. The 9503eab9 miss was earlier. The date note only
  flips at local midnight. (The date note itself is a cause: see "Proxy date note flips at local
  midnight".)
- A resume-only code path. A code read found breakpoints placed the same way on every request.

### Controlled recording 3

Opus 5.5, effort medium, probe build with body capture. The session had a background subagent,
FetchUrl, failing and long Execute output, a 403, TodoWrite and a multi-step tool loop. The skill
activation did not run, because the skill was not installed in the scratch folder.

- Live last request vs reopen request 1: identical shared prefix, same breakpoint positions.
- Reopen request 1 read 44,639 of 45,274 (98.6%).
- Reopen 1 vs reopen 2: also identical.
- The files were in `/tmp/resume-rec/`. They are not permanent.

### The one proven divergence

On reopen, every `tool_result` carried `"is_error": false`. Droid's Anthropic converter emits the
key whenever the stored message has it, and only stored (reloaded) messages have `isError:false`.

Fixed by the patch `tool-result-omit-false-is-error` (`src/patch/resume-cache-patches.ts`): emit
`is_error` only when it is true. It was harmless in every test (the cache still hit). So it is a
cleanup, not the cause of the 11 misses.

### What CLIProxyAPI 8.0.5 does to Claude OAuth requests

Because of this, Droid-side captures never see the wire body. The proxy:

- builds a new top-level system (billing block and Claude Code identity), and moves Droid's system
  text into the conversation;
- adds a current-date reminder to the first user message, in the configured time zone
  (`Europe/Ljubljana`). Up to 8.0.10 it changes at local midnight and kills the cache there (fixed
  in 8.0.12);
- rewrites `metadata.user_id`;
- upgrades breakpoint TTLs to 1h, unless it classifies the request as a subagent or a probe/title
  helper (`max_tokens: 1` with no tools, or a title instruction). Those get 5 min. Main Droid
  requests get 1h.

Source:
https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.5/internal/runtime/executor/claude_executor_execute.go
(TTL rule near lines 224–247) and `internal/runtime/executor/helps/claude_diagnostics.go`
(classifiers).

The upstream body can be logged with `observability.logs.request-log: true` in
`/opt/homebrew/etc/cliproxyapi.conf`. It is off now.

### Verdict

Droid's resume rebuilds the request correctly. Nothing found blocks `move-work` on the Droid side.
Crossing local midnight is a proven cause of misses, on the proxy side and for live sessions too. It
is fixed in CLIProxyAPI 8.0.12; 8.0.20 is installed here since 2026-10-08. The remaining misses are
unexplained and need wire bodies to explain.

### Next, if the misses matter

Capture the next natural miss. Either run Droid on the body-capture probe build for daily work, or
turn on the proxy's `request-log` for a while (large logs, contains prompts). When `probe reopens`
lists a new `partial` reopen without a cause note (not midnight, not setup change), diff the last
live body and the first reopened body with `probe bodies`.

### Upstream

There is no resume bug to file with Factory beyond the `is_error` cleanup. It is minor: "resume
sends is_error:false that live omits; harmless to the cache in tests".

For CLIProxyAPI: the date note changed `messages[0]` at local midnight and dropped the cache of
every idle Claude session. This is fixed upstream in v8.0.12 (see "Upstream fix shipped in
CLIProxyAPI 8.0.12"). Nothing is left to file, and the proxy here runs 8.0.20.
