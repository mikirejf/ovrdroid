import { describe, expect, test } from 'bun:test';

import { anyFailed, describeVerdicts } from '../busy-signal-report.ts';
import { copySelectVerdicts } from '../copy-select-report.ts';
import type { CopySelectEvidence } from '../copy-select-report.ts';

const STOCK_REPLY = [
  '⛬  Here is a quote:',
  '',
  '   │ A quoted paragraph that is long enough to wrap around the right edge',
  '   │ of the terminal.',
  '   │',
  '   │ - first item inside the quote',
  '   │   - nested item',
  '   │ │ a nested quote line',
  '',
  '   - A list item holding a quote:',
  '     │ quote inside a list item',
  '',
  ' End of reply.',
];

const PATCHED_REPLY = [
  '⛬  Here is a quote:',
  '',
  '   A quoted paragraph that is long enough to wrap around the right edge',
  '   of the terminal.',
  '',
  '   - first item inside the quote',
  '     - nested item',
  '   a nested quote line',
  '',
  '   - A list item holding a quote:',
  '     quote inside a list item',
  '',
  ' End of reply.',
];

const FOOTER = [' 1 config issue — /diagnostics'];

const STOCK_DRAFT = [
  ' Auto (High)',
  '╭──────────────────────────────╮',
  '│ > first draft line           │',
  '│   second draft line          │',
  '╰──────────────────────────────╯',
  ...FOOTER,
];

const PATCHED_DRAFT = [
  ' Auto (High)',
  '──────────────────────────────',
  '  > first draft line',
  '    second draft line',
  '──────────────────────────────',
  ...FOOTER,
];

const PATCHED: CopySelectEvidence = { reply: PATCHED_REPLY, draft: PATCHED_DRAFT };
const STOCK: CopySelectEvidence = { reply: STOCK_REPLY, draft: STOCK_DRAFT };

function failures(evidence: CopySelectEvidence): string[] {
  return copySelectVerdicts(evidence)
    .filter((entry) => !entry.pass)
    .map((entry) => entry.text);
}

describe('copySelectVerdicts', () => {
  test('a quote and a draft with no side glyphs pass in words', () => {
    const verdicts = copySelectVerdicts(PATCHED);
    expect(anyFailed(verdicts)).toBe(false);
    expect(describeVerdicts(verdicts)).toBe(
      [
        'pass  quote: selecting its 6 lines copies no box-drawing glyph',
        'pass  draft: selecting its 2 rows copies no box-drawing glyph',
      ].join('\n'),
    );
  });

  test('the rules above and below the draft are not part of what the draft selects', () => {
    expect(failures(PATCHED)).toEqual([]);
  });

  test('the stock quote bar and the stock box sides both fail, naming the glyph', () => {
    const verdicts = copySelectVerdicts(STOCK);
    expect(anyFailed(verdicts)).toBe(true);
    expect(describeVerdicts(verdicts)).toBe(
      [
        'FAIL  quote: selecting its 7 lines copies box-drawing glyphs: 7 of them carry │, e.g. "│ A quoted paragraph that is long enough to wrap around the "',
        'FAIL  draft: selecting its 2 rows copies box-drawing glyphs: 2 of them carry │, e.g. "│ > first draft line │"',
      ].join('\n'),
    );
  });

  test('a bar on the quote inside a list item alone fails the quote', () => {
    const reply = PATCHED_REPLY.map((line) =>
      line.includes('quote inside a list item') ? '     │ quote inside a list item' : line,
    );
    const found = failures({ ...PATCHED, reply });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('quote: selecting its 6 lines copies box-drawing glyphs: 1 of them');
  });

  test('a corner glyph on one draft row fails the draft and lists each glyph once', () => {
    const draft = PATCHED_DRAFT.map((line) => (line.includes('second') ? `${line} ╯` : line));
    const found = failures({ ...PATCHED, draft });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(
      'draft: selecting its 2 rows copies box-drawing glyphs: 1 of them carry ╯',
    );
  });

  test('a reply that never showed the quote fails instead of passing on nothing', () => {
    const found = failures({ ...PATCHED, reply: ['⛬  Here is a quote:'] });
    expect(found).toEqual(['quote: it never showed on the screen, so there was nothing to select']);
  });

  test('a draft that never reached the input box fails the same way', () => {
    const empty = ['──────', '  >', '──────'];
    expect(failures({ ...PATCHED, draft: empty })).toEqual([
      'draft: it never showed on the screen, so there was nothing to select',
    ]);
    expect(failures({ ...PATCHED, draft: [] })).toHaveLength(1);
  });
});
