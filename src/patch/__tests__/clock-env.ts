import { OVRDROID_UNDER_HOME } from '../../paths.ts';
import {
  CACHE_CLOCK_DIR,
  CACHE_CLOCK_FACTORY,
  CACHE_CLOCK_KEY,
  CACHE_CLOCK_PURE,
  CACHE_CLOCK_RUNTIME_KEY,
  FINGERPRINT_ARGS,
  FINGERPRINT_COMMAND,
  SESSIONS_UNDER_HOME,
} from '../cache-clock.ts';
import { payloadFunction } from './payload.ts';

export type Setup = Record<string, string>;

export interface CacheEntry {
  at: number;
  setup?: Setup | null;
  loaded?: boolean;
}

export interface Verdict {
  text: string;
  warn: boolean;
}

export interface Logged {
  message: string;
  detail: { sessionId?: string; cause?: unknown };
}

export interface Pure {
  $ODCd: (recorded: Setup, current: Setup) => string[];
  $ODCv: (
    entry: CacheEntry,
    now: number,
    mine: { done: boolean; setup: Setup | null },
  ) => Verdict | null;
}

export interface ClockRuntime {
  record: (sessionId: string, at: number) => void;
  warm: (sessionId: string, at: number) => void;
  forget: (sessionId: string) => void;
  load: (sessionId: string) => void;
  view: (entry: CacheEntry, now: number) => Verdict | null;
  listen: (listener: () => void) => () => void;
}

export type Finish = (error: Error | null, stdout: string) => void;

interface ExecCall {
  file: string;
  args: string[];
  finish: Finish;
  input: string[];
}

interface FakeExecChild {
  stdin: { end: (input: string) => void };
}

interface FakeFs {
  promises: {
    mkdir: (directory: string, options: { recursive: boolean }) => Promise<void>;
    writeFile: (file: string, text: string) => Promise<void>;
    readFile: (file: string, encoding: string) => Promise<string>;
    unlink: (file: string) => Promise<void>;
    readdir: (directory: string) => Promise<string[]>;
    stat: (file: string) => Promise<{ mtimeMs: number }>;
  };
}

export interface ClockEnvironment {
  fs: FakeFs;
  exec: (file: string, args: string[], finish: Finish) => FakeExecChild;
  dir: string;
  sessions: string;
  log: (message: string, detail: Logged['detail']) => void;
  later: (start: () => void) => void;
}

export const HOME = '/home/test';

export const CLOCK_DIR = `${HOME}/${OVRDROID_UNDER_HOME}/${CACHE_CLOCK_DIR}`;

export const SESSIONS_DIR = `${HOME}/${SESSIONS_UNDER_HOME}`;

export function transcriptOf(sessionId: string, folder = '-project'): string {
  return `${SESSIONS_DIR}/${folder}/${sessionId}.jsonl`;
}

function noEntry(file: string): Error {
  return Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
}

export function pureClock(): Pure {
  return payloadFunction<[], Pure>([], `${CACHE_CLOCK_PURE}return{$ODCd,$ODCv}`)();
}

export function fileOf(sessionId: string): string {
  return `${CLOCK_DIR}/${sessionId}.json`;
}

export class ClockEnv {
  readonly files = new Map<string, string>();
  readonly modified = new Map<string, number>();
  readonly directories: string[] = [];
  readonly calls: ExecCall[] = [];
  readonly logged: Logged[] = [];
  readonly unlinked: string[] = [];
  readonly reads: string[] = [];
  writeFailure: Error | undefined;
  private started: (() => void) | undefined;

  readonly fs: FakeFs = {
    promises: {
      mkdir: async (directory) => {
        this.directories.push(directory);
        await Promise.resolve();
      },
      writeFile: async (file, text) => {
        await Promise.resolve();
        if (this.writeFailure !== undefined) {
          throw this.writeFailure;
        }
        this.files.set(file, text);
        this.modified.set(file, Date.now());
      },
      readFile: async (file) => {
        this.reads.push(file);
        await Promise.resolve();
        const text = this.files.get(file);
        if (text === undefined) {
          throw noEntry(file);
        }
        return text;
      },
      unlink: async (file) => {
        await Promise.resolve();
        this.unlinked.push(file);
        this.modified.delete(file);
        if (!this.files.delete(file)) {
          throw noEntry(file);
        }
      },
      readdir: async (directory) => {
        await Promise.resolve();
        const names = [
          ...new Set(
            [...this.files.keys()]
              .filter((file) => file.startsWith(`${directory}/`))
              .map((file) => file.slice(directory.length + 1).split('/')[0] ?? ''),
          ),
        ];
        if (names.length === 0 && !this.directories.includes(directory)) {
          throw noEntry(directory);
        }
        return names;
      },
      stat: async (file) => {
        await Promise.resolve();
        if (!this.files.has(file)) {
          throw noEntry(file);
        }
        return { mtimeMs: this.modified.get(file) ?? Date.now() };
      },
    },
  };

  get fingerprintStarted(): boolean {
    return this.calls.length > 0;
  }

  get fingerprintTimerArmed(): boolean {
    return this.started !== undefined;
  }

  readonly exec = (file: string, args: string[], finish: Finish): FakeExecChild => {
    const input: string[] = [];
    this.calls.push({ file, args, finish, input });
    return {
      stdin: {
        end: (text) => {
          input.push(text);
        },
      },
    };
  };

  readonly log = (message: string, detail: Logged['detail']): void => {
    this.logged.push({ message, detail });
  };

  readonly later = (start: () => void): void => {
    this.started = start;
  };

  startFingerprint(): void {
    const start = this.started;
    if (start === undefined) {
      throw new Error('the fingerprint timer was never armed');
    }
    start();
  }

  answer(setup: Setup | null): void {
    this.reply(null, JSON.stringify({ home: HOME, setup }));
  }

  reply(error: Error | null, stdout: string): void {
    const call = this.calls.at(-1);
    if (call === undefined) {
      throw new Error('no fingerprint command is running');
    }
    if (call.file !== FINGERPRINT_COMMAND || call.args.join(' ') !== FINGERPRINT_ARGS.join(' ')) {
      throw new Error(`unexpected command ${call.file} ${call.args.join(' ')}`);
    }
    call.finish(error, stdout);
  }

  environment(): ClockEnvironment {
    return {
      fs: this.fs,
      exec: this.exec,
      dir: CLOCK_DIR,
      sessions: SESSIONS_DIR,
      log: this.log,
      later: this.later,
    };
  }

  runtime(): ClockRuntime {
    const make = payloadFunction<[], (env: ClockEnvironment) => ClockRuntime>(
      [],
      `${CACHE_CLOCK_FACTORY}return $ODCf`,
    )();
    const runtime = make(this.environment());
    Object.assign(globalThis, { [CACHE_CLOCK_RUNTIME_KEY]: runtime });
    return runtime;
  }

  static close(): void {
    Reflect.deleteProperty(globalThis, CACHE_CLOCK_RUNTIME_KEY);
    Reflect.deleteProperty(globalThis, CACHE_CLOCK_KEY);
  }
}
