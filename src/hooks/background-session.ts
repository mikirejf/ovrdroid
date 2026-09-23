import path from 'node:path';

import { isTaggedSettings } from './hook-payloads.ts';

const BACKGROUND_TAGS = new Set(['subagent', 'exec']);

export function sessionSettingsFile(transcriptPath: string, sessionId: string): string {
  return path.join(path.dirname(transcriptPath), `${sessionId}.settings.json`);
}

export async function isBackgroundSession(settingsFile: string): Promise<boolean> {
  let settings: unknown;
  try {
    settings = JSON.parse(await Bun.file(settingsFile).text());
  } catch {
    return false;
  }
  return isTaggedSettings(settings) && settings.tags.some(({ name }) => BACKGROUND_TAGS.has(name));
}
