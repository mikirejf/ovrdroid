import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { FACTORY_SESSIONS } from '../paths.ts';
import type { LaunchEnv } from './launch.ts';
import { PROBE_SETTINGS } from './launch.ts';
import { sessionFolderName } from './ledger.ts';
import type { Transcript } from './live-transcript.ts';
import type { Session } from './session.ts';
import { ENTER, openSession } from './session.ts';

const TRANSCRIPT_SUFFIX = '.jsonl';
export const COMPRESS_COMMAND = '/compress';
const MENU_SETTLE_MS = 400;
const PASTE_SETTLE_MS = 300;

const TRUSTED_ROOT = realpathSync('/tmp');

export async function withLiveDir<T>(prefix: string, use: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(TRUSTED_ROOT, `ovrdroid-${prefix}-`));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface LiveOptions {
  cwd: string;
  dir: string;
  model: string;
  effort: string;
  args?: readonly string[];
  env?: LaunchEnv;
  collect?: boolean;
}

export async function openLiveSession(binary: string, options: LiveOptions): Promise<Session> {
  const settingsFile = path.join(options.dir, 'settings.json');
  writeFileSync(
    settingsFile,
    JSON.stringify({
      ...PROBE_SETTINGS,
      sessionDefaultSettings: { model: options.model, reasoningEffort: options.effort },
    }),
  );
  return await openSession(binary, {
    cwd: options.cwd,
    args: options.args ?? [],
    collect: options.collect ?? false,
    env: { ...options.env, FACTORY_RUNTIME_SETTINGS_PATH: settingsFile },
  });
}

export function sessionFolder(cwd: string): string {
  return path.join(FACTORY_SESSIONS, sessionFolderName(realpathSync(cwd)));
}

export function transcriptsIn(folder: string): Transcript[] {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder)
    .filter((name) => name.endsWith(TRANSCRIPT_SUFFIX))
    .map((name) => ({
      id: path.basename(name, TRANSCRIPT_SUFFIX),
      text: readFileSync(path.join(folder, name), 'utf-8'),
    }));
}

export async function submit(session: Session, text: string): Promise<void> {
  session.paste(text);
  await delay(PASTE_SETTLE_MS);
  await session.type(ENTER);
}

export async function compress(session: Session): Promise<void> {
  await session.type(COMPRESS_COMMAND);
  await delay(MENU_SETTLE_MS);
  await session.type(ENTER);
  await delay(MENU_SETTLE_MS);
  await session.type(ENTER);
}
