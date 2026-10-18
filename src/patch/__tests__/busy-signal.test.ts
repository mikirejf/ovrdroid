import { describe, expect, test } from 'bun:test';

import { busySignalPatches } from '../busy-signal-patches.ts';
import { applies } from '../rebase.ts';
import { pane } from './busy-signal-harness.ts';
import type { Agent } from './busy-signal-harness.ts';
import { describeStrayNames } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(busySignalPatches);

const HERDR = { HERDR_ENV: '1', TERM_PROGRAM: 'herdr' };
const GHOSTTY = { TERM_PROGRAM: 'ghostty' };
const BUSY = '4;3;';
const IDLE = '4;0;';
const TICK_MS = 5000;
const CLEAR_MS = 1500;

const RUNNING: Agent = { sessionId: 'a', status: 'running' };
const SECOND: Agent = { sessionId: 'b', status: 'running' };
const DONE: Agent = { sessionId: 'c', status: 'idle' };

function shown(env: Record<string, string>) {
  const view = pane(env);
  view.setWorking('main', 'idle');
  view.show('main');
  return view;
}

describe('the progress signal is switched on by the terminal', () => {
  test('Herdr turns it on', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    expect(herdr.last()).toBe(BUSY);
  });

  test('Ghostty turns it on, which the stock writer no longer does for a turn', () => {
    const ghostty = shown(GHOSTTY);
    ghostty.setWorking('main', 'streaming');
    ghostty.emit();
    expect(ghostty.last()).toBe(BUSY);
  });

  test('another terminal gets nothing and subscribes to nothing', () => {
    const other = shown({ TERM_PROGRAM: 'iTerm.app' });
    other.setWorking('main', 'streaming');
    other.setAgents('main', [RUNNING]);
    other.emit();
    expect(other.payloads()).toEqual([]);
    expect(other.subscriptions()).toBe(0);
    expect(other.timers()).toBe(0);
  });

  test('a terminal with no environment at all gets nothing', () => {
    const bare = shown({});
    bare.setWorking('main', 'streaming');
    bare.emit();
    expect(bare.payloads()).toEqual([]);
  });

  test('Herdr without a TTY gets nothing', () => {
    const piped = pane(HERDR, false);
    piped.setWorking('main', 'streaming');
    piped.show('main');
    expect(piped.payloads()).toEqual([]);
  });
});

describe('the pane is busy while the main turn runs', () => {
  test('a session that is already working when it is shown writes busy at once', () => {
    const herdr = pane(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.show('main');
    expect(herdr.payloads()).toEqual([BUSY]);
  });

  test('an idle session writes nothing when it is shown', () => {
    expect(shown(HERDR).payloads()).toEqual([]);
  });

  test('any working state that is not idle counts as busy', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'waiting_for_tool_confirmation');
    herdr.emit();
    expect(herdr.last()).toBe(BUSY);
  });

  test('busy is re-sent every five seconds', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.advance(TICK_MS * 2);
    expect(herdr.payloads()).toEqual([BUSY, BUSY, BUSY]);
  });

  test('a finished turn with no sub-agent clears it and stops the re-sending', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.setWorking('main', 'idle');
    herdr.emit();
    herdr.advance(CLEAR_MS);
    herdr.advance(TICK_MS * 2);
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
    expect(herdr.timers()).toBe(0);
  });

  test('repeated events with the same answer write nothing new', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.emit();
    herdr.emit();
    expect(herdr.payloads()).toEqual([BUSY]);
  });
});

describe('the pane stays busy while only sub-agents run', () => {
  test('a turn that ends with a sub-agent running does not clear', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.setWorking('main', 'idle');
    herdr.emit();
    herdr.advance(TICK_MS);
    expect(herdr.payloads()).toEqual([BUSY, BUSY]);
    expect(herdr.last()).toBe(BUSY);
  });

  test('sub-agents alone make it busy while the session is idle', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING, SECOND]);
    herdr.emit();
    expect(herdr.payloads()).toEqual([BUSY]);
  });

  test('a sub-agent that is not running does not', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [DONE]);
    herdr.emit();
    expect(herdr.payloads()).toEqual([]);
  });

  test('more sub-agents joining while busy write nothing new', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.setAgents('main', [RUNNING, SECOND]);
    herdr.emit();
    expect(herdr.payloads()).toEqual([BUSY]);
  });

  test('sub-agents of another session do not count', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('elsewhere', [RUNNING]);
    herdr.emit();
    expect(herdr.payloads()).toEqual([]);
  });
});

describe('the pane clears once the turn and every sub-agent are idle', () => {
  test('the last sub-agent finishing after the turn ended clears it', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING, SECOND]);
    herdr.emit();
    herdr.setAgents('main', [{ ...RUNNING, status: 'idle' }, SECOND]);
    herdr.emit();
    expect(herdr.last()).toBe(BUSY);
    herdr.setAgents('main', [
      { ...RUNNING, status: 'idle' },
      { ...SECOND, status: 'idle' },
    ]);
    herdr.emit();
    expect(herdr.payloads()).toEqual([BUSY]);
    herdr.advance(CLEAR_MS);
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
    expect(herdr.timers()).toBe(0);
  });

  test('the turn ending after the last sub-agent finished clears it', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.setAgents('main', [{ ...RUNNING, status: 'idle' }]);
    herdr.emit();
    expect(herdr.last()).toBe(BUSY);
    herdr.setWorking('main', 'idle');
    herdr.emit();
    herdr.advance(CLEAR_MS);
    expect(herdr.last()).toBe(IDLE);
  });

  test('a sub-agent starting and finishing is followed with no key pressed', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.setAgents('main', [{ ...RUNNING, status: 'idle' }]);
    herdr.emit();
    herdr.advance(CLEAR_MS);
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });
});

describe('the clear is delayed so a short idle gap never reaches the pane', () => {
  const finished = () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.setAgents('main', [{ ...RUNNING, status: 'idle' }]);
    herdr.emit();
    return herdr;
  };

  test('nothing is written at the moment busy turns false', () => {
    expect(finished().payloads()).toEqual([BUSY]);
  });

  test('the clear is written once the delay has passed, and only once', () => {
    const herdr = finished();
    herdr.advance(CLEAR_MS - 1);
    expect(herdr.payloads()).toEqual([BUSY]);
    herdr.advance(1);
    herdr.advance(TICK_MS * 3);
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });

  test('busy again inside the window cancels the clear and writes nothing', () => {
    const herdr = finished();
    herdr.advance(CLEAR_MS - 1);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.advance(CLEAR_MS * 2);
    expect(herdr.payloads()).toEqual([BUSY]);
  });

  test('the five second re-send keeps running through the pending window', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.advance(TICK_MS - 500);
    herdr.setAgents('main', [{ ...RUNNING, status: 'idle' }]);
    herdr.emit();
    herdr.advance(500);
    expect(herdr.payloads()).toEqual([BUSY, BUSY]);
    herdr.advance(CLEAR_MS);
    expect(herdr.payloads()).toEqual([BUSY, BUSY, IDLE]);
  });

  test('after a cancelled clear the next idle schedules a fresh one', () => {
    const herdr = finished();
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.setWorking('main', 'idle');
    herdr.emit();
    herdr.advance(CLEAR_MS);
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });

  test('the re-send and the delay both run while the clear is pending, and neither is left after it', () => {
    const herdr = finished();
    expect(herdr.timers()).toBe(2);
    herdr.advance(CLEAR_MS);
    expect(herdr.timers()).toBe(0);
  });
});

describe('the pane ends at idle when the session switches or the process exits', () => {
  test('switching to an idle session clears a busy one', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.setWorking('next', 'idle');
    herdr.show('next');
    herdr.advance(CLEAR_MS);
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });

  test('switching to a busy session stays busy without a clear in between', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.setWorking('next', 'streaming');
    herdr.show('next');
    expect(herdr.payloads()).toEqual([BUSY]);
  });

  test('showing the same session again recounts nothing', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.show('main');
    expect(herdr.payloads()).toEqual([]);
    herdr.emit();
    expect(herdr.payloads()).toEqual([BUSY]);
  });

  test('no session at all is idle', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.show(null);
    herdr.advance(CLEAR_MS);
    expect(herdr.last()).toBe(IDLE);
  });

  test('exiting while busy ends with a clear', () => {
    const herdr = shown(HERDR);
    herdr.setAgents('main', [RUNNING]);
    herdr.emit();
    herdr.exit();
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });

  test('exiting while a clear is pending writes the clear at once', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.setWorking('main', 'idle');
    herdr.emit();
    herdr.exit();
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });

  test('exiting after the clear was written writes nothing more', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.setWorking('main', 'idle');
    herdr.emit();
    herdr.advance(CLEAR_MS);
    herdr.exit();
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });

  test('exiting after a cancelled clear still writes the clear', () => {
    const herdr = shown(HERDR);
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.setWorking('main', 'idle');
    herdr.emit();
    herdr.setWorking('main', 'streaming');
    herdr.emit();
    herdr.exit();
    expect(herdr.payloads()).toEqual([BUSY, IDLE]);
  });
});

describe('the subscription', () => {
  test('is made once, for every event that changes a roster or a working state', () => {
    const herdr = shown(HERDR);
    herdr.show('other');
    herdr.show('main');
    expect(herdr.subscriptions()).toBe(1);
    expect(herdr.subscribedTo()).toEqual([
      'registered',
      'load_state_changed',
      'working_state_changed',
      'metadata_updated',
      'subagent_invocation_summary_updated',
    ]);
  });

  test('keeps the stock status component rendering', () => {
    const herdr = shown(HERDR);
    expect(herdr.statusBarRenders()).toEqual(['main']);
  });

  test('a throwing state manager does not break the render', () => {
    const herdr = pane(HERDR);
    herdr.setAgents(
      'main',
      Object.assign([], {
        [Symbol.iterator]: () => {
          throw new Error('roster unavailable');
        },
      }),
    );
    expect(() => herdr.show('main')).not.toThrow();
    expect(herdr.payloads()).toEqual([]);
  });
});

describe.skipIf(stockDroid === undefined)('the shipped progress signal', () => {
  const { patchedText, rebasedNamed } = shipped(busySignalPatches);

  test.each(busySignalPatches.map((patch) => [patch.name] as const))(
    '%s lands exactly once',
    (name) => {
      expect(applies(rebasedNamed(name))).toBe(true);
      expect(patchedText.split(rebasedNamed(name).replace)).toHaveLength(2);
    },
  );
});
