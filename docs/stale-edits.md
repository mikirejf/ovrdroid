# Stale-file edit refusals

Droid 0.248.0, measured 2026-10-26.

## Result

Edit refused with "File ... has been modified externally since it was last read" about 60 times a
day across both machines until 2026-10-09. The credit patch (`file-tracker-patches.ts`, which
re-records tracked files a tool call changed) cut that to about 10 a day: 173 refusals from 10-10 to
10-26. Of the 77 refused top-level Edits in that window:

| Came after                                                            | Count |
| --------------------------------------------------------------------- | ----: |
| The agent's own shell or Script command naming the file, not credited |    36 |
| Another refused Edit to the same file in the same message             |    25 |
| The agent's own Read, Create, or successful Edit                      |    13 |
| A subagent brief naming the file                                      |     3 |

52 more refusals were Edits made inside a Script call.

`stale-edit-patches.ts` stops chasing what changed the file. When the tracker says the file changed,
Edit tests `old_str` against the current contents with stock's own matcher. If `change_all` is false
and `old_str` matches exactly once, the edit goes onto the current contents and the result tells the
model the file had changed. Otherwise Edit refuses as stock does. ApplyPatch, Create, and
`change_all` keep the stock refusal. Stock's write already refuses a file that changed after Edit
read it, so two Edits in one message cannot overwrite each other.

## Calls inside a Script

Droid 1.0.0, 2026-10-30. The credit patch checked a Script call only as a whole, so three cases
slipped through: a nested Edit re-recorded a file and a later nested Execute (a formatter, `sed`)
rewrote it in the same Script; a nested Edit came after a nested Execute that changed the file; and
a background Script, whose nested calls run after the outer call returned. `nested-tool-call-notice`
runs the same before-and-after check around each nested call, inside Droid's per-session tool queue,
and adds the credit note to the nested call's guidance, which the Script output shows under "Nested
results this Script received carried guidance for you". The whole-Script check stays as a fallback
for a nested call that throws.

Calls that run at the same time share the credit. Stock runs a message's Task, Script, MCP and Read
calls in parallel, and a Script's `Promise.all` runs nested calls in parallel, so a read-only call
could finish after a parallel writer's change and claim it. A live set of running calls marks any
call that overlapped another as shared, and its note reads "This Execute call, or a tool call that
ran at the same time, changed …". The Script tool's own call stays out of the set, since its nested
calls always run inside it.

`file-tracker-nested.test.ts` runs stock 1.0.0's nested runner unpatched and patched: stock misses
all three cases, patched credits them, and a file changed before the nested call stays flagged.
`file-tracker-overlap.test.ts` orders parallel reader and writer calls with deferred promises on
both routes. Live, on a real build with Sonnet: Read `a.ts`, one Script with `tools.Edit` then
`tools.Execute` running `sed` on another line, then an Edit. With the patch the Script output
carried "This Execute call changed files you read or wrote earlier" and the next Edit applied
cleanly; without it there was no note, and the next Edit only went through the unique-match fallback
with its "This file had changed" warning.

## Credit notes on Script results

From Oct 19 to Oct 30 the credit note wiped the result it was added to whenever that result was a
list of content blocks, which is what Script and WaitForScript return: the fold joined the list as
text, so the model saw `[object Object],[object Object]` and the note instead of the Script output.
Past transcripts hold about 2,000 such results (1,931 Script, 96 WaitForScript), around 200 a day.
The fold now keeps the blocks and adds the note as one more text block; a string result is folded as
before, and any other shape is left alone. `file-tracker-blocks.test.ts` covers it.

## Evidence

`bun run probe stale-edit <binary>` drives `droid exec` with a stub model. The model reads a file,
the probe changes the file from outside, and then the model edits it. On a build without the patch,
4 of 7 cases fail: the unique-match edit, two Edits in one message, an Edit inside Script, and a
second Edit after the first. With the patch, all 7 pass. The three refusal cases (old_str removed,
old_str duplicated, `change_all`) pass on both.

The counts come from `tool-errors/` in the delegation-study repo (`scan.py`, then
`stale-edits.py <folder> 2026-10-10`). `probe external` counts Mac refusals by cause.

## Open items

- Due 2026-11-13: run `bun run probe external --since 14` (and
  `bun run probe tool-errors --since 2026-10-30` for refusals inside Script against top level). The
  fixes for calls inside a Script, for parallel calls and for the wiped Script output were installed
  on 2026-10-30, so what is left should be edits whose `old_str` really changed. Compare with the
  10-10 to 10-26 counts above.
