import { describe, expect, test } from 'bun:test';

import { MAIN_MARKDOWN_SCOPE, renderPatches } from '../render-patches.ts';
import { freeNames } from '../tokens.ts';
import { patchNamed, payloadFunction } from './payload.ts';

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(renderPatches.map((patch) => [patch.name, patch] as const))('%s', (_name, patch) => {
    const known = new Set(
      [patch.find, patch.until ?? '', ...(patch.lookups ?? [])].flatMap((text) => freeNames(text)),
    );
    const stray = freeNames(patch.replace).filter(
      (name) => !name.startsWith('$OD') && !known.has(name),
    );
    expect(stray).toEqual([]);
  });
});

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
    `const un=(t)=>t;return class{renderLimit=30;constructor(t){this.store=t}${method}}`,
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
  props: { id?: string; scopeKey?: string; children?: Element; units?: string };
}

const MAIN_TRANSCRIPT = patchNamed(renderPatches, 'main-transcript-markdown-cache');

function transcriptWith(statement: string): Element {
  return payloadFunction<[], Element>(
    [],
    `const t=(type,props)=>({type,props}),E0="Static",t4="List",mL="Scope",$e={committedUnits:"units"},y=80,E=86,ot=1,be=!1,F=!0,K=[],G=[];return ${statement}`,
  )();
}

describe('main-transcript-markdown-cache', () => {
  test('stock renders the committed list straight under the static region', () => {
    const tree = transcriptWith(MAIN_TRANSCRIPT.find);
    expect(tree.props.id).toBe('StaticMessageList');
    expect(tree.props.children?.type).toBe('List');
  });

  test('the committed list sits inside a markdown scope', () => {
    const tree = transcriptWith(MAIN_TRANSCRIPT.replace);
    expect(tree.props.id).toBe('StaticMessageList');
    expect(tree.props.children?.type).toBe('Scope');
    expect(tree.props.children?.props.scopeKey).toBe(MAIN_MARKDOWN_SCOPE);
    expect(tree.props.children?.props.children?.type).toBe('List');
    expect(tree.props.children?.props.children?.props.units).toBe('units');
  });
});
