import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { agentBrowserPatches } from '../agent-browser-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

const TERMINAL = patchNamed(agentBrowserPatches, 'agent-browser-terminal-system-binary');
const BROWSER_COMMAND = 'agent-browser --version';
const HOME = '/home/test';
const CONFIG_DIR = '.factory';
const FACTORY_BIN = path.join(HOME, CONFIG_DIR, 'bin');
const BASE_PATH = ['/usr/bin', '/bin'].join(path.delimiter);
const MERGED_PATH = [FACTORY_BIN, BASE_PATH].join(path.delimiter);
const SYSTEM_PATH = ['/opt/browser/bin', MERGED_PATH].join(path.delimiter);

interface TerminalCommand {
  command: string;
  commandAsWritten?: string;
}

const terminalPath = payloadFunction<
  [
    typeof path,
    () => string,
    () => string,
    (command: string) => boolean,
    (mergedPath: string, bundledDir: string) => string,
    string,
    string,
  ],
  (command: TerminalCommand) => string
>(
  ['g', 'z', 'Y', 'Hoe', '$ODabPath', 'factoryBin', 'basePath'],
  `return(e)=>{let n={},c=[factoryBin],u="PATH",d=basePath;${TERMINAL.lookups?.join(';')};${TERMINAL.replace}return n[u]}`,
)(
  path,
  () => HOME,
  () => CONFIG_DIR,
  (command) => command === BROWSER_COMMAND,
  (mergedPath, bundledDir) => {
    expect(mergedPath).toBe(MERGED_PATH);
    expect(bundledDir).toBe(FACTORY_BIN);
    return SYSTEM_PATH;
  },
  FACTORY_BIN,
  BASE_PATH,
);

describeStrayNames([TERMINAL]);

describe('agent-browser terminal PATH', () => {
  test('classifies the original command instead of the shell-wrapped command', () => {
    expect(
      terminalPath({
        command: `. /tmp/droid-env.sh 2>/dev/null; ${BROWSER_COMMAND}`,
        commandAsWritten: BROWSER_COMMAND,
      }),
    ).toBe(SYSTEM_PATH);
  });

  test('classifies the actual command when the original is absent', () => {
    expect(terminalPath({ command: BROWSER_COMMAND })).toBe(SYSTEM_PATH);
  });

  test('preserves the standard PATH merge for other commands', () => {
    expect(terminalPath({ command: 'pwd' })).toBe(MERGED_PATH);
  });
});
