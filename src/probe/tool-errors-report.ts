import { MS_PER_DAY, say } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { inPool } from './pool.ts';
import { describeToolErrors } from './tool-errors-describe.ts';
import { pickSession, readSettings, readToolErrors, summariseToolErrors } from './tool-errors.ts';
import type { Filters, SessionPick, SessionReading, SessionSettings } from './tool-errors.ts';
import { transcriptsSince } from './transcript-files.ts';

export const DEFAULT_TOOL_ERRORS_SESSIONS = FACTORY_SESSIONS;
export const DEFAULT_TOOL_ERRORS_DAYS = 7;

const TRANSCRIPT_EXTENSION = '.jsonl';
const SETTINGS_EXTENSION = '.settings.json';
const READ_WIDTH = 8;

export interface ToolErrorsOptions extends SessionPick {
  since?: number;
  until?: number;
  sessions: string;
  tool?: string;
}

async function settingsOf(transcript: string): Promise<SessionSettings> {
  const file = transcript.slice(0, -TRANSCRIPT_EXTENSION.length) + SETTINGS_EXTENSION;
  try {
    return readSettings(await Bun.file(file).text());
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return readSettings();
    }
    throw error;
  }
}

async function readSession(
  file: string,
  filters: Filters,
  options: ToolErrorsOptions,
): Promise<SessionReading[]> {
  const settings = await settingsOf(file);
  if (!pickSession(settings, options)) {
    return [];
  }
  const text = await Bun.file(file).text();
  return [{ settings, reading: readToolErrors(text.split('\n'), filters) }];
}

function windowWords(filters: Filters): string {
  const until = Number.isFinite(filters.until) ? new Date(filters.until).toISOString() : 'now';
  return `from ${new Date(filters.since).toISOString()} up to ${until} (UTC, end exclusive)`;
}

export async function toolErrors(options: ToolErrorsOptions): Promise<void> {
  const filters: Filters = {
    since: options.since ?? Date.now() - DEFAULT_TOOL_ERRORS_DAYS * MS_PER_DAY,
    until: options.until ?? Number.POSITIVE_INFINITY,
    tool: options.tool,
  };
  const { total, recent } = await transcriptsSince(options.sessions, filters.since);
  const found = await inPool(
    recent,
    READ_WIDTH,
    async (file) => await readSession(file, filters, options),
  );
  const readings = found.flat();
  say(`${options.sessions}: ${readings.length} of ${total} transcripts read`);
  say(`tool calls ${windowWords(filters)}`);
  say('');
  say(describeToolErrors(summariseToolErrors(readings)));
}
