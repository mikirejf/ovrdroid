import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { rootRenderPatches } from '../root-render-patches.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { payloadFunction } from './payload.ts';

const SLOW_PATCH_MS = 120_000;

const rebases = rebaseAll(
  rootRenderPatches,
  (STOCK ?? []).map((module) => module.text),
);

function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the root render patches`);
  }
  return found;
}

describe.skipIf(STOCK === undefined)(
  'every root render patch applies to the shipped bundle once',
  () => {
    test.each(rootRenderPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test(
      'the set ships and applies on top of every other shipped patch',
      () => {
        const shipped = new Set(patches.map((patch) => patch.name));
        expect(rootRenderPatches.every((patch) => shipped.has(patch.name))).toBe(true);
        const app = patchSource(sourceApp(), patches);
        expect(app.length).toBe(sourceApp().length);
      },
      SLOW_PATCH_MS,
    );
  },
);

interface Draft {
  current: string;
}

type Write = (text: string, options: { updateInput: boolean }) => void;

type InputChange = (text: string) => void;

interface Played {
  events: string[];
  draft: string;
}

function arrowOf(statement: string): string {
  const arrow = /^onInputChange:(?<arrow>.*)$/u.exec(statement)?.groups?.['arrow'];
  if (arrow === undefined) {
    throw new Error('the patch text is not an onInputChange property');
  }
  return arrow;
}

function played(statement: string, start: string, texts: readonly string[]): Played {
  const rebase = rebased('input-change-noop');
  const names = ['kt', 'lt', 'bi'].map((name) => rebase.renames[name] ?? name);
  const events: string[] = [];
  const draft: Draft = { current: start };
  const change = payloadFunction<[Draft, () => void, Write], InputChange>(
    names,
    `return ${arrowOf(statement)}`,
  )(
    draft,
    () => {
      events.push('dismiss');
    },
    (text, options) => {
      draft.current = text;
      events.push(`write ${JSON.stringify(text)} updateInput=${options.updateInput}`);
    },
  );
  for (const text of texts) {
    change(text);
  }
  return { events, draft: draft.current };
}

describe.skipIf(STOCK === undefined)('input-change-noop', () => {
  const { find, replace } = rebased('input-change-noop');

  test('stock writes the draft it already holds, once per report', () => {
    expect(played(find, 'hello', ['hello', 'hello']).events).toEqual([
      'write "hello" updateInput=false',
      'write "hello" updateInput=false',
    ]);
  });

  test('the same text reaches neither the dismiss call nor the write', () => {
    expect(played(replace, 'hello', ['hello', 'hello'])).toEqual({ events: [], draft: 'hello' });
  });

  test('an empty draft reported empty again is left alone', () => {
    expect(played(replace, '', ['']).events).toEqual([]);
  });

  test('a changed text dismisses, then writes without touching the input', () => {
    expect(played(replace, 'hello', ['hello!']).events).toEqual([
      'dismiss',
      'write "hello!" updateInput=false',
    ]);
  });

  test('a run of reports ends on the draft stock ends on, with only the repeats dropped', () => {
    const texts = ['a', 'a', 'ab', 'ab', 'a', '', ''];
    const stock = played(find, '', texts);
    const patched = played(replace, '', texts);
    expect(stock.events.filter((event) => event.startsWith('write'))).toHaveLength(7);
    expect(patched.events).toEqual([
      'dismiss',
      'write "a" updateInput=false',
      'dismiss',
      'write "ab" updateInput=false',
      'dismiss',
      'write "a" updateInput=false',
      'dismiss',
      'write "" updateInput=false',
    ]);
    expect(patched.draft).toBe(stock.draft);
    expect(patched.events.filter((event) => event === 'dismiss')).toHaveLength(
      stock.events.filter((event) => event === 'dismiss').length,
    );
  });
});

interface Summary {
  decompSessionType?: string;
  decompMissionId?: string;
}

interface Host {
  summaries: Record<string, Summary | null>;
  reads: number;
}

interface Service {
  currentSessionId: string | undefined;
  currentDecompSessionType: string | undefined;
  currentDecompMissionId: string | undefined;
  sessionSettings: { tags: { role: string; missionId: string }[] | undefined };
  getDecompSessionType: () => string | undefined;
}

type ServiceClass = new (host: Host) => Service;

const METHOD_START = 'getDecompSessionType(){if(this.currentDecompSessionType)';
const METHOD = /^getDecompSessionType\(\)\{[\s\S]*?(?=getCurrentSessionTags\(\)\{)/u;
const TAG_HELPERS =
  /let \w+=(?<role>[\w$]+)\(this\.sessionSettings\.tags\);if\(\w+\)return this\.currentDecompSessionType=\w+,this\.currentDecompMissionId=(?<mission>[\w$]+)\(/u;

function methodIn(app: readonly { text: string }[]): string {
  const holder = app.find((module) => module.text.includes(METHOD_START));
  const method = METHOD.exec(holder?.text.slice(holder.text.indexOf(METHOD_START)) ?? '')?.[0];
  if (method === undefined) {
    throw new Error('the bundle has no getDecompSessionType method');
  }
  return method;
}

function serviceWith(method: string): ServiceClass {
  const helpers = TAG_HELPERS.exec(method)?.groups;
  const role = helpers?.['role'];
  const mission = helpers?.['mission'];
  if (role === undefined || mission === undefined) {
    throw new Error('the method does not read the tags through two helpers');
  }
  return payloadFunction<[], ServiceClass>(
    [],
    `const ${role}=(tags)=>tags?.[0]?.role,${mission}=(tags)=>tags?.[0]?.missionId;return class{currentSessionId;currentDecompSessionType;currentDecompMissionId;sessionSettings={tags:void 0};constructor(host){this.host=host}getSessionSummary(){this.host.reads+=1;return this.host.summaries[this.currentSessionId]??null}${method}}`,
  )();
}

type Step =
  | { kind: 'ask' }
  | { kind: 'session'; id: string | undefined }
  | { kind: 'tags'; role: string | undefined }
  | { kind: 'forget' }
  | { kind: 'summary'; id: string; value: Summary | null };

const ASK: Step = { kind: 'ask' };
const WORKER: Summary = { decompSessionType: 'worker', decompMissionId: 'mission-1' };
const ASKS_FIVE: readonly Step[] = [ASK, ASK, ASK, ASK, ASK];

function forgetType(service: Service): void {
  service.currentDecompSessionType = undefined;
  service.currentDecompMissionId = undefined;
}

function play(Class: ServiceClass, summaries: Host['summaries'], steps: readonly Step[]) {
  const host: Host = { summaries: { ...summaries }, reads: 0 };
  const service = new Class(host);
  const answers: (string | undefined)[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case 'ask': {
        answers.push(service.getDecompSessionType());
        break;
      }
      case 'session': {
        service.currentSessionId = step.id;
        forgetType(service);
        break;
      }
      case 'tags': {
        service.sessionSettings.tags =
          step.role === undefined ? undefined : [{ role: step.role, missionId: 'tag-mission' }];
        break;
      }
      case 'forget': {
        forgetType(service);
        break;
      }
      case 'summary': {
        host.summaries[step.id] = step.value;
        break;
      }
    }
  }
  return {
    answers,
    reads: host.reads,
    type: service.currentDecompSessionType,
    mission: service.currentDecompMissionId,
  };
}

describe.skipIf(STOCK === undefined)('decomp-miss-cache', () => {
  const patchedText = methodIn(patchSource(sourceApp(), rootRenderPatches.slice(1)));
  const Stock = serviceWith(methodIn(sourceApp()));
  const Patched = serviceWith(patchedText);

  const both = (summaries: Host['summaries'], steps: readonly Step[]) => {
    const stock = play(Stock, summaries, steps);
    const patched = play(Patched, summaries, steps);
    expect({ ...patched, reads: 0 }).toEqual({ ...stock, reads: 0 });
    return { stock, patched };
  };

  test('the patched method is not the stock method', () => {
    expect(patchedText).not.toBe(methodIn(sourceApp()));
  });

  test('a summary without a type is read once, where stock reads it every time', () => {
    const { stock, patched } = both({ s1: {} }, [{ kind: 'session', id: 's1' }, ...ASKS_FIVE]);
    expect(stock.reads).toBe(5);
    expect(patched.reads).toBe(1);
    expect(patched.answers).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  test('a missing summary is read every time, so a file that appears later is seen', () => {
    const { stock, patched } = both({}, [
      { kind: 'session', id: 's1' },
      ASK,
      ASK,
      { kind: 'summary', id: 's1', value: WORKER },
      ASK,
      ASK,
    ]);
    expect(patched.answers).toEqual([undefined, undefined, 'worker', 'worker']);
    expect(patched.reads).toBe(3);
    expect(stock.reads).toBe(3);
  });

  test('a summary with a type gives the type and its mission, then stops reading', () => {
    const { patched } = both({ s1: WORKER }, [{ kind: 'session', id: 's1' }, ...ASKS_FIVE]);
    expect(patched.answers).toEqual(['worker', 'worker', 'worker', 'worker', 'worker']);
    expect(patched.mission).toBe('mission-1');
    expect(patched.reads).toBe(1);
  });

  test('a role in the tags wins on every call, even after a cached miss', () => {
    const { patched } = both({ s1: {} }, [
      { kind: 'session', id: 's1' },
      ASK,
      ASK,
      { kind: 'tags', role: 'orchestrator' },
      ASK,
      { kind: 'tags', role: undefined },
      { kind: 'forget' },
      ASK,
    ]);
    expect(patched.answers).toEqual([undefined, undefined, 'orchestrator', undefined]);
    expect(patched.reads).toBe(1);
  });

  test('no session at all answers as stock does', () => {
    const { patched } = both({}, [{ kind: 'session', id: undefined }, ...ASKS_FIVE]);
    expect(patched.answers).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  test('a session switch drops the cached miss', () => {
    const { patched } = both({ s1: {}, s2: WORKER, s3: {} }, [
      { kind: 'session', id: 's1' },
      ASK,
      ASK,
      { kind: 'session', id: 's2' },
      ASK,
      ASK,
      { kind: 'session', id: 's3' },
      ASK,
      ASK,
    ]);
    expect(patched.answers).toEqual([
      undefined,
      undefined,
      'worker',
      'worker',
      undefined,
      undefined,
    ]);
    expect(patched.reads).toBe(3);
  });

  test('returning to a session after another one reads its summary again', () => {
    const { patched } = both({ s1: {}, s2: {} }, [
      { kind: 'session', id: 's1' },
      ASK,
      { kind: 'session', id: 's2' },
      ASK,
      { kind: 'session', id: 's1' },
      ASK,
      ASK,
    ]);
    expect(patched.reads).toBe(3);
  });

  test('a type reset in the middle of a session is restored from the summary like stock', () => {
    const { patched } = both({ s1: WORKER }, [
      { kind: 'session', id: 's1' },
      ASK,
      { kind: 'forget' },
      ASK,
      ASK,
    ]);
    expect(patched.answers).toEqual(['worker', 'worker', 'worker']);
    expect(patched.reads).toBe(2);
  });
});
