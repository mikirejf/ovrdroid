import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { hookModules, hooksSeenBy } from '../../probe/hooks.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { sessionListPatches } from '../session-list-patches.ts';
import { describeStrayNames, rebasedNamed } from './payload.ts';
import { stock } from './session-mention-harness.ts';

describeStrayNames(sessionListPatches);

const rebases = rebaseAll(
  sessionListPatches,
  (stock ?? []).map((module) => module.text),
);

describe.skipIf(stock === undefined)('the session list in the shipped bundle', () => {
  test.each(rebases.map((rebase) => [rebase.name, rebase] as const))(
    '%s applies independently of other patch families',
    (_name, rebase) => {
      expect(rebase.status).toMatch(/^(?:rebased|unchanged)$/u);
    },
  );

  test('the injected component and its renderer share the picker class scope', () => {
    const view = rebasedNamed(rebases, 'session-list-view');
    const render = rebasedNamed(rebases, 'session-list-render');
    const module = stock?.find((entry) => entry.text.includes(view.find));
    expect(module).toBeDefined();
    expect(module?.text).toContain(render.find);
    expect(view.find).toMatch(/^class [\w$]+\{workingDirectory;search;constructor\($/u);
  });

  test('the cleanup captures useEffect, not the suggestion reset callback', () => {
    const view = rebasedNamed(rebases, 'session-list-view');
    const module = stock?.find((entry) => entry.text.includes(view.find));
    if (stock === undefined || module === undefined) {
      throw new Error('the stock session picker module was not found');
    }
    const hooks = hookModules(stock).flatMap((source) => hooksSeenBy(module, source));
    expect(hooks).toContainEqual({ hook: 'useEffect', local: view.renames['v'] ?? 'v' });
    expect(hooks).toContainEqual({ hook: 'useRef', local: view.renames['S'] ?? 'S' });
  });

  test('both list patches compose without the rest of the shipped set', () => {
    if (stock === undefined) {
      throw new Error('the stock bundle was not found');
    }
    expect(rebases.every((rebase) => applies(rebase))).toBe(true);
    const patched = patchSource(stock, sessionListPatches);
    for (const rebase of rebases) {
      expect(patched.some((module) => module.text.includes(rebase.replace))).toBe(true);
    }
  });
});
