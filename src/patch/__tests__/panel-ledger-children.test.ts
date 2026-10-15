import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PanelLedgerEntry, PanelRow, PanelTask } from './panel-list.ts';
import { panelLister, panelRowsUnder, panelUnder } from './panel-list.ts';

function task(taskId: string, parentSessionId: string, status = 'running'): PanelTask {
  return { taskId, parentSessionId, status };
}

function entry(
  childSessionId: string,
  parentSessionId: string,
  extra: Partial<PanelLedgerEntry> = {},
): PanelLedgerEntry {
  return {
    childSessionId,
    parentSessionId,
    taskInvocationId: `inv-${childSessionId}`,
    parentToolUseId: `tool-${childSessionId}`,
    createdAt: 1000,
    ...extra,
  };
}

function worldOf(ledger: readonly PanelLedgerEntry[]) {
  return {
    ledger,
    invocations: Object.fromEntries(
      ledger.map((row) => [row.childSessionId, row.taskInvocationId]),
    ),
  };
}

function modelOf(row: PanelRow | undefined): (string | undefined)[] {
  return [row?.model, row?.reasoningEffort];
}

const finished = { status: 'completed', subagentType: 'x', description: 'y' };

describe('the sub-agent panel lists running children that are not loaded in the store', () => {
  test('a ledger-only child is a running row with the ledger fields', () => {
    const ledger = [
      entry('far', 'main', { subagentType: 'worker', description: 'fix it', createdAt: 42 }),
    ];
    expect(panelRowsUnder([], 'main', worldOf(ledger))).toEqual([
      {
        taskId: 'far',
        sessionId: 'far',
        parentSessionId: 'main',
        toolCallId: 'tool-far',
        status: 'running',
        subagentType: 'worker',
        description: 'fix it',
        startTime: 42,
        nestDepth: 0,
      },
    ]);
  });

  test('loaded and ledger-only children share one list', () => {
    expect(panelUnder([task('near', 'main')], 'main', worldOf([entry('far', 'main')]))).toEqual([
      'near',
      'far',
    ]);
  });

  test('a ledger entry for a loaded child adds no second row', () => {
    expect(panelUnder([task('near', 'main')], 'main', worldOf([entry('near', 'main')]))).toEqual([
      'near',
    ]);
  });

  test('a loaded child that is not running is not revived from the ledger', () => {
    const tasks = [task('near', 'main', 'completed')];
    expect(panelUnder(tasks, 'main', worldOf([entry('near', 'main')]))).toEqual([]);
  });

  test('a loaded planning session does not hide its ledger entry', () => {
    const world = { ...worldOf([entry('plan', 'main')]), decomp: ['plan'] };
    expect(panelUnder([task('plan', 'main')], 'main', world)).toEqual(['plan']);
  });

  test('two ledger entries for one child give one row', () => {
    const first = entry('far', 'main');
    expect(panelUnder([], 'main', worldOf([first, { ...first }]))).toEqual(['far']);
  });

  test('an entry that is not the current invocation of its child is skipped', () => {
    const ledger = [entry('far', 'main')];
    expect(panelUnder([], 'main', { ledger, invocations: { far: 'other' } })).toEqual([]);
    expect(panelUnder([], 'main', { ledger })).toEqual([]);
  });

  test('a child whose summary is finished is skipped, a running one is listed', () => {
    const summaries = { done: finished, live: { ...finished, status: 'running' } };
    const world = { ...worldOf([entry('done', 'main'), entry('live', 'main')]), summaries };
    expect(panelUnder([], 'main', world)).toEqual(['live']);
  });

  test('the summary names the child when the ledger entry has no name', () => {
    const summaries = { far: { status: 'running', subagentType: 'worker', description: 'fix it' } };
    const [row] = panelRowsUnder([], 'main', { ...worldOf([entry('far', 'main')]), summaries });
    expect([row?.subagentType, row?.description]).toEqual(['worker', 'fix it']);
  });

  test('an empty name stays unset so the footer shows its default', () => {
    const summaries = { far: { status: 'running', subagentType: '', description: '' } };
    const [row] = panelRowsUnder([], 'main', { ...worldOf([entry('far', 'main')]), summaries });
    expect([row?.subagentType, row?.description]).toEqual([undefined, undefined]);
  });

  test('a ledger-only child lists its loaded and ledger-only children under it', () => {
    const world = worldOf([entry('far', 'main'), entry('deep', 'far')]);
    expect(panelUnder([task('near', 'far')], 'main', world)).toEqual(['far', '  near', '  deep']);
  });

  test('a finished ledger-only parent still leads to its running children', () => {
    const world = {
      ...worldOf([entry('far', 'main'), entry('deep', 'far')]),
      summaries: { far: finished },
    };
    expect(panelUnder([], 'main', world)).toEqual(['deep']);
  });

  test('a ledger cycle lists each child once', () => {
    const world = worldOf([entry('a', 'main'), entry('b', 'a'), entry('a', 'b')]);
    expect(panelUnder([], 'main', world)).toEqual(['a', '  b']);
  });
});

describe('a ledger-only child carries the model saved in its settings file', () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(tmpdir(), 'panel-settings-'));
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  const saveSettings = (id: string, settings: string): void => {
    writeFileSync(path.join(sessionsDir, `${id}.settings.json`), settings);
  };

  const saved = JSON.stringify({ model: 'opus-5-5', reasoningEffort: 'high', tags: [] });

  test('the row gets the model and effort from the settings file', () => {
    saveSettings('far', saved);
    const [row] = panelRowsUnder([], 'main', { ...worldOf([entry('far', 'main')]), sessionsDir });
    expect(modelOf(row)).toEqual(['opus-5-5', 'high']);
  });

  test('a missing settings file leaves the row without a model', () => {
    const [row] = panelRowsUnder([], 'main', { ...worldOf([entry('far', 'main')]), sessionsDir });
    expect(row?.taskId).toBe('far');
    expect(modelOf(row)).toEqual([undefined, undefined]);
  });

  test('a broken settings file leaves the row without a model', () => {
    saveSettings('far', '{"model":');
    const [row] = panelRowsUnder([], 'main', { ...worldOf([entry('far', 'main')]), sessionsDir });
    expect(modelOf(row)).toEqual([undefined, undefined]);
  });

  test('a child the app cannot find on disk leaves the row without a model', () => {
    const [row] = panelRowsUnder([], 'main', worldOf([entry('far', 'main')]));
    expect(modelOf(row)).toEqual([undefined, undefined]);
  });

  test('a saved model is read once, and a file written later is still picked up', () => {
    const list = panelLister([], { ...worldOf([entry('far', 'main')]), sessionsDir });
    expect(modelOf(list('main')[0])).toEqual([undefined, undefined]);
    saveSettings('far', saved);
    expect(modelOf(list('main')[0])).toEqual(['opus-5-5', 'high']);
    rmSync(path.join(sessionsDir, 'far.settings.json'));
    expect(modelOf(list('main')[0])).toEqual(['opus-5-5', 'high']);
  });
});
