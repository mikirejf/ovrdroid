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

## Evidence

`bun run probe stale-edit <binary>` drives `droid exec` with a stub model. The model reads a file,
the probe changes the file from outside, and then the model edits it. On a build without the patch,
4 of 7 cases fail: the unique-match edit, two Edits in one message, an Edit inside Script, and a
second Edit after the first. With the patch, all 7 pass. The three refusal cases (old_str removed,
old_str duplicated, `change_all`) pass on both.

The counts come from `tool-errors/` in the delegation-study repo (`scan.py`, then
`stale-edits.py <folder> 2026-10-10`). `probe external` counts Mac refusals by cause.

## Open items

- Rerun `probe external --since 14` two weeks after the patch is applied: what is left should be
  edits whose `old_str` really changed.
