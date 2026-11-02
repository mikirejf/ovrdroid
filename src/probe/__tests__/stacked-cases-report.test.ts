import { describe, expect, test } from 'bun:test';

import {
  APPROVAL_COMMAND,
  CASE_REQUESTS,
  CASE_TALLY,
  readApproval,
  readSwitch,
} from '../stacked-cases-report.ts';

const PROMPT = ['   Go through the files.'];
const DONE = ['⛬  done'];
const PENDING = [
  ...PROMPT,
  '   Read 1 file',
  '    ↳ .../tmp/work/a.txt',
  `   Execute ${APPROVAL_COMMAND}                                  deny-listed`,
  `  ↳ ${APPROVAL_COMMAND}`,
  '│ Droid would like to run a deny-listed command │',
  '│  Yes, allow                                    │',
  '│  No, cancel                                    │',
];
const JOINED = [...PROMPT, `   ${CASE_TALLY}`, ...DONE];
const SPLIT = [
  ...PROMPT,
  '   Read 1 file',
  `   Execute ${APPROVAL_COMMAND}                                  deny-listed`,
  '    ↳ stacked-approval',
  '   Read 1 file',
  ...DONE,
];
const EXPANDED = [
  ...PROMPT,
  '   Read 1 file',
  '    ↳ .../tmp/work/a.txt',
  '   Execute true',
  '    ↳ Command completed successfully',
  '   Read 1 file',
  '    ↳ .../tmp/work/b.txt',
  ...DONE,
];

function passes(findings: { pass: boolean }[]): boolean[] {
  return findings.map((finding) => finding.pass);
}

describe('an Execute that needs approval', () => {
  test('passes when the prompt shows below the open line and the call then joins it', () => {
    const findings = readApproval({ served: CASE_REQUESTS, pending: PENDING, screen: JOINED });
    expect(passes(findings)).toEqual([true, true, true]);
  });

  test('fails when the approved call stays a block that splits the line', () => {
    const findings = readApproval({ served: CASE_REQUESTS, pending: PENDING, screen: SPLIT });
    expect(passes(findings)).toEqual([true, false, false]);
    expect(findings[1]?.says).toContain("'Read 1 file', 'Read 1 file'");
  });

  test('fails when no prompt showed while it waited', () => {
    const findings = readApproval({
      served: CASE_REQUESTS,
      pending: PENDING.filter((line) => !line.includes('Yes, allow')),
      screen: JOINED,
    });
    expect(findings[0]?.pass).toBe(false);
  });

  test('reports a turn that never ran', () => {
    const findings = readApproval({ served: 1, pending: [], screen: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.says).toContain('never ran');
  });
});

describe('switching the display mode', () => {
  test('passes when each switch redraws the history in its mode, once', () => {
    const findings = readSwitch({
      served: CASE_REQUESTS,
      stacked: JOINED,
      expanded: EXPANDED,
      back: JOINED,
    });
    expect(passes(findings)).toEqual([true, true, true]);
  });

  test('fails when switching back keeps the expanded history', () => {
    const findings = readSwitch({
      served: CASE_REQUESTS,
      stacked: JOINED,
      expanded: EXPANDED,
      back: EXPANDED,
    });
    expect(passes(findings)).toEqual([true, true, false]);
  });

  test('fails when scrollback keeps the old shape above the new one', () => {
    const findings = readSwitch({
      served: CASE_REQUESTS,
      stacked: JOINED,
      expanded: [...JOINED, ...EXPANDED],
      back: [...EXPANDED, ...JOINED],
    });
    expect(passes(findings)).toEqual([true, false, false]);
  });
});
