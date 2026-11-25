# When a gate check fails

Lessons from past updates, keyed by what you see. Keep this file to the rules in
[UPDATING.md](UPDATING.md#8-fold-in-what-you-learned).

Read the failed check's log under `~/.cache/ovrdroid/gate/<version>-<digest>/`. While fixing, rerun
only that probe by hand (`bun run probe <name> <binary>`); the gate itself always reruns everything.

## Is it the check or Droid?

Before touching a patch, run the failing probe on stock and on the previous release's patched
build. A check that fails on both drifted from Droid: fix the probe in `src/probe/`, with a test.

- **A probe fails on stock.** Its model of Droid drifted: a footer string Droid dropped, a new exit
  code (130 on Ctrl-C read as a crash), a wait that returned on the launch result instead of the
  completion notice, a settings `${VAR}` sent literally (expand it with `expandEnv`).
- **Upstream dropped a tool input.** Probes still sending it pass schema validation and test
  nothing. Search `src/probe/` for the input's name.
- **A stub-model probe reports that its tool call never started.** Droid rewrote the call ID. Match
  calls by tool name and input, then follow the ID Droid logged.
- **A probe waiting on Droid's log never sees its lines.** The shared log rotated mid-run. Give each
  run its own log through `FACTORY_LOG_FILE`, created before launch (`isolatedTurnLog`).
- **A cold fixture fails at random.** The input box can show before configuration loads. Wait,
  bounded, for the startup evidence the probe needs, keep a timeout failing, and keep later
  observations of expected dormancy separate so the wait cannot wake what the probe judges.
- **A probe fails only when the gate runs it beside others.** Parallel probes share the session
  store, and fixture cleanup can delete a folder another probe is reading. Skip folders that vanish,
  let other filesystem errors through, and test that interleaving.
- **A check failed once.** It is not flaky until you have compared Droid's log for the failed run
  with a passing run's. A step that never happened (a missing settings call) points at a real race,
  which stock usually shares.

## Prompt cache checks

- **A turn with a tool round-trip reports a bust.** It logs several usage lines, and only the first
  shows what was cached before the turn. Take the baseline from that one.
- **The numbers alone say the cache broke.** The provider or proxy can drop cached tokens on its
  own. Compare request bodies (`probe build --bodies`, then `probe bodies`) and judge whether the
  new request extends the old one, ignoring the `cache_control` marker that moves every turn.

## Timing checks

A timing check fails only when the build is slower than stock with confidence and by more than the
measure's floor ([docs/method.md](../../../docs/method.md)). An interval that straddles zero is a
pass: as Droid moves its own waits after paint, the paint gap shrinks toward zero.

- **`probe ab` at a few runs resolves nothing.** Stock paint has outliers several times the median;
  the gate uses `-r 24`.
- **Which patch costs the time or bytes?** Build without the suspects and rerun against stock:
  `bun run probe build -t <stock> --without <patch names> -o <out>`.
- **`probe stream` counts more bytes.** A patch that paints every frame (a footer segment) costs
  bytes, because Ink rewrites the whole live area each frame. That is the feature's price. Probes
  that must not see it start Droid in an empty, already-trusted folder outside git.

## Native Linux build proof

`probe builds` proves the patches match on Linux, not that the build compiles there. For that, copy
the source and lockfile, without credentials, to a scratch checkout on the Linux host, install
production dependencies from the lockfile with lifecycle scripts off, and rebuild checksum-verified
Linux stock on the pinned Bun. Check the ELF architecture, the marker and the version, then run
`probe highlight` (stub model only). Record the hashes of the installed binary and its backup before
and after; both must stay untouched. When using `ovrdroid update --target <scratch>` there, give it
a scratch `HOME` too, because the install writes its sound under `HOME`.

## Adding a check to the gate

A new probe joins the gate by an entry in `src/gate/checks.ts`. It must:

- cover speed, prompt cache, compaction, MCP servers, sub-agents or token cost;
- exit non-zero exactly when the behaviour is broken, decided by a pure verdict function with a
  test;
- fail when the run could not exercise the behaviour (the feature never appeared, the session never
  started);
- run on Haiku (`PROBE_MODEL`) when it spends tokens, unless the behaviour is model-specific.
