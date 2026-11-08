import { describe, expect, test } from 'bun:test';

import {
  AGENT_BROWSER_BREW_INSTALL,
  AGENT_BROWSER_MISSING_MESSAGE,
  AGENT_BROWSER_NPM_INSTALL,
} from '../../patch/agent-browser-patches.ts';
import type { AgentBrowserCase, Expected, Observation } from '../agent-browser-report.ts';
import {
  agentBrowserCases,
  caseVerdict,
  describeCase,
  describeVerdicts,
  pathWithout,
  probeCommand,
  STALE_SCRIPT,
  toolResultIn,
} from '../agent-browser-report.ts';

const CALL = 'toolu_case';
const HOME = '/tmp/scratch/home';
const EXPECTED: Expected = { scratchHome: HOME, versionLine: 'agent-browser 0.41.2' };
const SYSTEM_RUN = '/Users/me/.local/bin/agent-browser\nagent-browser 0.41.2\nskills=\n';

function stream(...events: object[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

const FOREGROUND_SYSTEM: AgentBrowserCase = { placement: 'foreground', situation: 'system' };
const BACKGROUND_STALE: AgentBrowserCase = { placement: 'background', situation: 'stale' };
const FOREGROUND_ABSENT: AgentBrowserCase = { placement: 'foreground', situation: 'absent' };

function ran(overrides: Partial<Observation> = {}): Observation {
  return {
    result: { isError: false, text: '[Process exited with code 0]' },
    output: SYSTEM_RUN,
    marker: true,
    bundledBinary: undefined,
    bundledToolsDir: false,
    ...overrides,
  };
}

function refused(overrides: Partial<Observation> = {}): Observation {
  return {
    result: {
      isError: true,
      text: `Error: Error executing command: ${AGENT_BROWSER_MISSING_MESSAGE}`,
    },
    output: undefined,
    marker: false,
    bundledBinary: undefined,
    bundledToolsDir: false,
    ...overrides,
  };
}

describe('agentBrowserCases', () => {
  test('covers every situation in both a foreground and a background Execute', () => {
    const cases = agentBrowserCases().map(
      ({ placement, situation }) => `${placement} ${situation}`,
    );

    expect(cases.toSorted()).toEqual([
      'background absent',
      'background stale',
      'background system',
      'foreground absent',
      'foreground stale',
      'foreground system',
    ]);
  });
});

describe('probeCommand', () => {
  test('marks that it ran, then writes what the installed agent-browser answers to one file', () => {
    expect(probeCommand({ marker: '/w/ran.marker', output: '/w/output.txt' })).toBe(
      "touch '/w/ran.marker'; { command -v agent-browser; agent-browser --version; echo \"skills=$AGENT_BROWSER_SKILLS_DIR\"; } > '/w/output.txt' 2>&1",
    );
  });

  test('quotes a path holding a single quote', () => {
    expect(probeCommand({ marker: "/w/it's", output: '/w/o' })).toContain("touch '/w/it'\\''s';");
  });

  test('names agent-browser as a command word, which is what Droid looks for', () => {
    const command = probeCommand({ marker: '/m', output: '/o' });

    expect(/(?:^|[\s;|&()])agent-browser(?:\s|$)/u.test(command)).toBe(true);
  });
});

describe('pathWithout', () => {
  test('drops the directories that hold the binary and empty entries, keeping the order', () => {
    const holders = new Set(['/home/me/.local/bin']);

    expect(
      pathWithout('/usr/bin::/home/me/.local/bin:/bin', (directory) => holders.has(directory)),
    ).toBe('/usr/bin:/bin');
  });

  test('leaves nothing when every directory holds it', () => {
    expect(pathWithout('/a:/b', () => true)).toBe('');
  });
});

describe('toolResultIn', () => {
  test('reads the output of a tool call that ran', () => {
    const output = stream(
      { type: 'tool_call', id: CALL },
      { type: 'tool_result', id: CALL, isError: false, value: 'hi\n[Process exited with code 0]' },
    );

    expect(toolResultIn(output, CALL)).toEqual({
      isError: false,
      text: 'hi\n[Process exited with code 0]',
    });
  });

  test('reads the message of a tool call that failed', () => {
    const output = stream({
      type: 'tool_result',
      id: CALL,
      isError: true,
      error: { type: 'tool_error', message: 'Error: nope' },
    });

    expect(toolResultIn(output, CALL)).toEqual({ isError: true, text: 'Error: nope' });
  });

  test('ignores the result of another call and lines that are not JSON', () => {
    const output = `not json\n${stream({ type: 'tool_result', id: 'other', isError: false, value: 'x' })}`;

    expect(toolResultIn(output, CALL)).toBeUndefined();
  });

  test('finds nothing in an empty run', () => {
    expect(toolResultIn('', CALL)).toBeUndefined();
  });
});

describe('caseVerdict for an installed agent-browser', () => {
  test('passes when the system binary answered, with no skills directory and nothing extracted', () => {
    const verdict = caseVerdict(FOREGROUND_SYSTEM, ran(), EXPECTED);

    expect(verdict).toEqual({
      pass: true,
      text: 'a foreground Execute finds the installed agent-browser',
    });
  });

  test('fails when the command resolved to a binary inside the scratch home', () => {
    const output = `${HOME}/.factory/bin/agent-browser\nagent-browser 0.41.2\nskills=\n`;
    const verdict = caseVerdict(FOREGROUND_SYSTEM, ran({ output }), EXPECTED);

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain(
      `resolved agent-browser to "${HOME}/.factory/bin/agent-browser"`,
    );
  });

  test('does not mistake a sibling directory that shares the home prefix for the home', () => {
    const output = `${HOME}-other/bin/agent-browser\nagent-browser 0.41.2\nskills=\n`;

    expect(caseVerdict(FOREGROUND_SYSTEM, ran({ output }), EXPECTED).pass).toBe(true);
  });

  test('fails when it is the bundled version that answered', () => {
    const output = '/Users/me/.local/bin/agent-browser\nagent-browser 0.37.1\nskills=\n';
    const verdict = caseVerdict(FOREGROUND_SYSTEM, ran({ output }), EXPECTED);

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain(
      'printed "agent-browser 0.37.1", not the installed "agent-browser 0.41.2"',
    );
  });

  test('fails when the skills directory variable was set', () => {
    const output = `/usr/bin/agent-browser\nagent-browser 0.41.2\nskills=${HOME}/.factory/tools\n`;
    const verdict = caseVerdict(FOREGROUND_SYSTEM, ran({ output }), EXPECTED);

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('AGENT_BROWSER_SKILLS_DIR was set');
  });

  test('fails when Droid refused the command, and says why', () => {
    const verdict = caseVerdict(
      FOREGROUND_SYSTEM,
      ran({ result: { isError: true, text: 'Error: boom' }, output: undefined }),
      EXPECTED,
    );

    expect(verdict.text).toContain('Droid refused the command: Error: boom');
  });

  test('fails when the command left no output', () => {
    const verdict = caseVerdict(FOREGROUND_SYSTEM, ran({ output: undefined }), EXPECTED);

    expect(verdict.text).toContain('the command left no output file');
  });

  test('fails when Droid extracted a bundled binary or its skill files', () => {
    const verdict = caseVerdict(
      FOREGROUND_SYSTEM,
      ran({ bundledBinary: '\u007FELF', bundledToolsDir: true }),
      EXPECTED,
    );

    expect(verdict.text).toContain('extracted a bundled agent-browser into its bin folder');
    expect(verdict.text).toContain('extracted the bundled agent-browser skill files');
  });

  test('says it was not exercised when Droid never answered the call', () => {
    const verdict = caseVerdict(
      FOREGROUND_SYSTEM,
      ran({ result: undefined, output: undefined }),
      EXPECTED,
    );

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toStartWith('not exercised: Droid never answered the Execute call');
  });
});

describe('caseVerdict past a stale copy', () => {
  test('passes while the planted copy is untouched', () => {
    expect(caseVerdict(BACKGROUND_STALE, ran({ bundledBinary: STALE_SCRIPT }), EXPECTED).pass).toBe(
      true,
    );
  });

  test('fails when the planted copy was overwritten by the bundled one', () => {
    const verdict = caseVerdict(BACKGROUND_STALE, ran({ bundledBinary: 'ELF' }), EXPECTED);

    expect(verdict.text).toContain('was overwritten, so Droid extracted its bundled one');
  });

  test('fails when the planted copy was deleted', () => {
    const verdict = caseVerdict(BACKGROUND_STALE, ran({ bundledBinary: undefined }), EXPECTED);

    expect(verdict.text).toContain('the planted stale copy in the Droid bin folder was deleted');
  });

  test('fails when the stale copy is what ran', () => {
    const output = `${HOME}/.factory/bin/agent-browser\nstale\nskills=\n`;
    const verdict = caseVerdict(
      BACKGROUND_STALE,
      ran({ output, bundledBinary: STALE_SCRIPT }),
      EXPECTED,
    );

    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('printed "stale"');
  });
});

describe('caseVerdict with no agent-browser installed', () => {
  test('passes when the call failed with the install steps and nothing ran', () => {
    expect(caseVerdict(FOREGROUND_ABSENT, refused(), EXPECTED).pass).toBe(true);
  });

  test('names both ways to install in the message it expects', () => {
    expect(AGENT_BROWSER_MISSING_MESSAGE).toContain(AGENT_BROWSER_NPM_INSTALL);
    expect(AGENT_BROWSER_MISSING_MESSAGE).toContain(AGENT_BROWSER_BREW_INSTALL);
  });

  test('fails when the call succeeded', () => {
    const verdict = caseVerdict(FOREGROUND_ABSENT, ran(), EXPECTED);

    expect(verdict.text).toContain('the tool call did not fail');
    expect(verdict.text).toContain('the command ran anyway');
  });

  test('fails when the marker shows the command ran before the refusal', () => {
    const verdict = caseVerdict(FOREGROUND_ABSENT, refused({ marker: true }), EXPECTED);

    expect(verdict.text).toContain('the command ran anyway');
  });

  test('fails when the error leaves out an install command', () => {
    const verdict = caseVerdict(
      FOREGROUND_ABSENT,
      refused({ result: { isError: true, text: 'Error: agent-browser is not installed' } }),
      EXPECTED,
    );

    expect(verdict.text).toContain(AGENT_BROWSER_NPM_INSTALL);
    expect(verdict.text).toContain(AGENT_BROWSER_BREW_INSTALL);
  });

  test('fails when Droid extracted its bundled copy before refusing', () => {
    const verdict = caseVerdict(FOREGROUND_ABSENT, refused({ bundledToolsDir: true }), EXPECTED);

    expect(verdict.text).toContain('extracted the bundled agent-browser skill files');
  });
});

describe('describeVerdicts', () => {
  test('puts ok before a passing case and FAIL before a failing one, one case a line', () => {
    const lines = describeVerdicts([
      { pass: false, text: 'first' },
      { pass: true, text: 'second' },
    ]).split('\n');

    expect(lines).toEqual(['FAIL  first', 'ok    second']);
  });

  test('describes a case by where it ran', () => {
    expect(describeCase(BACKGROUND_STALE)).toStartWith('a background Execute');
  });
});
