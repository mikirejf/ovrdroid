# The turn clock: adding a live display without paying for it

Measured 2026-09-14. The turn clock is the `↑7m ↓5m` in the footer: how long ago the prompt went out
and how long ago the reply landed (`turn-clock-*` patches). Read this before you add anything to the
footer that changes over time.

## Result

- Startup: no cost. Not resolved, n=14, CI -39 to +15ms.
- Typing: 89 bytes of 33,462 painted for 60 keys, 0.27%.
- Idle: one repaint per visible change, and the display format sets how often that is.

## The format is the performance decision

A changing text has to be redrawn. Only the format decides how often.

| Format      | Idle repaint cost         |
| :---------- | :------------------------ |
| `↑45s ↓43s` | 30,780 bytes per minute   |
| `↑<1m ↓<1m` | 3,120 bytes per 150s      |
| `↑14:32`    | zero after the first draw |

Pick the coarsest format that answers the question, then make the timer match it. A one-minute timer
that prints `43s` is wrong for most of the minute, so the patch prints `<1m`.

## One aligned timer, not the shared ticker

Droid has a hook over one shared 125ms interval. Subscribing is one line, but the interval then runs
at 8Hz for the rest of the session whether or not the text changed.

The patch uses a self-rescheduling `setTimeout` aligned to the next boundary that changes a digit:

```js
let $age = Date.now() - $last,
  $step = $age < 36e5 ? 6e4 : $age < 864e5 ? 36e5 : 864e5,
  $id = setTimeout(() => $re((V) => V + 1), $step - ($age % $step));
```

Aligning to the boundary, not sleeping a full step, keeps a clock idle for 40 seconds from showing
the wrong minute for another full minute.

## Read timestamps from the session, not from render

The first version stamped `Date.now()` during render, when the session status left or returned to
idle. Review rejected it: the footer unmounts while the slash-command menu is open, so a turn that
finished then was stamped when the menu closed. Resuming a busy session stamped the resume.

| Build             | Shown after closing the menu 70s later |
| :---------------- | :------------------------------------- |
| Render-stamped    | `↓<1m`, wrong by a minute              |
| Reads the session | `↓1m`                                  |

The render edge says when to look. The session says when it happened:

```js
XA().getSessionStateManager().getSessionManager(S)?.getDroidWorkingStateChangedAtMs();
```

A React render is not a clock. A timestamp taken when a component noticed something is only right
while the component stays mounted.

## Open items

- The one timer aligns to the newer of the two times, so the other can show its old minute for up to
  59s longer. A second timer would fix it and double the idle repaints.
- The cache countdown that now shares this footer is described in `README.md`.
