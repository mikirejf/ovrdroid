import { describe, expect, test } from 'bun:test';

import { patches } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { payloadFunction } from './payload.ts';
import {
  CALLBACK_STOCK,
  completionHarness,
  patched,
  REGISTRY_STOCK,
  registry,
  WAIT_SOUND,
} from './sound-harness.ts';

const TRIGGER_STOCK =
  'v(()=>{if(!Bn)return;return P().subscribeToSessionNotifications(Bn,(ke)=>{if(ke.type==="agent_turn_completed"&&ke.reason!=="cancelled")oee()})},[Bn]);';

const RUNNING_COUNT_STOCK =
  'function Q0e(y){let E=P().getSessionStateManager(),A=()=>y?IZ(E,y):0,D=A();return D}';

const trigger = patched(TRIGGER_STOCK, 'turn-end-reports-running-subagents');

interface Notification {
  type: string;
  reason?: string;
}

type Listener = (note: Notification) => null;

interface StateManager {
  name: string;
}

interface Sessions {
  getSessionStateManager: () => StateManager;
  subscribeToSessionNotifications: (id: string, next: Listener) => Cleanup;
}

type CountRunning = (manager: StateManager, id: string) => number;

type Cleanup = () => null;

function runEffect(effect: () => Cleanup): null {
  effect();
  return null;
}

interface TriggerHarness {
  fire: (note: Notification) => null;
  calls: boolean[];
}

const SESSION = 'session-1';

function triggerHarness(running: number): TriggerHarness {
  const calls: boolean[] = [];
  let listener: Listener | undefined;
  const manager: StateManager = { name: 'state manager' };
  const sessions: Sessions = {
    getSessionStateManager: () => manager,
    subscribeToSessionNotifications: (_id, next) => {
      listener = next;
      return () => null;
    },
  };
  const countRunning: CountRunning = (given, id) => {
    expect(given).toBe(manager);
    expect(id).toBe(SESSION);
    return running;
  };
  const report = (busy: boolean): null => {
    calls.push(busy);
    return null;
  };
  payloadFunction<[typeof runEffect, () => Sessions, CountRunning, typeof report, string], null>(
    ['v', 'P', 'IZ', 'oee', 'Bn'],
    trigger,
  )(runEffect, () => sessions, countRunning, report, SESSION);
  return {
    fire: (note) => {
      listener?.(note);
      return null;
    },
    calls,
  };
}

describe('the completion callback chooses the sound', () => {
  test('without a running subagent it plays the completion sound', () => {
    const { finish, played } = completionHarness({ completionSound: 'fx-ok01' });
    finish(false);
    expect(played).toEqual([{ sound: 'fx-ok01', focus: 'always' }]);
  });

  test('a call with no argument still plays the completion sound', () => {
    const { finish, played } = completionHarness({ completionSound: 'fx-ok01' });
    finish();
    expect(played).toEqual([{ sound: 'fx-ok01', focus: 'always' }]);
  });

  test('with a running subagent it plays the wait sound from the sounds folder', () => {
    const { finish, played } = completionHarness({ completionSound: 'fx-ok01' });
    finish(true);
    expect(played).toEqual([{ sound: WAIT_SOUND, focus: 'always' }]);
  });

  test('the bell setting gives way to the wait sound too', () => {
    const { finish, played } = completionHarness({ completionSound: 'bell' });
    finish(true);
    expect(played).toEqual([{ sound: WAIT_SOUND, focus: 'always' }]);
  });

  test('a muted user stays muted either way', () => {
    const { finish, played } = completionHarness({ completionSound: 'off' });
    finish(true);
    finish(false);
    expect(played).toEqual([]);
  });
});

describe('the turn-end trigger reports whether subagents run', () => {
  test('a finished turn with running subagents passes true', () => {
    const { fire, calls } = triggerHarness(2);
    fire({ type: 'agent_turn_completed' });
    expect(calls).toEqual([true]);
  });

  test('a finished turn with no subagents passes false', () => {
    const { fire, calls } = triggerHarness(0);
    fire({ type: 'agent_turn_completed' });
    expect(calls).toEqual([false]);
  });

  test('a cancelled turn and other notifications stay silent', () => {
    const { fire, calls } = triggerHarness(2);
    fire({ type: 'agent_turn_completed', reason: 'cancelled' });
    fire({ type: 'metadata_updated' });
    expect(calls).toEqual([]);
  });
});

describe('the registry forwards its argument', () => {
  test('the registered callback receives what oee is given', () => {
    const seen: boolean[] = [];
    const record = (value: boolean): null => {
      seen.push(value);
      return null;
    };
    const { forward } = payloadFunction<[typeof record], { forward: (value: boolean) => null }>(
      ['record'],
      `${registry};aee((value)=>record(value));return{forward:oee}`,
    )(record);
    forward(true);
    forward(false);
    expect(seen).toEqual([true, false]);
  });
});

interface Names {
  count: string;
  session: string;
  state: string;
  fire: string;
}

function chunks({ count, session, state, fire }: Names): string[] {
  return [
    REGISTRY_STOCK.replaceAll('oee', fire),
    CALLBACK_STOCK,
    [
      TRIGGER_STOCK.replaceAll('Bn', session)
        .replaceAll('oee', fire)
        .replaceAll('P()', `${state}()`),
      RUNNING_COUNT_STOCK.replaceAll('IZ', count).replaceAll('P()', `${state}()`),
    ].join(''),
  ];
}

describe('the patches fit a build with other minified names', () => {
  const NAMESETS: Names[] = [
    { count: 'IZ', session: 'Bn', state: 'P', fire: 'oee' },
    { count: 'Qx', session: 'Wq', state: 'Rj', fire: 'mmk' },
  ];

  const subset = patches.filter((patch) => patch.name.startsWith('turn-end-'));

  test.each(NAMESETS)('rebases onto %o', (names) => {
    const rebases = rebaseAll(subset, chunks(names));
    expect(rebases.map((rebase) => [rebase.name, applies(rebase)])).toEqual(
      subset.map((patch) => [patch.name, true]),
    );
  });

  test('the renamed trigger calls the renamed counter', () => {
    const rebase = rebaseAll(
      subset,
      chunks({ count: 'Qx', session: 'Wq', state: 'Rj', fire: 'mmk' }),
    ).find((entry) => entry.name === 'turn-end-reports-running-subagents');
    expect(rebase?.replace).toContain('mmk(Qx(Rj().getSessionStateManager(),Wq)>0)');
  });
});
