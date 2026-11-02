import { describe, expect, test } from 'bun:test';

import {
  describeFindings,
  LONG_END,
  LONG_FILLER,
  LONG_START,
  NEW_LINE,
  OLD_LINE,
  readMidRun,
  readMidThinking,
  readStacked,
  readTranscript,
  TAIL_TALLY,
  TALLY,
  THINKING_BODY,
  THINKING_DELTAS,
  THINKING_ROW,
  THINKING_TEXT,
  TURN_REQUESTS,
} from '../stacked-report.ts';

const EDIT = ['  Edit /tmp/work/a.txt', '   ↳ +1 -1', `    1 - ${OLD_LINE}`, `    1 + ${NEW_LINE}`];

const FILLERS = Array.from({ length: 18 }, () => LONG_FILLER).join(' ');
const LONG_ROWS = [`   Thinking: ${LONG_START} ${FILLERS}`, `   ${FILLERS}`, `   ${FILLERS}`];

interface Overrides {
  head?: string[];
  tail?: string[];
  thinking?: string[];
  long?: string[];
}

function turn(overrides: Overrides = {}): string[] {
  return [
    '> Go through the files.',
    ...(overrides.thinking ?? [`   ${THINKING_ROW}`]),
    ...(overrides.head ?? [`  ${TALLY}`]),
    ...EDIT,
    ...(overrides.long ?? LONG_ROWS),
    ...(overrides.tail ?? [`  ${TAIL_TALLY}`]),
    '  ⛬ done',
  ];
}

const MID_RUN = ['> Go through the files.', `  ${TALLY}`, '   ↳ false', ' ⠙ Working...'];

const STREAMING = ['> Go through the files.', `  ${THINKING_ROW}`, ' ⠙ Thinking...'];
const TRANSCRIPT = ['Thinking:', ...THINKING_TEXT.replaceAll('**', '').split('\n')];

function capture(screen: string[], midRun: string[] | undefined = MID_RUN) {
  return { served: TURN_REQUESTS, screen, midRun, transcript: TRANSCRIPT, midThinking: STREAMING };
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
      'the reads, the grep and both commands share one line, in the order they ran',
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
        turn({
          head: ['  Read 1 file › Grep 1 search › Read 1 file ›', '  Execute 2 commands, 1 failed'],
        }),
      ),
    ).toEqual([]);
  });

  test('names a stale partial copy left in scrollback', () => {
    const [says] = failures(turn({ head: ['  Read 1 file', `  ${TALLY}`] }));
    expect(says).toBe("scrollback holds a stale partial copy of the line: 'Read 1 file'");
  });

  test('names a partial copy that sits directly above the full line with its own segments', () => {
    const [says] = failures(turn({ head: ['  Read 1 file › Grep 1 search', `  ${TALLY}`] }));
    expect(says).toContain("'Read 1 file › Grep 1 search'");
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

describe('the thinking row', () => {
  test('passes one summary row above the tally line', () => {
    expect(readStacked(capture(turn())).map((finding) => finding.says)).toContain(
      `the thinking block draws as one row, '${THINKING_ROW}'`,
    );
  });

  test('fails when the thinking block is not drawn at all', () => {
    const [says] = failures(turn({ thinking: [] }));
    expect(says).toContain('but scrollback has 0 such rows');
  });

  test('fails when the row shows twice, as a leftover continuation would', () => {
    const [says] = failures(turn({ thinking: [THINKING_ROW, THINKING_ROW] }));
    expect(says).toContain("2 such rows and 3 'Thinking:' labels");
  });

  test('fails when the body is drawn', () => {
    const [says] = failures(turn({ thinking: [THINKING_ROW, `   ${THINKING_BODY}`] }));
    expect(says).toContain(`the thinking body '${THINKING_BODY}' is drawn 1 time`);
  });

  test('fails when the row sits below the tool run', () => {
    const screen = turn({ thinking: [] });
    screen.splice(-1, 0, THINKING_ROW);
    expect(failures(screen)).toEqual([
      'the thinking row should sit above the tally line of the tool run that follows it',
    ]);
  });
});

describe('the long thinking block', () => {
  test('passes when the sentence fills three rows and its end is hidden', () => {
    expect(failures(turn())).toEqual([]);
  });

  test('fails on one truncated row, as the single-row display drew it', () => {
    const [says] = failures(turn({ long: [`   Thinking: ${LONG_START} ${LONG_FILLER} …`] }));
    expect(says).toContain('1 row of the sentence');
  });

  test('fails when the whole sentence shows, end included', () => {
    const [says] = failures(turn({ long: [...LONG_ROWS, `   ${FILLERS}`, `   ${LONG_END}.`] }));
    expect(says).toContain(`4 rows of the sentence, and shows its last word '${LONG_END}'`);
  });
});

describe('readMidThinking', () => {
  test('passes a frame with one summary row and no streamed body', () => {
    expect(readMidThinking(STREAMING).every((finding) => finding.pass)).toBe(true);
  });

  test('fails on a continuation row and the streamed body, as a cut thinking block leaves', () => {
    const [rows, body] = readMidThinking([...STREAMING, '  Thinking: I will read']);
    expect(rows?.says).toContain("holds 1 such row and 2 'Thinking:' labels");
    expect(body?.pass).toBe(false);
  });

  test('fails when no frame was captured', () => {
    expect(readMidThinking().every((finding) => !finding.pass)).toBe(true);
  });

  test('the deltas the stub streams join into the full thinking text', () => {
    expect(THINKING_DELTAS.join('')).toBe(THINKING_TEXT);
  });
});

describe('readTranscript', () => {
  test('passes a frame with the title and the body', () => {
    expect(readTranscript(TRANSCRIPT).pass).toBe(true);
  });

  test('fails when only the title shows, as a summary row would leave it', () => {
    const finding = readTranscript([THINKING_ROW]);
    expect(finding.pass).toBe(false);
    expect(finding.says).toContain('only the title');
  });

  test('fails when no frame was captured', () => {
    expect(readTranscript().pass).toBe(false);
  });
});

describe('call order', () => {
  test('fails on a tally that merges the two reads, as the per-tool tally drew it', () => {
    const [says] = failures(
      turn({ head: ['  Read 2 files · Grep 1 search · Execute 2 commands, 1 failed'] }),
    );
    expect(says).toContain(`no single line before the Edit reads '${TALLY}'`);
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
    const partial = 'Read 1 file › Grep 1 search › Read 1 file › Execute 1 command';
    const [says] = readMidRun([`  ${partial}`, '   ↳ true']);
    expect(says?.says).toContain(`'${partial}'`);
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
