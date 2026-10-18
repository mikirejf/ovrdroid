import { afterEach, describe, expect, test } from 'bun:test';

import { droidsViewPatches } from '../droids-view-patches.ts';
import { applies } from '../rebase.ts';
import {
  NO_MODEL,
  patchedSnippet,
  roster,
  STOCK_CHIPS,
  STOCK_LISTENER,
  storeOf,
} from './droids-view-row-harness.ts';
import type { Roster } from './droids-view-row-harness.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(droidsViewPatches);

const OPUS = 'custom:droidproxy:opus-5-5';
const HAIKU = 'custom:droidproxy:haiku-5-5';

let open: Roster | undefined;

function fresh(): Roster {
  open = roster();
  return open;
}

afterEach(() => {
  open?.dispose();
  open = undefined;
});

describe('a row carries the model and effort of its session', () => {
  test('a loaded session reports both', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', storeOf(OPUS, 'high'));
    expect(droids.rows()).toMatchObject([
      { sessionId: 'child', workingState: 'idle', model: OPUS, reasoningEffort: 'high' },
    ]);
  });

  test('a model without an effort reports the model alone', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', storeOf(OPUS));
    expect(droids.rows()[0]?.model).toBe(OPUS);
    expect(droids.rows()[0]?.reasoningEffort).toBeUndefined();
  });

  test('a session with no model and no saved file reports neither', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', NO_MODEL);
    droids.accept('stranger');
    const [child, stranger] = droids.rows();
    expect(child?.model).toBeUndefined();
    expect(stranger?.model).toBeUndefined();
  });
});

describe('a session that is not loaded reads its saved settings', () => {
  test('the model and effort come from the settings file', () => {
    const droids = fresh();
    droids.accept('child');
    droids.writeSettings('child', JSON.stringify({ model: HAIKU, reasoningEffort: 'medium' }));
    expect(droids.rows()[0]).toMatchObject({ model: HAIKU, reasoningEffort: 'medium' });
  });

  test('a saved model without an effort reports the model alone', () => {
    const droids = fresh();
    droids.accept('child');
    droids.writeSettings('child', JSON.stringify({ model: HAIKU }));
    expect(droids.rows()[0]?.model).toBe(HAIKU);
    expect(droids.rows()[0]?.reasoningEffort).toBeUndefined();
  });

  test('a store with no model gives way to the saved file', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', NO_MODEL);
    droids.writeSettings('child', JSON.stringify({ model: HAIKU, reasoningEffort: 'low' }));
    expect(droids.rows()[0]).toMatchObject({ model: HAIKU, reasoningEffort: 'low' });
  });

  test('a loaded store wins over the saved file', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', storeOf(OPUS, 'xhigh'));
    droids.writeSettings('child', JSON.stringify({ model: HAIKU, reasoningEffort: 'low' }));
    expect(droids.rows()[0]).toMatchObject({ model: OPUS, reasoningEffort: 'xhigh' });
  });

  test('a missing file reports no model', () => {
    const droids = fresh();
    droids.accept('child');
    expect(droids.rows()[0]?.model).toBeUndefined();
  });

  test('a broken file reports no model and does not throw', () => {
    const droids = fresh();
    droids.accept('child');
    droids.writeSettings('child', '{"model": ');
    expect(droids.rows()[0]?.model).toBeUndefined();
  });

  test('a file with no model reports no model', () => {
    const droids = fresh();
    droids.accept('child');
    droids.writeSettings('child', JSON.stringify({ reasoningEffort: 'high' }));
    expect(droids.rows()[0]?.model).toBeUndefined();
  });

  test('a file that appears later is picked up, since a miss is not cached', () => {
    const droids = fresh();
    droids.accept('child');
    expect(droids.rows()[0]?.model).toBeUndefined();
    droids.writeSettings('child', JSON.stringify({ model: HAIKU }));
    expect(droids.rows()[0]?.model).toBe(HAIKU);
  });

  test('a hit is read once per session', () => {
    const droids = fresh();
    droids.accept('child');
    droids.writeSettings('child', JSON.stringify({ model: HAIKU }));
    expect(droids.rows()[0]?.model).toBe(HAIKU);
    droids.removeSettings('child');
    expect(droids.rows()[0]?.model).toBe(HAIKU);
  });
});

describe('the snapshot picks up a model or effort change', () => {
  test('an unchanged row stays the same object', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', storeOf(OPUS, 'high'));
    const [before] = droids.rows();
    expect(droids.rows()[0]).toBe(before);
  });

  test('a mid-run effort change gives a new row', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', storeOf(OPUS, 'high'));
    const [before] = droids.rows();
    droids.stores.set('child', storeOf(OPUS, 'low'));
    const [after] = droids.rows();
    expect(after).not.toBe(before);
    expect(after?.reasoningEffort).toBe('low');
  });

  test('a model change gives a new row', () => {
    const droids = fresh();
    droids.accept('child');
    droids.stores.set('child', storeOf(OPUS, 'high'));
    const [before] = droids.rows();
    droids.stores.set('child', storeOf(HAIKU, 'high'));
    expect(droids.rows()[0]).not.toBe(before);
    expect(droids.rows()[0]?.model).toBe(HAIKU);
  });
});

interface Publisher {
  adoptChild: (id: string) => boolean;
  refresh: (id: string) => boolean;
  records: Map<string, null>;
  schedulePublish: (now: boolean) => null;
}

type Listener = (event: string, payload: { sessionId: string }) => null;

const listenerOf = payloadFunction<[], Listener>(
  [],
  `return function(...a){return (${patchedSnippet(STOCK_LISTENER, 'droids-view-publishes-model-change')}).apply(this,a)}`,
)();

function publishes(
  event: string,
  { adopts = false, refreshes = false, known = true } = {},
): boolean[] {
  const calls: boolean[] = [];
  const self: Publisher = {
    adoptChild: () => adopts,
    refresh: () => refreshes,
    records: new Map(known ? [['child', null]] : []),
    schedulePublish: (now) => {
      calls.push(now);
      return null;
    },
  };
  listenerOf.call(self, event, { sessionId: 'child' });
  return calls;
}

describe('the droids view publishes when settings change', () => {
  test('a settings update on a listed session publishes at once', () => {
    expect(publishes('settings_updated')).toEqual([true]);
  });

  test('a settings update on a session the view does not list stays quiet', () => {
    expect(publishes('settings_updated', { known: false })).toEqual([]);
  });

  test('other events with no row change stay quiet', () => {
    expect(publishes('metadata_updated')).toEqual([]);
    expect(publishes('working_state_changed')).toEqual([]);
  });

  test('a row change still publishes on any event', () => {
    expect(publishes('metadata_updated', { refreshes: true })).toEqual([true]);
    expect(publishes('registered', { adopts: true })).toEqual([true]);
  });
});

interface ChipInput {
  lead?: boolean;
  droid: { model?: string; reasoningEffort?: string };
  onScreen?: boolean;
}

interface ChipScope {
  L: boolean;
  Z: ChipInput['droid'] & { mission?: { kind: string } };
  u: () => { t: (key: string) => string };
  U: boolean;
  Re: (id: string) => { shortDisplayName?: string | undefined };
  ai: (effort: string) => string;
}

const SHORT_NAMES = new Map([
  [OPUS, 'Opus 5.5'],
  [HAIKU, 'Haiku 5.5'],
]);

const EFFORTS = new Map([
  ['high', 'High'],
  ['xhigh', 'Extra High'],
]);

const chipsOf = payloadFunction<[ChipScope], string[]>(
  ['scope'],
  `const{L,Z,u,U,Re,ai}=scope;let ${patchedSnippet(STOCK_CHIPS, 'droids-view-row-model-chip')};return me`,
);

function chips({ lead = false, droid, onScreen = false }: ChipInput): string[] {
  return chipsOf({
    L: lead,
    Z: { ...droid, mission: { kind: lead ? 'orchestrator' : 'worker' } },
    u: () => ({ t: (key) => key.replace('common:droidsView.', '') }),
    U: onScreen,
    Re: (id) => ({ shortDisplayName: SHORT_NAMES.get(id) }),
    ai: (effort) => EFFORTS.get(effort) ?? effort,
  });
}

describe('the row shows a model chip', () => {
  test('a model with an effort reads like the model picker', () => {
    expect(chips({ droid: { model: OPUS, reasoningEffort: 'high' } })).toEqual(['Opus 5.5 (High)']);
  });

  test('the effort label follows the app wording', () => {
    expect(chips({ droid: { model: HAIKU, reasoningEffort: 'xhigh' } })).toEqual([
      'Haiku 5.5 (Extra High)',
    ]);
  });

  test('a model without an effort shows the model alone', () => {
    expect(chips({ droid: { model: OPUS } })).toEqual(['Opus 5.5']);
  });

  test('a row with no model shows no chip, even with an effort', () => {
    expect(chips({ droid: {} })).toEqual([]);
    expect(chips({ droid: { reasoningEffort: 'high' } })).toEqual([]);
  });

  test('an unnamed model shows its id', () => {
    expect(chips({ droid: { model: 'mystery', reasoningEffort: 'high' } })).toEqual([
      'mystery (High)',
    ]);
  });

  test('it sits between the mission lead and the on-screen chips', () => {
    expect(chips({ lead: true, onScreen: true, droid: { model: OPUS } })).toEqual([
      'missionLead',
      'Opus 5.5',
      'onScreen',
    ]);
  });
});

describe.skipIf(stockDroid === undefined)('the shipped droids view', () => {
  const { patchedText, rebasedNamed } = shipped(droidsViewPatches);

  test.each(droidsViewPatches.map((patch) => [patch.name] as const))(
    '%s lands exactly once',
    (name) => {
      expect(applies(rebasedNamed(name))).toBe(true);
      expect(patchedText.split(rebasedNamed(name).replace)).toHaveLength(2);
    },
  );
});
