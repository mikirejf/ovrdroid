import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { fieldsOfJson } from './fields.ts';
import { WAIT_DROID, WAIT_MAIN_MODEL } from './scope-leak-coverage.ts';
import { RESPONSES_MODEL, responsesSettings } from './scope-leak-responses.ts';
import { MIX_CONTENT } from './scope-leak-tool-mix.ts';
import { leakSettings, CHILD_MODEL, CHAT_MODEL } from './scope-leak.ts';
import type { ScopeLeakOptions } from './scope-leak.ts';
import { stubSettings } from './stub-model.ts';

export function hookRecords(file: string) {
  return existsSync(file)
    ? readFileSync(file, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => fieldsOfJson(line))
    : [];
}

function waitSettings(url: string, toolsFile: string, responsesChild: boolean) {
  const settings = leakSettings(url);
  const main = stubSettings(url, WAIT_MAIN_MODEL);
  const hook = `bun -e 'const body=await Bun.stdin.text(); console.log(JSON.stringify({...JSON.parse(body),atMs:Date.now()}))' >> '${toolsFile}'`;
  return {
    ...settings,
    customModels: [
      ...settings.customModels,
      ...main.customModels,
      ...(responsesChild ? responsesSettings(url).customModels : []),
    ],
    sessionDefaultSettings: main.sessionDefaultSettings,
    sessionTitleModel: `custom:${WAIT_MAIN_MODEL}`,
    hooks: {
      ...settings.hooks,
      PreToolUse: [
        { matcher: 'Task|TaskOutput', hooks: [{ type: 'command', command: hook, timeout: 5 }] },
      ],
      PostToolUse: [
        { matcher: 'TaskOutput', hooks: [{ type: 'command', command: hook, timeout: 5 }] },
      ],
    },
  };
}

export function createWaitProject(options: ScopeLeakOptions, run: string) {
  const dir = mkdtempSync(path.join(realpathSync(options.cwd), 'ovrdroid-scope-leak-'));
  return {
    dir,
    out: options.out === undefined ? undefined : path.resolve(options.out, run),
    toolsFile: path.join(dir, 'tools.jsonl'),
    droids: path.join(dir, '.factory', 'droids'),
    mixFile: path.join(dir, 'scope-leak-scratch.txt'),
    settingsFile: path.join(dir, 'settings.json'),
    flagsFile: path.join(dir, 'flags.json'),
  };
}
type WaitProject = ReturnType<typeof createWaitProject>;
export function prepareWaitProject(
  project: WaitProject,
  url: string,
  options: ScopeLeakOptions,
): void {
  const { droids, toolsFile, mixFile, settingsFile, flagsFile } = project;
  const responsesChild = options.responsesChild === true;
  mkdirSync(droids, { recursive: true });
  if (options.toolMix === true) {
    writeFileSync(mixFile, `${MIX_CONTENT}\n`);
  }
  const models = new Map([
    ['quick', CHILD_MODEL],
    ['held', CHAT_MODEL],
    ['responses', RESPONSES_MODEL],
  ]);
  for (const kind of ['quick', 'held', ...(responsesChild ? ['responses'] : [])]) {
    writeFileSync(
      path.join(droids, `${WAIT_DROID}-${kind}.md`),
      `---\nname: ${WAIT_DROID}-${kind}\ndescription: Local scope probe only.\nmodel: custom:${models.get(kind)}\n---\nSay hi.\n`,
    );
  }
  writeFileSync(settingsFile, JSON.stringify(waitSettings(url, toolsFile, responsesChild)));
  writeFileSync(flagsFile, JSON.stringify({ flags: { shared_process_agents: true }, configs: {} }));
}
export function saveWaitProject(
  project: WaitProject,
  data: {
    bodies: unknown[];
    phases: unknown[];
    processLog: string;
    screen: readonly string[];
    evidence: unknown;
  },
): void {
  const { out, toolsFile } = project;
  if (out === undefined) {
    return;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, 'bodies.jsonl'),
    `${data.bodies.map((body) => JSON.stringify(body)).join('\n')}\n`,
  );
  writeFileSync(path.join(out, 'phases.json'), JSON.stringify(data.phases, null, 2));
  writeFileSync(
    path.join(out, 'tools.jsonl'),
    existsSync(toolsFile) ? readFileSync(toolsFile) : '',
  );
  writeFileSync(path.join(out, 'process.log'), data.processLog);
  writeFileSync(path.join(out, 'screen.txt'), data.screen.join('\n'));
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(data.evidence, null, 2));
}
export function removeWaitProject(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
