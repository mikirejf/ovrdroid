# Why the command menu rescans

Read this before you chase slash-menu flicker or a file watcher that wakes for no reason.

Every Droid startup re-applies mode 600 to `~/.factory/settings.json` and `~/.factory/mcp.json`. The
files are already 600, so nothing is written and the bytes never change. macOS still fires a change
event, and the watcher counts both files as relevant. So every **other** Droid already running
rescans its whole slash-command catalog. One new terminal tab disturbs every open menu.

Two things to know before you chase it:

- **An idle Droid does not loop.** Checked over 40s with the menu open: zero events, zero rescans.
  If you cannot reproduce a loop, you are missing the second Droid, not looking at a fixed bug.
- **A file whose content is unchanged can still wake every watcher.** Here mtime and content stay
  the same and only ctime moves. `probe touches` tells a real rewrite from a bare metadata touch.

`probe watch` prints the whole chain: file event, watcher wake-up, rescan, cache write. `probe menu`
counts the resulting flicker. Both take `--churn chmod` to trigger it directly, or `--churn startup`
to trigger it the way a real second terminal does.
