import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import {
  DRAWS_NOTHING,
  RUN_CALLS,
  RUN_UNIT,
  STACK,
  stackedViewPatches,
  SUBTITLE,
  TABLES,
} from '../stacked-view-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { stock } from './session-mention-harness.ts';

const SLOW_PATCH_MS = 120_000;

interface Call {
  id: string;
  toolName: string;
  status: string;
  isError?: boolean;
  toolInput?: { command?: string };
  sourceMessageStreaming?: boolean;
}

interface Note {
  id: string;
  text: string;
  drawsNothing?: boolean;
}

interface ItemUnit {
  kind: 'item';
  item: Call | Note;
  sourceIds: string[];
  pinnedToStatic?: boolean;
}

interface GroupUnit {
  kind: 'collapsed-group';
  unitId?: string;
  sourceIds: string[];
  signature?: string;
  group: {
    tools: Call[];
    toolName?: string;
    $ODstack?: boolean;
    $ODopen?: boolean;
    $ODlive?: boolean;
  };
}

type Unit = ItemUnit | GroupUnit;

interface StackOptions {
  open: boolean;
  showThinking: boolean;
  inline: (id: string) => boolean;
}

interface Helpers {
  stack: (units: Unit[], options: StackOptions) => Unit[];
  subtitle: (call: Call) => string | null;
}

function isCall(item: Call | Note): item is Call {
  return 'toolName' in item && 'status' in item;
}

const helpers = payloadFunction<
  [typeof isCall, (item: Call | Note) => object | null, (call: Call) => string],
  Helpers
>(
  ['va', 'iD', 'Jxe'],
  `${TABLES}${RUN_CALLS}${DRAWS_NOTHING}${RUN_UNIT}${STACK}${SUBTITLE}` +
    'return{stack:$ODstack,subtitle:$ODsubtitle}',
)(
  isCall,
  (item) => ('drawsNothing' in item && item.drawsNothing ? null : {}),
  (call) => `subtitle of ${call.id}`,
);

function toolCall(id: string, toolName: string, extra: Partial<Call> = {}): ItemUnit {
  return { kind: 'item', item: { id, toolName, status: 'completed', ...extra }, sourceIds: [id] };
}

function note(id: string, drawsNothing = false): ItemUnit {
  return { kind: 'item', item: { id, text: id, drawsNothing }, sourceIds: [id] };
}

function group(...ids: string[]): GroupUnit {
  return {
    kind: 'collapsed-group',
    sourceIds: ids,
    group: { tools: ids.map((id) => ({ id, toolName: 'Read', status: 'completed' })) },
  };
}

const CLOSED: StackOptions = { open: false, showThinking: false, inline: () => false };
const OPEN: StackOptions = { ...CLOSED, open: true };

function runs(units: Unit[]): string[][] {
  return units.flatMap((unit) =>
    unit.kind === 'collapsed-group' && unit.group.$ODstack === true
      ? [unit.group.tools.map((tool) => tool.id)]
      : [],
  );
}

function unitLabels(units: Unit[]): string[] {
  return units.map((unit) =>
    unit.kind === 'collapsed-group' ? `run:${unit.group.tools.length}` : unit.sourceIds.join(','),
  );
}

describeStrayNames(stackedViewPatches);

describe.skipIf(stock === undefined)(
  'every stacked view patch applies to the shipped bundle once',
  () => {
    const rebases = rebaseAll(
      stackedViewPatches,
      (stock ?? []).map((module) => module.text),
    );

    test.each(rebases.map((rebase) => [rebase.name, rebase] as const))('%s', (_name, rebase) => {
      expect(rebase.matches).toBe(1);
      expect(applies(rebase)).toBe(true);
    });

    test(
      'they apply with the shipped patch set',
      () => {
        if (stock === undefined) {
          throw new Error('no stock Droid to patch');
        }
        const text = patchSource(stock, patches)
          .map((module) => module.text)
          .join('\n');
        expect(text).toContain('function $ODStack(');
        expect(text).toContain('a.Stacked="stacked"');
      },
      SLOW_PATCH_MS,
    );
  },
);

describe('folding calls into runs', () => {
  test('consecutive calls of any tool become one run in arrival order', () => {
    const out = helpers.stack(
      [
        toolCall('r1', 'Read'),
        group('r2', 'r3'),
        toolCall('g1', 'Grep'),
        toolCall('x1', 'Execute'),
      ],
      CLOSED,
    );
    expect(runs(out)).toEqual([['r1', 'r2', 'r3', 'g1', 'x1']]);
    const [unit] = out;
    expect(unit?.kind === 'collapsed-group' && unit.unitId).toBe('collapsed-group:r1');
    expect(unit?.sourceIds).toEqual(['r1', 'r2', 'r3', 'g1', 'x1']);
  });

  test('an item that draws nothing passes through without splitting the run', () => {
    const out = helpers.stack(
      [toolCall('r1', 'Read'), note('hook', true), toolCall('r2', 'Read')],
      CLOSED,
    );
    expect(unitLabels(out)).toEqual(['run:2', 'hook']);
  });

  test('an item that draws something closes the run', () => {
    const out = helpers.stack(
      [toolCall('r1', 'Read'), note('text'), toolCall('r2', 'Read')],
      CLOSED,
    );
    expect(unitLabels(out)).toEqual(['run:1', 'text', 'run:1']);
  });

  test('an inline tool closes the run and stays a unit of its own', () => {
    const out = helpers.stack(
      [toolCall('r1', 'Read'), toolCall('e1', 'Edit'), toolCall('r2', 'Read')],
      CLOSED,
    );
    expect(unitLabels(out)).toEqual(['run:1', 'e1', 'run:1']);
  });

  test('a call awaiting permission closes the run so its prompt still shows', () => {
    const out = helpers.stack(
      [toolCall('r1', 'Read'), toolCall('x1', 'Execute'), toolCall('r2', 'Read')],
      {
        ...CLOSED,
        inline: (id) => id === 'x1',
      },
    );
    expect(unitLabels(out)).toEqual(['run:1', 'x1', 'run:1']);
  });

  test('a unit already pinned to scrollback is left as it is', () => {
    const pinned: ItemUnit = { ...toolCall('r1', 'Read'), pinnedToStatic: true };
    const out = helpers.stack([pinned, toolCall('r2', 'Read')], CLOSED);
    expect(unitLabels(out)).toEqual(['r1', 'run:1']);
  });

  test('while the turn runs only the last run is open and live', () => {
    const out = helpers.stack([toolCall('r1', 'Read'), note('text'), toolCall('r2', 'Read')], OPEN);
    const flags = out.flatMap((unit) =>
      unit.kind === 'collapsed-group' ? [[unit.group.$ODopen, unit.group.$ODlive]] : [],
    );
    expect(flags).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  test('a closed run stays live while its message still streams', () => {
    const out = helpers.stack([toolCall('r1', 'Read', { sourceMessageStreaming: true })], CLOSED);
    const [unit] = out;
    expect(unit?.kind === 'collapsed-group' && [unit.group.$ODopen, unit.group.$ODlive]).toEqual([
      false,
      true,
    ]);
  });
});

describe('the open line', () => {
  test('an Execute call shows its command on one line', () => {
    const subtitle = helpers.subtitle({
      id: 'x',
      toolName: 'Execute',
      status: 'executing',
      toolInput: { command: 'cd /tmp &&\n  ls -la\n' },
    });
    expect(subtitle).toBe('cd /tmp && ls -la');
  });

  test('other calls use the stock subtitle', () => {
    expect(helpers.subtitle({ id: 'r', toolName: 'Read', status: 'completed' })).toBe(
      'subtitle of r',
    );
  });
});

describe('Scripts', () => {
  test('nested calls join the run and the outer Script draws nothing', () => {
    const out = helpers.stack(
      [
        toolCall('r1', 'Read'),
        note('script', true),
        toolCall('n1', 'Execute'),
        toolCall('n2', 'Grep'),
      ],
      CLOSED,
    );
    expect(unitLabels(out)).toEqual(['run:3', 'script']);
    expect(runs(out)).toEqual([['r1', 'n1', 'n2']]);
  });
});

describe('the setting', () => {
  test('the settings item cycles expanded, compact, stacked', () => {
    const patch = patchNamed(stackedViewPatches, 'stacked-view-setting-cycle');
    let current = 'expanded';
    const item = payloadFunction<
      [() => string, () => { setToolResultDisplay: (value: string) => void }],
      { action: () => void }
    >(['Io', 'f'], `return{${patch.replace}}}`)(
      () => current,
      () => ({
        setToolResultDisplay: (value) => {
          current = value;
        },
      }),
    );
    const seen = [1, 2, 3].map(() => {
      item.action();
      return current;
    });
    expect(seen).toEqual(['compact', 'stacked', 'expanded']);
  });

  test('the value label reads Stacked', () => {
    const patch = patchNamed(stackedViewPatches, 'stacked-view-setting-label');
    const label = payloadFunction<[], (value: string) => string>(
      [],
      `${patch.replace}"Expanded":"Compact"}return QD`,
    )();
    expect(['expanded', 'compact', 'stacked'].map((value) => label(value))).toEqual([
      'Expanded',
      'Compact',
      'Stacked',
    ]);
  });
});

interface LiveUnit {
  kind: string;
  group?: { $ODlive?: boolean };
  item?: { sourceMessageStreaming?: boolean };
}

describe('keeping the open run live', () => {
  const patch = patchNamed(stackedViewPatches, 'stacked-view-open-run-live');
  const live = payloadFunction<[], (unit: LiveUnit) => boolean>([], `${patch.replace}return Xz`)();

  test('an open stacked run counts as live', () => {
    expect(live({ kind: 'collapsed-group', group: { $ODlive: true } })).toBe(true);
  });

  test('a closed run and a stock group are not', () => {
    expect(live({ kind: 'collapsed-group', group: { $ODlive: false } })).toBe(false);
    expect(live({ kind: 'collapsed-group', group: {} })).toBe(false);
  });

  test('a streaming item stays live as in stock', () => {
    expect(live({ kind: 'item', item: { sourceMessageStreaming: true } })).toBe(true);
  });
});
