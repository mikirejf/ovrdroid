import { expect } from 'bun:test';

import {
  CONFIG_FILE,
  MAX_WIDTH_ENV,
  WIDE_TERMINAL_HELPERS,
  wideTerminalPatches,
} from '../wide-terminal-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

export type FailingStep = 'mkdir' | 'write' | 'rename';

export interface Disk {
  files: Map<string, string>;
  changes: string[];
}

export interface Helpers {
  boxWidth: (cols: number) => number;
  centerText: (text: string) => string;
  setWidth: (argument?: string) => string;
  repaints: () => number;
  setColumns: (columns: number) => void;
  disk: Disk;
  configPath: string;
  tempPath: string;
  savedText: () => string | undefined;
  filesRead: () => string[];
}

interface Globals {
  __odBoxWidth: Helpers['boxWidth'];
  __odCenterText: Helpers['centerText'];
  __odSetWidth: Helpers['setWidth'];
}

export interface FakeProcess {
  env: Record<string, string>;
  pid: number;
  stdout: { columns: number; emit: (event: string) => void };
}

interface FakeFs {
  readFileSync: (path: string, encoding: string) => string;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  writeFileSync: (path: string, data: string) => void;
  renameSync: (from: string, to: string) => void;
  rmSync: (path: string, options: { force: boolean }) => void;
}

interface FakeModules {
  fs: FakeFs;
  os: { homedir: () => string };
}

interface Options {
  columns?: number;
  onResize?: () => void;
  saved?: string | undefined;
  home?: string;
  failingStep?: FailingStep;
}

export const UNSET = Symbol('unset');
export const FAKE_HOME = '/home/tester';
export const FAKE_PID = 4242;
export const DISK_FAILURE = 'no space left on device';

function envWith(setting: string | typeof UNSET, home: string | undefined): Record<string, string> {
  const env: Record<string, string> = setting === UNSET ? {} : { [MAX_WIDTH_ENV]: setting };
  if (home !== undefined) {
    env['FACTORY_HOME_OVERRIDE'] = home;
  }
  return env;
}

function fsOn(disk: Disk, read: string[], failingStep: FailingStep | undefined): FakeFs {
  const failIf = (step: FailingStep): void => {
    if (step === failingStep) {
      throw new Error(DISK_FAILURE);
    }
  };
  return {
    readFileSync: (path) => {
      read.push(path);
      const content = disk.files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    mkdirSync: (path) => {
      failIf('mkdir');
      disk.changes.push(`mkdir ${path}`);
    },
    writeFileSync: (path, data) => {
      failIf('write');
      disk.changes.push(`write ${path}`);
      disk.files.set(path, data);
    },
    renameSync: (from, to) => {
      failIf('rename');
      disk.changes.push(`rename ${from} ${to}`);
      disk.files.set(to, disk.files.get(from) ?? '');
      disk.files.delete(from);
    },
    rmSync: (path) => {
      disk.changes.push(`remove ${path}`);
      disk.files.delete(path);
    },
  };
}

export function helpersWith(setting: string | typeof UNSET, options: Options = {}): Helpers {
  let resizes = 0;
  const home = options.home ?? FAKE_HOME;
  const configPath = `${home}/.factory/${CONFIG_FILE}`;
  const disk: Disk = { files: new Map(), changes: [] };
  if (options.saved !== undefined) {
    disk.files.set(configPath, options.saved);
  }
  const read: string[] = [];
  const fake: FakeProcess = {
    env: envWith(setting, options.home),
    pid: FAKE_PID,
    stdout: {
      columns: options.columns ?? 200,
      emit: (event) => {
        if (event === 'resize') {
          resizes += 1;
          options.onResize?.();
        }
      },
    },
  };
  const modules: FakeModules = {
    fs: fsOn(disk, read, options.failingStep),
    os: { homedir: () => FAKE_HOME },
  };
  const globals = payloadFunction<
    [FakeProcess, object, (name: keyof FakeModules) => FakeModules[keyof FakeModules]],
    Globals
  >(['process', 'globalThis', 'require'], `${WIDE_TERMINAL_HELPERS};return globalThis`)(
    fake,
    {},
    (name) => modules[name],
  );
  return {
    boxWidth: globals.__odBoxWidth,
    centerText: globals.__odCenterText,
    setWidth: globals.__odSetWidth,
    repaints: () => resizes,
    setColumns: (columns) => {
      fake.stdout.columns = columns;
    },
    disk,
    configPath,
    tempPath: `${configPath}.${FAKE_PID}.tmp`,
    savedText: () => disk.files.get(configPath),
    filesRead: () => read,
  };
}

export function patched(stock: string, name: string): string {
  const { find, replace } = patchNamed(wideTerminalPatches, name);
  expect(stock).toContain(find);
  return stock.replace(find, () => replace);
}
