import { expect } from 'bun:test';
import { homedir } from 'node:os';
import path from 'node:path';

import { FACTORY_SOUNDS, SUBAGENT_SOUND_FILE } from '../../paths.ts';
import { patches } from '../patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

export const REGISTRY_STOCK =
  'var l=null,o=null;function iee(n){l=n}function aee(n){o=n}function dw(){l?.()}function oee(){o?.()}';

export const CALLBACK_STOCK =
  'aee(()=>{let o=f(),r=o.getCompletionSound();if(r==="off")return;let i=o.getSoundFocusMode();M9(r,{},i).catch(()=>{})});';

export const WAIT_SOUND = path.join(FACTORY_SOUNDS, SUBAGENT_SOUND_FILE);

export function patched(stock: string, name: string): string {
  const { find, replace } = patchNamed(patches, name);
  expect(stock).toContain(find);
  return stock.replace(find, () => replace);
}

export const registry = patched(REGISTRY_STOCK, 'turn-end-sound-takes-subagent-flag');
const callback = patched(CALLBACK_STOCK, 'turn-end-sound-waits-for-subagents');

export interface Played {
  sound: string;
  focus: string;
}

interface Settings {
  getCompletionSound: () => string;
  getSoundFocusMode: () => string;
}

interface PlayOptions {
  volume?: number;
}

type Play = (sound: string, options: PlayOptions, focus: string) => Promise<null>;

interface Registry {
  finish: (subagentsRunning?: boolean) => null;
}

interface SpawnOptions {
  stdio: string[];
  detached: boolean;
}

interface SpawnCall {
  command: string[];
  options: SpawnOptions;
}

interface Child {
  unref: () => null;
}

export interface Herdr {
  HOME?: string;
  HERDR_ENV?: string;
  HERDR_BIN_PATH?: string;
}

interface Shell {
  env: Herdr;
}

interface Runtime {
  Bun: { spawn: (command: string[], options: SpawnOptions) => Child };
}

interface CompletionHarness extends Registry {
  played: Played[];
  spawned: SpawnCall[];
}

interface Conditions {
  completionSound?: string;
  env?: Herdr;
  spawnFails?: boolean;
}

export const HERDR_ARGS = ['notification', 'show', 'Subagents still running', '--sound', 'wait'];

export const HERDR_DONE_ARGS = ['notification', 'show', 'Droid finished', '--sound', 'done'];

export const HERDR_OUTSIDE: Herdr = { HOME: homedir() };

export const HERDR_INSIDE: Herdr = { ...HERDR_OUTSIDE, HERDR_ENV: '1' };

export function completionHarness({
  completionSound = 'fx-ok01',
  env = HERDR_OUTSIDE,
  spawnFails = false,
}: Conditions = {}): CompletionHarness {
  const played: Played[] = [];
  const spawned: SpawnCall[] = [];
  const settings: Settings = {
    getCompletionSound: () => completionSound,
    getSoundFocusMode: () => 'always',
  };
  const play: Play = async (sound, _options, focus) => {
    played.push({ sound, focus });
    return await Promise.resolve(null);
  };
  const shell: Shell = { env };
  const runtime: Runtime = {
    Bun: {
      spawn: (command, options) => {
        spawned.push({ command, options });
        if (spawnFails) {
          throw new Error('ENOENT');
        }
        return { unref: () => null };
      },
    },
  };
  const { finish } = payloadFunction<[() => Settings, Play, Shell, Runtime], Registry>(
    ['f', 'M9', 'process', 'globalThis'],
    `${registry};${callback}return{finish:oee}`,
  )(() => settings, play, shell, runtime);
  return { finish, played, spawned };
}
