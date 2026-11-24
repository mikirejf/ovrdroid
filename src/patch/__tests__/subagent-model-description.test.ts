import { describe, expect, test } from 'bun:test';

import { rebaseAll } from '../rebase.ts';
import { subagentModelPatches, TASK_HELPERS } from '../subagent-model-patches.ts';
import { patchNamed, payloadFunction, rebasedNamed } from './payload.ts';
import { requireStock, stockDroid } from './stock-scanner.ts';

const STOCK_TOOL = Object.freeze({
  id: 'task-cli',
  description: 'Delegate a task.',
  inputSchema: { local: true },
  isTopLevelTool: true,
});

interface Tool extends Omit<typeof STOCK_TOOL, 'description'> {
  description: string;
}

class Executor {
  toolId = 'task-cli';
}

interface Registration {
  tool: Tool;
  executorFactory: () => Executor;
}

type Catalog = () => readonly string[];

const registration = payloadFunction<[() => Tool, Catalog, typeof Executor], Registration>(
  ['s3e', 'Cs', 'ke'],
  `${TASK_HELPERS}return{${patchNamed(subagentModelPatches, 'task-description-lists-model-ids').replace}}`,
);

function register(catalog: Catalog): Registration {
  return registration(() => STOCK_TOOL, catalog, Executor);
}

describe('the registered Task description lists model ids', () => {
  test('preserves the tool and executor', () => {
    const result = register(() => ['builtin', 'shared', 'custom:one', 'shared']);
    expect(result.tool).toEqual({
      ...STOCK_TOOL,
      description:
        'Delegate a task.\n\nModel ids the `model` field takes in this session: inherit, builtin, shared, custom:one.',
    });
    expect(result.tool.inputSchema).toBe(STOCK_TOOL.inputSchema);
    expect(result.executorFactory()).toBeInstanceOf(Executor);
    expect(result.executorFactory().toolId).toBe(STOCK_TOOL.id);
    expect(STOCK_TOOL.description).toBe('Delegate a task.');
  });

  test('a registration refresh reads current ids and does not append twice', () => {
    let custom = 'custom:old';
    const catalog = () => ['builtin', 'shared', custom];
    expect(register(catalog).tool.description).toContain('custom:old.');
    custom = 'custom:new';
    const { description } = register(catalog).tool;
    expect(description).toContain('custom:new.');
    expect(description).not.toContain('custom:old');
    expect(description.split('Model ids')).toHaveLength(2);
  });

  test('built-in ids remain available without custom models', () => {
    expect(register(() => ['builtin', 'shared']).tool.description).toEndWith(
      'inherit, builtin, shared.',
    );
  });
});

describe.skipIf(stockDroid === undefined)('the shipped Task helper scope', () => {
  test('the helper declaration, registration and launcher share one module', () => {
    const modules = requireStock().map((module) => module.text);
    const rebased = rebaseAll(subagentModelPatches, modules);
    const helper = rebasedNamed(rebased, 'task-model-helpers');
    const owners = modules.filter((source) => source.includes(helper.find));
    expect(owners).toHaveLength(1);
    for (const name of [
      'task-description-lists-model-ids',
      'task-launch-splits-model-and-matches-name',
    ]) {
      expect(owners[0]).toContain(rebasedNamed(rebased, name).find);
    }
  });
});
