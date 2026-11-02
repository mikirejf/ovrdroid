import { describe, expect, test } from 'bun:test';

import {
  describeFindings,
  NEW_LINE,
  OLD_LINE,
  readMidRun,
  readStacked,
  TAIL_TALLY,
  TALLY,
  TURN_REQUESTS,
} from '../stacked-report.ts';

const EDIT = ['  Edit /tmp/work/a.txt', '   ↳ +1 -1', `    1 - ${OLD_LINE}`, `    1 + ${NEW_LINE}`];

function turn(overrides: { head?: string[]; tail?: string[] } = {}): string[] {
  return [
    '> Go through the files.',
    ...(overrides.head ?? [`  ${TALLY}`]),
    ...EDIT,
    ...(overrides.tail ?? [`  ${TAIL_TALLY}`]),
    '  ⛬ done',
  ];
}

const MID_RUN = ['> Go through the files.', `  ${TALLY}`, '   ↳ false', ' ⠙ Working...'];

function capture(screen: string[], midRun: string[] | undefined = MID_RUN) {
  return { served: TURN_REQUESTS, screen, midRun };
}

function failures(screen: string[], midRun?: string[]): string[] {
  return readStacked(capture(screen, midRun))
    .filter((finding) => !finding.pass)
    .map((finding) => finding.says);
}

describe('readStacked', () => {
  test('passes a capture with one tally line, an inline edit and one tail line', () => {
    const findings = readStacked(capture(turn()));
    expect(findings.filter((finding) => !finding.pass)).toEqual([]);
    expect(findings.map((finding) => finding.says)).toContain(
      'the reads, the grep and both commands share one line',
    );
  });

  test("accepts Droid's own wording for the edit stats line", () => {
    const worded = turn().map((line) =>
      line.includes('+1 -1') ? '   ↳ Succeeded. File edited. (+1 added, -1 removed)' : line,
    );
    expect(failures(worded)).toEqual([]);
  });

  test('still passes when the tally wraps between segments', () => {
    expect(
      failures(
        turn({ head: ['  Read 2 files · Grep 1 search ·', '  Execute 2 commands, 1 failed'] }),
      ),
    ).toEqual([]);
  });

  test('names a stale partial copy left in scrollback', () => {
    const [says] = failures(turn({ head: ['  Read 1 file', `  ${TALLY}`] }));
    expect(says).toBe("scrollback holds a stale partial copy of the line: 'Read 1 file'");
  });

  test('names a partial copy that sits directly above the full line with its own segments', () => {
    const [says] = failures(turn({ head: ['  Read 2 files · Grep 1 search', `  ${TALLY}`] }));
    expect(says).toContain("'Read 2 files · Grep 1 search'");
  });

  test('names a leftover subtitle line after the turn ended', () => {
    const [says] = failures(turn({ tail: [`  ${TAIL_TALLY}`, '   ↳ c.txt'] }));
    expect(says).toBe("a ↳ subtitle line is still on screen after the turn ended: '↳ c.txt'");
  });

  test('does not read the edit stats line as a leftover subtitle', () => {
    expect(failures(turn()).join(' ')).not.toContain('subtitle');
  });

  test('fails on an Execute block with a header', () => {
    const says = failures(turn({ head: ['  Execute false', '    exit code 1', `  ${TALLY}`] }));
    expect(says).toEqual(["Execute is drawn as its own block, with a header: 'Execute false'"]);
  });

  test('says when the line never formed', () => {
    const says = failures(turn({ head: ['  Read a.txt', '  Read b.txt'] }));
    expect(says[0]).toContain(`no single line before the Edit reads '${TALLY}'`);
  });

  test('fails when the edit shows twice', () => {
    const [says] = failures([...turn(), ...EDIT]);
    expect(says).toContain('2 Edit headers');
  });

  test('fails when the tail line is missing', () => {
    expect(failures(turn({ tail: [] }))).toEqual([
      "after the Edit scrollback should hold 'Read 1 file' once, and holds no tally line",
    ]);
  });

  test('fails loudly when the turn never ran', () => {
    const findings = readStacked({ served: 2, screen: [] });
    expect(findings).toEqual([
      {
        pass: false,
        says: `the turn never ran, so nothing was tested: the stub model answered 2 of ${TURN_REQUESTS} requests`,
      },
    ]);
  });

  test('fails when no mid-run frame was captured', () => {
    const findings = readStacked({ served: TURN_REQUESTS, screen: turn() });
    expect(findings.at(-1)?.pass).toBe(false);
  });
});

describe('readMidRun', () => {
  test('passes a frame with the counts so far and the latest call under them', () => {
    expect(readMidRun(MID_RUN).every((finding) => finding.pass)).toBe(true);
  });

  test('fails when the subtitle line is missing', () => {
    const [, subtitle] = readMidRun([`  ${TALLY}`, ' ⠙ Working...']);
    expect(subtitle?.pass).toBe(false);
  });

  test('fails when the tally shows fewer counts than the calls made', () => {
    const [says] = readMidRun(['  Read 2 files · Grep 1 search · Execute 1 command', '   ↳ true']);
    expect(says?.says).toContain("'Read 2 files · Grep 1 search · Execute 1 command'");
  });

  test('fails on a stale partial copy in the frame', () => {
    const [says] = readMidRun(['  Read 1 file', ...MID_RUN]);
    expect(says?.pass).toBe(false);
  });
});

describe('describeFindings', () => {
  test('marks each finding ok or FAIL', () => {
    expect(
      describeFindings([
        { pass: true, says: 'fine' },
        { pass: false, says: 'broken' },
      ]),
    ).toBe('ok    fine\nFAIL  broken');
  });
});
