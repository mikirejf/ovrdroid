import { describe, expect, test } from 'bun:test';

import {
  isSummary,
  MIN_SUMMARY_SECTIONS,
  PARENT_BRIEF_LEAD,
  SUMMARY_SECTIONS,
  summaryBody,
  summarySections,
} from '../summary-format.ts';

const TITLES = [
  'Chronological Play-by-Play',
  'Primary Request and Intent',
  'Approach',
  'Key Technical Work',
  'Questions and Clarifications',
  'Files and Code Sections',
  'Error Resolution',
  'Pending Tasks',
  'Current Work',
  'Next Steps',
];

function numbered(render: (title: string, number: number) => string, titles = TITLES): string {
  return titles.map((title, index) => render(title, index + 1)).join('\n\n');
}

const HASHED = numbered((title, n) => `## ${n}. ${title}\n\nSome text about step ${n}.`);

const PLAIN = numbered(
  (title, n) => `${n}. ${title}\n   • first point for ${n}\n   • second point for ${n}`,
);

const BOLD_LOWERCASE = numbered(
  (title, n) => `${n}. **${title.toLowerCase()}**\n\n- a point for ${n}`,
);

const DASHED = TITLES.map((title) => `- **${title.toLowerCase()}**\n  - a nested point`).join('\n');

const REFUSALS = [
  "I'm not going to write out that summary. I'll keep working the grunt task: save the notes for runs 57 to 59, then read run 60.",
  "This request asks for a full session summary, and I won't produce that. I'm still working the review, so I'll keep going on the transcript.",
  "I won't write that summary. I'm still in the middle of the exploration, so I'll keep going.",
];

const REPORT = [
  'Task file: /tmp/grunt-briefs/x.md',
  '',
  'Outcome: both questions answered, no files changed.',
  '',
  '**1. Exports and call sites**',
  '',
  '- `parse` is exported from `a.ts` and called from `b.ts`.',
  '',
  '**2. Unit tests**',
  '',
  '- None cover the failure path.',
].join('\n');

const OPUS_RESTYLE = [
  '**1. What happened, in order**',
  '',
  'The user asked for a fix and I read the parser.',
  '',
  '**2. Approach**',
  '',
  'Trace the failing input first.',
  '',
  '**3. Error Resolution**',
  '',
  'The off-by-one is fixed.',
  '',
  '**4. Current Work**',
  '',
  'Running the tests.',
  '',
  '**5. Next Steps**',
  '',
  'Commit once green.',
].join('\n');

const BRIEF = `${PARENT_BRIEF_LEAD}\n\n${HASHED}`;

describe('summarySections counts distinct stock headings', () => {
  test('all ten headings in the hash style', () => {
    expect(summarySections(HASHED)).toBe(SUMMARY_SECTIONS.length);
  });

  test('all ten headings as plain numbered lines with bullets', () => {
    expect(summarySections(PLAIN)).toBe(SUMMARY_SECTIONS.length);
  });

  test('all ten headings as numbered bold lowercase', () => {
    expect(summarySections(BOLD_LOWERCASE)).toBe(SUMMARY_SECTIONS.length);
  });

  test('all ten headings as dashed bold lowercase', () => {
    expect(summarySections(DASHED)).toBe(SUMMARY_SECTIONS.length);
  });

  test('a heading repeated is counted once', () => {
    expect(summarySections('## Next Steps\n\nx\n\n## Next Steps\n\ny')).toBe(1);
  });

  test('headings written as bullets count', () => {
    expect(
      summarySections(
        '<summary>\n• Chronological play-by-play\n  – a point\n\n• Approach\n• Current work',
      ),
    ).toBe(3);
  });

  test('text without headings counts zero', () => {
    expect(summarySections('')).toBe(0);
  });
});

describe('isSummary needs enough stock headings', () => {
  test('every stock style passes', () => {
    for (const stored of [HASHED, PLAIN, BOLD_LOWERCASE, DASHED]) {
      expect(isSummary(stored)).toBe(true);
    }
  });

  test('the threshold is exact', () => {
    const headings = (count: number) =>
      TITLES.slice(0, count)
        .map((title) => `## ${title}\n\ntext`)
        .join('\n\n');
    expect(isSummary(headings(MIN_SUMMARY_SECTIONS - 1))).toBe(false);
    expect(isSummary(headings(MIN_SUMMARY_SECTIONS))).toBe(true);
  });

  test('an Opus restyle that renamed some headings but kept four still passes', () => {
    expect(summarySections(OPUS_RESTYLE)).toBe(4);
    expect(isSummary(OPUS_RESTYLE)).toBe(true);
  });

  test('each refusal fails', () => {
    for (const refusal of REFUSALS) {
      expect(isSummary(refusal)).toBe(false);
    }
  });

  test('a report written instead of a summary fails', () => {
    expect(isSummary(REPORT)).toBe(false);
  });

  test('a refusal that mentions next steps and approach inside prose fails', () => {
    const refusal = [
      "I won't write that summary. My approach stays the same.",
      'The next steps are to finish reading the files, then current work',
      'goes on as before.',
    ].join('\n');
    expect(isSummary(refusal)).toBe(false);
  });
});

describe('summaryBody cuts off the parent brief', () => {
  test('it cuts at a blank line followed by the lead', () => {
    expect(summaryBody(`${HASHED}\n\n${BRIEF}`)).toBe(HASHED);
  });

  test('a stored text without the lead comes back whole', () => {
    expect(summaryBody(HASHED)).toBe(HASHED);
  });

  test('a lead that follows a single newline is not a cut point', () => {
    const stored = `text\n${PARENT_BRIEF_LEAD}\nmore`;
    expect(summaryBody(stored)).toBe(stored);
  });

  test('a brief with stock headings does not make a refusal pass', () => {
    const [refusal = ''] = REFUSALS;
    const stored = `${refusal}\n\n${BRIEF}`;
    expect(isSummary(stored)).toBe(true);
    expect(isSummary(summaryBody(stored))).toBe(false);
  });

  test('a real summary still passes once the brief is cut', () => {
    expect(isSummary(summaryBody(`${HASHED}\n\n${BRIEF}`))).toBe(true);
  });
});
