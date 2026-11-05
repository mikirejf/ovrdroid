import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { KEEP_WARM_COMMAND, keepWarmPatches } from '../keep-warm-patches.ts';
import { patches } from '../patches.ts';
import type { Patch } from '../patches.ts';
import { wideTerminalPatches } from '../wide-terminal-patches.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';

const COMMAND_CHUNK =
  'var ob={tree:{name:"tree",description:"Navigate the session fork tree",category:"session"},' +
  'vim:{name:"vim",description:"Toggle vim keybindings for the chat input",category:"config"},' +
  'workstreams:{name:"workstreams",description:"Alias for /missions",category:"tools",aliasOf:"missions"}};' +
  'var Cs=Gc({name:"vim",description:"Toggle vim keybindings for the chat input",execute:()=>({handled:!0})});' +
  'var tt={"terminal-setup":Ms,themes:Ts,tree:Bs,vim:Cs,commands:Me()},_s={};' +
  'var ot={fast:"idle-only",tree:"idle-only",settings:"immediate",quit:"interrupt",' +
  '"terminal-setup":"immediate",themes:"immediate",vim:"immediate"};';

const WIDE_COMMAND_PATCHES = new Set([
  'wide-terminal-command-catalog',
  'wide-terminal-command',
  'wide-terminal-command-busy',
]);

interface Ephemeral {
  text: string;
  options: { messageType: string; visibility: string };
}

interface Context {
  addEphemeralSystemMessage: (text: string, options: Ephemeral['options']) => void;
}

interface Command {
  name: string;
  description: string;
  execute: (args: string[], context: Context) => { handled: boolean };
}

interface Registry {
  ob: Record<string, { name: string; description: string; category: string }>;
  tt: Record<string, Command>;
  ot: Record<string, string>;
}

interface Run {
  registry: Registry;
  asked: (string | undefined)[];
  notes: Ephemeral[];
  run: (...args: string[]) => { handled: boolean };
}

const APP: App = [
  { name: 'entry.js', text: '' },
  { name: 'chunk-commands.js', text: COMMAND_CHUNK },
];

const WIDE: readonly Patch[] = wideTerminalPatches.filter((patch) =>
  WIDE_COMMAND_PATCHES.has(patch.name),
);

function patchedChunk(list: readonly Patch[]): string {
  const [, chunk] = patchSource(APP, list);
  if (chunk === undefined) {
    throw new TypeError('the patched app lost a module');
  }
  return chunk.text;
}

function commandsWith(reply: string, list: readonly Patch[] = [...WIDE, ...keepWarmPatches]): Run {
  const asked: (string | undefined)[] = [];
  const notes: Ephemeral[] = [];
  const registry = payloadFunction<[(command: Command) => Command, () => object, object], Registry>(
    ['Gc', 'Me', 'globalThis'],
    `var Ms,Ts,Bs;${patchedChunk(list)};return{ob,tt,ot}`,
  )(
    (command) => command,
    () => ({}),
    {
      __odKeepWarm: (argument?: string): string => {
        asked.push(argument);
        return reply;
      },
      __odSetWidth: (): string => 'width',
    },
  );
  const command = registry.tt[KEEP_WARM_COMMAND];
  if (command === undefined) {
    throw new TypeError('the command is missing');
  }
  return {
    registry,
    asked,
    notes,
    run: (...args) =>
      command.execute(args, {
        addEphemeralSystemMessage: (text, options) => {
          notes.push({ text, options });
        },
      }),
  };
}

describe('the command catalog', () => {
  test('lists /keep-warm as a config command', () => {
    const entry = commandsWith('x').registry.ob[KEEP_WARM_COMMAND];

    expect(entry).toMatchObject({ name: 'keep-warm', category: 'config' });
    expect(entry?.description).toContain('cache');
  });

  test('keeps the entries around it and /width', () => {
    const { ob } = commandsWith('x').registry;

    expect(Object.keys(ob)).toEqual(['tree', 'vim', 'width', 'keep-warm', 'workstreams']);
  });
});

describe('the command', () => {
  test('is registered next to /vim and /width', () => {
    const { tt } = commandsWith('x').registry;

    expect(Object.keys(tt)).toEqual([
      'terminal-setup',
      'themes',
      'tree',
      'keep-warm',
      'vim',
      'width',
      'commands',
    ]);
    expect(tt[KEEP_WARM_COMMAND]).toMatchObject({ name: 'keep-warm' });
  });

  test('hands its first argument to the warmer and shows the answer to the user only', () => {
    const { run, asked, notes } = commandsWith('Keep warm on for this session');

    expect(run('on', 'extra')).toEqual({ handled: true });

    expect(asked).toEqual(['on']);
    expect(notes).toEqual([
      {
        text: 'Keep warm on for this session',
        options: { messageType: 'system_notification', visibility: 'user_only' },
      },
    ]);
  });

  test('with no argument the warmer gets none', () => {
    const { run, asked } = commandsWith('x');

    run();

    expect(asked).toEqual([undefined]);
  });

  test('does not touch /width', () => {
    const { registry } = commandsWith('x');

    expect(registry.tt['width']).toMatchObject({ name: 'width' });
  });
});

describe('the busy modes', () => {
  test('/keep-warm runs at once, even while a turn is running', () => {
    const { ot } = commandsWith('x').registry;

    expect(ot[KEEP_WARM_COMMAND]).toBe('immediate');
    expect(ot['width']).toBe('immediate');
    expect(ot['tree']).toBe('idle-only');
    expect(ot['settings']).toBe('immediate');
  });
});

describe('beside the width command', () => {
  const orders: [string, readonly Patch[]][] = [
    ['after them', [...WIDE, ...keepWarmPatches]],
    ['before them', [...keepWarmPatches, ...WIDE]],
  ];

  test.each(orders)('both commands apply with the keep-warm patches %s', (_order, list) => {
    const { tt, ob, ot } = commandsWith('x', list).registry;

    for (const name of ['width', KEEP_WARM_COMMAND]) {
      expect(Object.keys(tt)).toContain(name);
      expect(Object.keys(ob)).toContain(name);
    }
    expect(ot).toMatchObject({ width: 'immediate', [KEEP_WARM_COMMAND]: 'immediate' });
  });

  test('the shipped list carries every keep-warm patch once', () => {
    const names = patches.map((patch) => patch.name);

    for (const patch of keepWarmPatches) {
      expect(names.filter((name) => name === patch.name)).toHaveLength(1);
    }
  });
});

describeStrayNames(keepWarmPatches);
