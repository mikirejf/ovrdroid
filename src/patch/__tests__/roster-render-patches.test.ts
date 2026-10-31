import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { rosterRenderPatches } from '../roster-render-patches.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { describeStrayNames, rebasedNamed } from './payload.ts';
import type { Helpers, Model, Roster, View } from './roster-render-harness.ts';
import {
  controllerArgs,
  helpers,
  mount,
  rosterClass,
  rosterModel,
  statusLine,
} from './roster-render-harness.ts';

const SLOW_PATCH_MS = 120_000;

const rebases = rebaseAll(
  rosterRenderPatches,
  (STOCK ?? []).map((module) => module.text),
);

describeStrayNames(rosterRenderPatches);

describe('every companion is named after the split, so --without removes the whole set', () => {
  test.each(rosterRenderPatches.map((patch) => [patch.name] as const))('%s', (name) => {
    expect(name.startsWith('roster-render-split')).toBe(true);
  });
});

describe.skipIf(STOCK === undefined)(
  'every roster render patch applies to the shipped bundle once',
  () => {
    test.each(rosterRenderPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebasedNamed(rebases, name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test(
      'the set ships and applies on top of every other shipped patch',
      () => {
        const shipped = new Set(patches.map((patch) => patch.name));
        expect(rosterRenderPatches.every((patch) => shipped.has(patch.name))).toBe(true);
        const text = patchSource(sourceApp(), patches)
          .map((module) => module.text)
          .join('\n');
        for (const owned of [
          '$ODrosterStore',
          '$ODrosterLive',
          '$ODRosterLine',
          '$ODrl.getSnapshot()',
        ]) {
          expect(text).toContain(owned);
        }
      },
      SLOW_PATCH_MS,
    );
  },
);

interface Root {
  view: View<string | null, Model | null>;
  store: () => Roster;
}

function root(lib: Helpers, sessionId: string | null): Root {
  let store: Roster | undefined;
  const view = mount((id: string | null) => {
    store = lib.$ODrosterStore(id);
    return store.getSnapshot();
  }, sessionId);
  return {
    view,
    store: () => {
      if (store === undefined) {
        throw new Error('the root never rendered');
      }
      return store;
    },
  };
}

function factsOf(store: Roster): object | null | undefined {
  return store.$ODfactsOf?.();
}

function start(): Map<string, Model> {
  return new Map([['s1', rosterModel()]]);
}

describe('the root follows only the roster facts it draws', () => {
  test('a new preview text or activity time keeps the root snapshot and does not render the root', () => {
    const { view, store } = root(helpers(rosterClass(start())), 's1');
    const facts = factsOf(store());
    store().publish(rosterModel({ preview: 'hello, world' }));
    store().publish(rosterModel({ preview: 'hello, world', at: 2 }));
    expect(factsOf(store())).toBe(facts);
    expect(view.renders).toBe(1);
  });

  test.each([
    ['working count', rosterModel({ working: 2 })],
    ['needs-you count', rosterModel({ needsYou: 1 })],
    ['lead session', rosterModel({ lead: 'other' })],
    ['identity', { ...rosterModel(), identity: { missionId: 'm' } }],
    ['loaded flag', { ...rosterModel(), loaded: false }],
  ] as const)('a changed %s gives a new snapshot and renders the root once', (_name, next) => {
    const { view, store } = root(helpers(rosterClass(start())), 's1');
    const facts = factsOf(store());
    store().publish(next);
    expect(factsOf(store())).not.toBe(facts);
    expect(view.renders).toBe(2);
    expect(view.output).toBe(next);
  });

  test('none to one subagent and back renders the root each way', () => {
    const { view, store } = root(helpers(rosterClass(new Map())), 's1');
    expect(factsOf(store())).toBeNull();
    const one = rosterModel();
    store().publish(one);
    expect(view.renders).toBe(2);
    expect(view.output).toBe(one);
    store().publish(null);
    expect(view.renders).toBe(3);
    expect(view.output).toBeNull();
  });

  test('a render for another reason reads the newest model, preview included', () => {
    const { view, store } = root(helpers(rosterClass(start())), 's1');
    const newer = rosterModel({ preview: 'newer' });
    store().publish(newer);
    expect(view.renders).toBe(1);
    view.rerender('s1');
    expect(view.output).toBe(newer);
  });

  test('switching session follows the new roster and lets go of the old one', () => {
    const sessions = new Map([
      ['s1', rosterModel()],
      ['s2', rosterModel({ lead: 'lead2' })],
    ]);
    const { view, store } = root(helpers(rosterClass(sessions)), 's1');
    const first = store();
    view.rerender('s2');
    expect(store()).not.toBe(first);
    expect(first.listeners.size).toBe(0);
    expect(view.output?.roster.lead.droid.sessionId).toBe('lead2');
    view.rerender('s1');
    expect(view.output?.roster.lead.droid.sessionId).toBe('lead');
  });

  test('a mission session builds a store that follows nothing and reads null, as stock', () => {
    const { view, store } = root(helpers(rosterClass(start())), null);
    expect(view.output).toBeNull();
    expect(factsOf(store())).toBeNull();
  });
});

describe('the readers that draw roster details see every published model', () => {
  test('the live read renders on every publish, previews included', () => {
    const Store = rosterClass(new Map([['s1', rosterModel()]]));
    const lib = helpers(Store);
    const store = new Store('s1');
    const reader = mount(() => lib.$ODrosterLive(store, null), null);
    const published = [
      rosterModel({ preview: 'a' }),
      rosterModel({ preview: 'b', at: 9 }),
      rosterModel({ working: 3 }),
      null,
    ];
    for (const next of published) {
      store.publish(next);
      expect(reader.output).toBe(next);
    }
    expect(reader.renders).toBe(published.length + 1);
  });

  test('with no store, as on the mission path, the reader hands back the model it was given', () => {
    const lib = helpers(rosterClass(new Map()));
    const mission = rosterModel({ lead: 'mission-lead' });
    expect(mount(() => lib.$ODrosterLive(undefined, mission), null).output).toBe(mission);
    expect(mount(() => lib.$ODrosterLive(undefined, null), null).output).toBeNull();
  });

  test('the status line draws the stock line with the live model and the other props', () => {
    const Store = rosterClass(new Map([['s1', rosterModel()]]));
    const lib = helpers(Store);
    const store = new Store('s1');
    const line = mount(
      () =>
        lib.$ODRosterLine({ $ODstore: store, model: rosterModel({ lead: 'stale' }), width: 80 }),
      null,
    );
    const newer = rosterModel({ working: 2, needsYou: 1, preview: 'fresh' });
    store.publish(newer);
    expect(line.output?.type).toBe(statusLine);
    expect(line.output?.props).toEqual({ width: 80, model: newer });
    store.publish(null);
    expect(line.output).toBeNull();
  });
});

describe('the controller callbacks read the roster when they run', () => {
  test('the model the controller args hand out is the newest one the store published', () => {
    const Store = rosterClass(new Map([['s1', rosterModel()]]));
    const store = new Store('s1');
    const args = controllerArgs(store, store.getSnapshot());
    const newer = rosterModel({ preview: 'newer' });
    store.publish(newer);
    expect(args.model).toBe(newer);
    expect(args.currentSessionId).toBe('s1');
  });

  test('on the mission path the args hand out the model the root rendered', () => {
    const mission = rosterModel({ lead: 'mission-lead' });
    expect(controllerArgs(undefined, mission).model).toBe(mission);
  });
});
