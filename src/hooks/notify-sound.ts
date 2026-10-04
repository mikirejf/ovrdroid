import path from 'node:path';

import { FACTORY_SETTINGS, FACTORY_SOUNDS } from '../paths.ts';
import { isSoundSettings } from './hook-payloads.ts';

const DEFAULT_SOUND = 'fx-ack01';
const SILENT = 'off';
const BELL = 'bell';
const PLAYER = '/usr/bin/afplay';
const HERDR_DEFAULT_BINARY = 'herdr';
const HERDR_REQUEST_ARGS = ['notification', 'show', 'Droid needs approval', '--sound', 'request'];

export async function readSound(settingsFile: string): Promise<string> {
  let settings: unknown;
  try {
    settings = JSON.parse(await Bun.file(settingsFile).text());
  } catch {
    return DEFAULT_SOUND;
  }

  return isSoundSettings(settings) ? settings.awaitingInputSound : DEFAULT_SOUND;
}

function soundFile(value: string): string {
  return value.includes(path.sep) ? value : path.join(FACTORY_SOUNDS, `${value}.wav`);
}

export interface Surroundings {
  platform: string;
  herdr: boolean;
  herdrBinary: string;
  launch: (command: string, args: string[]) => void;
  ringBell: () => void;
}

export function playSound(sound: string, surroundings: Surroundings): void {
  if (sound === SILENT) {
    return;
  }
  if (sound === BELL) {
    surroundings.ringBell();
    return;
  }
  if (surroundings.herdr) {
    surroundings.launch(surroundings.herdrBinary, HERDR_REQUEST_ARGS);
    return;
  }
  if (surroundings.platform !== 'darwin') {
    return;
  }
  surroundings.launch(PLAYER, [soundFile(sound)]);
}

function launchDetached(command: string, args: string[]): void {
  try {
    Bun.spawn([command, ...args], {
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true,
    }).unref();
  } catch {}
}

function ringTerminalBell(): void {
  process.stderr.write('\u0007');
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

export async function playAwaitingSound(): Promise<void> {
  const herdrBinary = Bun.env['HERDR_BIN_PATH'];
  playSound(await readSound(FACTORY_SETTINGS), {
    platform: process.platform,
    herdr: isSet(Bun.env['HERDR_ENV']),
    herdrBinary: isSet(herdrBinary) ? herdrBinary : HERDR_DEFAULT_BINARY,
    launch: launchDetached,
    ringBell: ringTerminalBell,
  });
}
