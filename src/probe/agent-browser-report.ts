import path from 'node:path';

import {
  AGENT_BROWSER_BREW_INSTALL,
  AGENT_BROWSER_NPM_INSTALL,
} from '../patch/agent-browser-patches.ts';
import { entriesOf, fieldsOf, fieldsOfJson, worded } from './fields.ts';

export type Placement = 'foreground' | 'background';
export type Situation = 'system' | 'stale' | 'absent';

export interface AgentBrowserCase {
  placement: Placement;
  situation: Situation;
}

export interface ToolResult {
  isError: boolean;
  text: string;
}

export interface Observation {
  result: ToolResult | undefined;
  output: string | undefined;
  marker: boolean;
  bundledBinary: string | undefined;
  bundledToolsDir: boolean;
}

export interface Expected {
  scratchHome: string;
  versionLine: string;
}

export type DoctorSituation = Exclude<Situation, 'stale'>;

export interface DoctorLine {
  status: string;
  detail: string;
  path: string;
}

export interface Verdict {
  pass: boolean;
  text: string;
}

export const STALE_SCRIPT = '#!/bin/sh\necho stale\n';
export const STALE_ACTION_NOTE = 'a stale copy planted in the Droid bin folder';
export const SKILLS_LINE = 'skills=';
export const BINARY_NAME = 'agent-browser';

export const DOCTOR_LINE_ID = 'binaries.agent-browser';

const PLACEMENTS: readonly Placement[] = ['foreground', 'background'];
const SITUATIONS: readonly Situation[] = ['system', 'stale', 'absent'];

export function agentBrowserCases(): AgentBrowserCase[] {
  return PLACEMENTS.flatMap((placement) =>
    SITUATIONS.map((situation) => ({ placement, situation })),
  );
}

function quoted(file: string): string {
  return `'${file.replaceAll("'", "'\\''")}'`;
}

export function probeCommand(files: { marker: string; output: string }): string {
  return (
    `touch ${quoted(files.marker)}; ` +
    `{ command -v ${BINARY_NAME}; ${BINARY_NAME} --version; echo "${SKILLS_LINE}$AGENT_BROWSER_SKILLS_DIR"; } > ${quoted(files.output)} 2>&1`
  );
}

export function pathWithout(
  pathValue: string,
  holdsBinary: (directory: string) => boolean,
): string {
  return pathValue
    .split(path.delimiter)
    .filter((directory) => directory !== '' && !holdsBinary(directory))
    .join(path.delimiter);
}

export function toolResultIn(stdout: string, callId: string): ToolResult | undefined {
  for (const line of stdout.split('\n')) {
    const event = fieldsOfJson(line);
    if (worded(event, 'type') === 'tool_result' && worded(event, 'id') === callId) {
      const isError = event.get('isError') === true;
      const text = isError
        ? worded(fieldsOf(event.get('error')), 'message')
        : worded(event, 'value');
      return { isError, text };
    }
  }
  return undefined;
}

export function describeCase({ placement, situation }: AgentBrowserCase): string {
  const where = placement === 'foreground' ? 'a foreground Execute' : 'a background Execute';
  if (situation === 'system') {
    return `${where} finds the installed agent-browser`;
  }
  if (situation === 'stale') {
    return `${where} still finds the installed agent-browser past ${STALE_ACTION_NOTE}`;
  }
  return `${where} with no agent-browser installed refuses and tells the model how to install it`;
}

function bundledProblems(agentCase: AgentBrowserCase, seen: Observation): string[] {
  const problems: string[] = [];
  const planted = agentCase.situation === 'stale';
  if (planted && seen.bundledBinary !== STALE_SCRIPT) {
    problems.push(
      seen.bundledBinary === undefined
        ? 'the planted stale copy in the Droid bin folder was deleted'
        : 'the planted stale copy in the Droid bin folder was overwritten, so Droid extracted its bundled one',
    );
  }
  if (!planted && seen.bundledBinary !== undefined) {
    problems.push('Droid extracted a bundled agent-browser into its bin folder');
  }
  if (seen.bundledToolsDir) {
    problems.push('Droid extracted the bundled agent-browser skill files');
  }
  return problems;
}

function runProblems(seen: Observation, expected: Expected): string[] {
  const { result, output } = seen;
  if (result?.isError === true) {
    return [`Droid refused the command: ${result.text}`];
  }
  if (output === undefined) {
    return ['the command left no output file'];
  }
  const [found = '', version = '', skills = ''] = output.trim().split('\n');
  const problems: string[] = [];
  if (!path.isAbsolute(found) || found.startsWith(`${expected.scratchHome}${path.sep}`)) {
    problems.push(`the command resolved agent-browser to ${JSON.stringify(found)}`);
  }
  if (version !== expected.versionLine) {
    problems.push(
      `agent-browser printed ${JSON.stringify(version)}, not the installed ${JSON.stringify(expected.versionLine)}`,
    );
  }
  if (skills !== SKILLS_LINE) {
    problems.push(`AGENT_BROWSER_SKILLS_DIR was set: ${JSON.stringify(skills)}`);
  }
  return problems;
}

function refusalProblems(seen: Observation): string[] {
  const { result } = seen;
  const problems: string[] = [];
  if (result?.isError === true) {
    for (const phrase of ['not installed', AGENT_BROWSER_NPM_INSTALL, AGENT_BROWSER_BREW_INSTALL]) {
      if (!result.text.includes(phrase)) {
        problems.push(`the error does not say ${JSON.stringify(phrase)}: ${result.text}`);
      }
    }
  } else {
    problems.push('the tool call did not fail');
  }
  if (seen.marker || seen.output !== undefined) {
    problems.push('the command ran anyway');
  }
  return problems;
}

export function caseVerdict(
  agentCase: AgentBrowserCase,
  seen: Observation,
  expected: Expected,
): Verdict {
  const what = describeCase(agentCase);
  if (seen.result === undefined) {
    return {
      pass: false,
      text: `not exercised: Droid never answered the Execute call, so "${what}" was not checked`,
    };
  }
  const problems = [
    ...(agentCase.situation === 'absent' ? refusalProblems(seen) : runProblems(seen, expected)),
    ...bundledProblems(agentCase, seen),
  ];
  return problems.length === 0
    ? { pass: true, text: what }
    : { pass: false, text: `${what}, but ${problems.join('; ')}` };
}

export const DOCTOR_SITUATIONS: readonly DoctorSituation[] = ['system', 'absent'];

export function doctorLineIn(stdout: string): DoctorLine | undefined {
  const report = fieldsOfJson(stdout);
  for (const result of entriesOf(report, 'results')) {
    if (worded(result, 'id') === DOCTOR_LINE_ID) {
      return {
        status: worded(result, 'status'),
        detail: worded(result, 'detail'),
        path: worded(fieldsOf(result.get('data')), 'path'),
      };
    }
  }
  return undefined;
}

export function describeDoctorCase(situation: DoctorSituation): string {
  return situation === 'system'
    ? 'droid doctor reports the installed agent-browser with its version'
    : 'droid doctor with no agent-browser installed warns and says how to install it';
}

function doctorSystemProblems(line: DoctorLine, expected: Expected): string[] {
  const problems: string[] = [];
  if (line.status !== 'pass') {
    problems.push(`the line is ${JSON.stringify(line.status)}, not "pass": ${line.detail}`);
  } else if (!line.detail.startsWith(`${expected.versionLine} (`)) {
    problems.push(
      `it reads ${JSON.stringify(line.detail)}, not the installed ${JSON.stringify(expected.versionLine)}`,
    );
  }
  if (line.path === '' || line.path.startsWith(expected.scratchHome)) {
    problems.push(`it names the binary at ${JSON.stringify(line.path)}`);
  }
  return problems;
}

function doctorAbsentProblems(line: DoctorLine): string[] {
  const problems: string[] = [];
  if (line.status !== 'warn') {
    problems.push(`the line is ${JSON.stringify(line.status)}, not "warn": ${line.detail}`);
  }
  for (const phrase of ['not installed', AGENT_BROWSER_NPM_INSTALL, AGENT_BROWSER_BREW_INSTALL]) {
    if (!line.detail.includes(phrase)) {
      problems.push(`it does not say ${JSON.stringify(phrase)}: ${line.detail}`);
    }
  }
  return problems;
}

export function doctorVerdict(
  situation: DoctorSituation,
  line: DoctorLine | undefined,
  expected: Expected,
): Verdict {
  const what = describeDoctorCase(situation);
  if (line === undefined) {
    return {
      pass: false,
      text: `not exercised: droid doctor printed no Agent browser line, so "${what}" was not checked`,
    };
  }
  const problems =
    situation === 'system' ? doctorSystemProblems(line, expected) : doctorAbsentProblems(line);
  return problems.length === 0
    ? { pass: true, text: what }
    : { pass: false, text: `${what}, but ${problems.join('; ')}` };
}

export function describeVerdicts(verdicts: readonly Verdict[]): string {
  return verdicts.map((verdict) => `${verdict.pass ? 'ok  ' : 'FAIL'}  ${verdict.text}`).join('\n');
}
