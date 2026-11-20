import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { rebasePatch } from '../rebase.ts';
import { renderPatches } from '../render-patches.ts';
import { moduleHolding, sourceApp, STOCK, textOf } from './ink-frame-harness.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

describeStrayNames(renderPatches);

interface Manager {
  renderLimit: number | null;
  expandUiMessages: () => boolean;
}

interface Store {
  getMessages: () => unknown[];
  notifyMessagesChanged: () => void;
}

type ManagerClass = new (store: Store) => Manager;

const EXPAND = patchNamed(renderPatches, 'resume-expand-once');

function managerClassWith(method: string): ManagerClass {
  return payloadFunction<[], ManagerClass>(
    [],
    `return class{renderLimit=30;constructor(t){this.store=t}getDisplayMessagesBeforeLimit(){return this.store.getMessages()}${method}}`,
  )();
}

function storeOf(count: number, notifications: { count: number }): Store {
  return {
    getMessages: () => Array.from({ length: count }, (_unused, index) => index),
    notifyMessagesChanged: () => {
      notifications.count += 1;
    },
  };
}

function ticksUntilDone(manager: Manager): number[] {
  const limits: number[] = [];
  let again = true;
  while (again && limits.length < 20) {
    again = manager.expandUiMessages();
    limits.push(manager.renderLimit ?? -1);
  }
  return limits;
}

describe('resume-expand-once', () => {
  test('stock doubles the window one tick at a time', () => {
    const Stock = managerClassWith(EXPAND.find);
    expect(ticksUntilDone(new Stock(storeOf(677, { count: 0 })))).toEqual([60, 120, 240, 480, -1]);
  });

  test('the first tick shows every message and ends the loop', () => {
    const Patched = managerClassWith(EXPAND.replace);
    const notifications = { count: 0 };
    const manager = new Patched(storeOf(677, notifications));
    expect(manager.expandUiMessages()).toBe(false);
    expect(manager.renderLimit).toBeNull();
    expect(notifications.count).toBe(1);
  });

  test('a session that already shows everything is left alone', () => {
    const Patched = managerClassWith(EXPAND.replace);
    const notifications = { count: 0 };
    const manager = new Patched(storeOf(10, notifications));
    manager.renderLimit = null;
    expect(manager.expandUiMessages()).toBe(false);
    expect(notifications.count).toBe(0);
  });
});

interface Element {
  type: string;
  props: { scopeKey?: string; children?: Element; units?: string[] };
}

const MAIN_TRANSCRIPT = patchNamed(renderPatches, 'main-transcript-markdown-cache');

function transcriptWith(statement: string): Element {
  return payloadFunction<[], Element>(
    [],
    `const t=(type,props)=>({type,props}),hV="List",coe="Scope",D1=["unit"],x=80,k=86,g1=1,Pe=!1,q=!0,X=[],Z=[];return ${statement}`,
  )();
}

describe('main-transcript-markdown-cache', () => {
  test.skipIf(STOCK === undefined)(
    'wraps the committed list inside the stock static region',
    () => {
      const app = sourceApp();
      const rebase = rebasePatch(
        MAIN_TRANSCRIPT,
        app.map((module) => module.text),
      );
      const name = moduleHolding(app, rebase.find);
      expect(textOf(app, name)).toContain(`id:"StaticMessageList",children:${rebase.find}})`);
      expect(textOf(patchSource(app, [MAIN_TRANSCRIPT]), name)).toContain(
        `id:"StaticMessageList",children:${rebase.replace}})`,
      );
    },
  );

  test('the markdown scope leaves every committed list prop intact', () => {
    const stock = transcriptWith(MAIN_TRANSCRIPT.find);
    expect(stock.type).toBe('List');
    expect(stock.props.units).toEqual(['unit']);
    expect(transcriptWith(MAIN_TRANSCRIPT.replace)).toEqual({
      type: 'Scope',
      props: { scopeKey: 'main', children: stock },
    });
  });
});
