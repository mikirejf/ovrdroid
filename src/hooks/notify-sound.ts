import path from 'node:path';

import { FACTORY_SETTINGS, FACTORY_SOUNDS } from '../paths.ts';
import { isSoundSettings } from './hook-payloads.ts';

const DEFAULT_SOUND = 'fx-ack01';
const SILENT = 'off';
const BELL = 'bell';
const PLAYER = '/usr/bin/afplay';

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

export async function playAwaitingSound(): Promise<void> {
  const sound = await readSound(FACTORY_SETTINGS);
  if (sound === SILENT) {
    return;
  }
  if (sound === BELL) {
    process.stderr.write('\u0007');
    return;
  }

  const { spawn } = await import('node:child_process');
  spawn(PLAYER, [soundFile(sound)], { detached: true, stdio: 'ignore' }).unref();
}
