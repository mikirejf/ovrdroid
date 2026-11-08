import { describe, expect, test } from 'bun:test';

import {
  AGENT_BROWSER_BREW_INSTALL,
  AGENT_BROWSER_NPM_INSTALL,
} from '../../patch/agent-browser-patches.ts';
import type { DoctorLine, Expected } from '../agent-browser-report.ts';
import { doctorLineIn, doctorVerdict } from '../agent-browser-report.ts';

const HOME = '/tmp/scratch/home';
const EXPECTED: Expected = { scratchHome: HOME, versionLine: 'agent-browser 0.41.2' };

function doctorReport(...results: object[]): string {
  return JSON.stringify({ ok: true, results });
}

const RIPGREP_RESULT = {
  id: 'binaries.ripgrep',
  status: 'skip',
  detail: 'not extracted yet',
  data: { path: `${HOME}/.factory/bin/rg`, copy: 'missing' },
};

const SYSTEM_RESULT = {
  id: 'binaries.agent-browser',
  status: 'pass',
  detail: 'agent-browser 0.41.2 (~/.local/bin/agent-browser)',
  data: { path: '~/.local/bin/agent-browser', copy: 'current', version: 'agent-browser 0.41.2' },
};

const ABSENT_RESULT = {
  id: 'binaries.agent-browser',
  status: 'warn',
  detail: `not installed: ${AGENT_BROWSER_NPM_INSTALL} (or ${AGENT_BROWSER_BREW_INSTALL})`,
  data: { path: `${HOME}/.factory/bin/agent-browser`, copy: 'missing' },
};

const SYSTEM_LINE: DoctorLine = {
  status: 'pass',
  detail: 'agent-browser 0.41.2 (~/.local/bin/agent-browser)',
  path: '~/.local/bin/agent-browser',
};

const ABSENT_LINE: DoctorLine = {
  status: 'warn',
  detail: `not installed: ${AGENT_BROWSER_NPM_INSTALL} (or ${AGENT_BROWSER_BREW_INSTALL})`,
  path: `${HOME}/.factory/bin/agent-browser`,
};

describe('doctorLineIn', () => {
  test('reads the Agent browser line out of the doctor report, past the other binaries', () => {
    expect(doctorLineIn(doctorReport(RIPGREP_RESULT, SYSTEM_RESULT))).toEqual(SYSTEM_LINE);
  });

  test('reads a warning with the path Droid would have used', () => {
    expect(doctorLineIn(doctorReport(ABSENT_RESULT))).toEqual(ABSENT_LINE);
  });

  test('finds nothing when the report has no Agent browser line', () => {
    expect(doctorLineIn(doctorReport(RIPGREP_RESULT))).toBeUndefined();
  });

  test('finds nothing in output that is not a JSON report', () => {
    expect(doctorLineIn('')).toBeUndefined();
    expect(doctorLineIn('Running diagnostics...')).toBeUndefined();
  });
});

describe('doctorVerdict for an installed agent-browser', () => {
  test('passes when the line shows the installed version at a path outside the scratch home', () => {
    expect(doctorVerdict('system', SYSTEM_LINE, EXPECTED)).toEqual({
      pass: true,
      text: 'droid doctor reports the installed agent-browser with its version',
    });
  });

  test('fails when the line is the old "not extracted yet" skip', () => {
    const line = {
      status: 'skip',
      detail: 'not extracted yet',
      path: `${HOME}/.factory/bin/agent-browser`,
    };
    const verdict = doctorVerdict('system', line, EXPECTED);

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('the line is "skip", not "pass": not extracted yet');
    expect(verdict.text).toContain(`it names the binary at "${line.path}"`);
  });

  test('fails when it reports another version than the installed one', () => {
    const line = { ...SYSTEM_LINE, detail: 'agent-browser 0.37.1 (~/.local/bin/agent-browser)' };
    const verdict = doctorVerdict('system', line, EXPECTED);

    expect(verdict.text).toContain(
      'it reads "agent-browser 0.37.1 (~/.local/bin/agent-browser)", not the installed "agent-browser 0.41.2"',
    );
  });

  test('fails when the binary it checked lives in the scratch home', () => {
    const line = { ...SYSTEM_LINE, path: `${HOME}/.factory/bin/agent-browser` };

    expect(doctorVerdict('system', line, EXPECTED).text).toContain('it names the binary at');
  });

  test('says it was not exercised when the report has no line', () => {
    const verdict = doctorVerdict('system', undefined, EXPECTED);

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toStartWith('not exercised: droid doctor printed no Agent browser line');
  });
});

describe('doctorVerdict with no agent-browser installed', () => {
  test('passes when the line warns with both install commands', () => {
    expect(doctorVerdict('absent', ABSENT_LINE, EXPECTED)).toEqual({
      pass: true,
      text: 'droid doctor with no agent-browser installed warns and says how to install it',
    });
  });

  test('fails when it is the old skip', () => {
    const line = { ...ABSENT_LINE, status: 'skip', detail: 'not extracted yet' };
    const verdict = doctorVerdict('absent', line, EXPECTED);

    expect(verdict.text).toContain('the line is "skip", not "warn"');
    expect(verdict.text).toContain('it does not say "not installed"');
  });

  test('fails when an install command is missing', () => {
    const line = { ...ABSENT_LINE, detail: `not installed: ${AGENT_BROWSER_NPM_INSTALL}` };
    const verdict = doctorVerdict('absent', line, EXPECTED);

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain(AGENT_BROWSER_BREW_INSTALL);
  });

  test('fails when the line passes although nothing is installed', () => {
    const verdict = doctorVerdict('absent', SYSTEM_LINE, EXPECTED);

    expect(verdict.text).toContain('the line is "pass", not "warn"');
  });
});
