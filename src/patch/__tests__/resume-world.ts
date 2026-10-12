import type { Setup } from './clock-env.ts';
import { fileOf, transcriptOf } from './clock-env.ts';
import { FooterWorld, SESSION } from './footer-harness.ts';
import { MINUTE_MS } from './warmer-harness.ts';

export const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
export const TRUSTED_MS = 45 * MINUTE_MS;
export const SETUP: Setup = {
  droid: '0.238.0',
  skills: 'aaa',
  proxy: 'ddd',
  mcp: 'ccc',
  'AGENTS.md': 'bbb',
};
export const HELP = '? for help';
export const TOMBSTONE = '{"at":null}';
export const PARENT = 'parent-session';
export const GRANDPARENT = 'grandparent-session';

export function transcriptText(
  sessionId: string,
  parent: string | undefined,
  messageAgesMs: number[],
): string {
  const start = { type: 'session_start', id: sessionId, parent };
  const messages = messageAgesMs.map((age) => ({
    type: 'message',
    timestamp: new Date(NOW - age).toISOString(),
  }));
  return `${[start, ...messages].map((line) => JSON.stringify(line)).join('\n')}\n`;
}

export class ResumeWorld extends FooterWorld {
  constructor() {
    super();
    FooterWorld.at(NOW);
  }

  saveFor(sessionId: string, ageMs: number, setup: Setup | null = SETUP): void {
    this.clock.files.set(fileOf(sessionId), JSON.stringify({ at: NOW - ageMs, setup }));
  }

  saved(ageMs: number, setup: Setup | null = SETUP): void {
    this.saveFor(SESSION, ageMs, setup);
  }

  transcript(sessionId: string, parent: string | undefined, messageAgesMs: number[]): void {
    this.clock.files.set(transcriptOf(sessionId), transcriptText(sessionId, parent, messageAgesMs));
  }

  appendHookRecord(sessionId: string, ageMs: number): void {
    const record = {
      type: 'message',
      timestamp: new Date(NOW - ageMs).toISOString(),
      message: {
        role: 'user',
        content: [],
        visibility: 'user_only',
        hookEventName: 'SessionStart',
        hookMatcher: 'resume',
      },
    };
    const file = transcriptOf(sessionId);
    this.clock.files.set(file, `${this.clock.files.get(file)}${JSON.stringify(record)}\n`);
  }

  async resumed(): Promise<string> {
    this.render();
    await Bun.sleep(0);
    return this.text;
  }

  async fingerprint(setup: Setup | null): Promise<string> {
    this.clock.startFingerprint();
    this.clock.answer(setup);
    await Bun.sleep(0);
    return this.text;
  }
}
