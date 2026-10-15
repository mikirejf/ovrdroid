import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { digestKey, firstSentence, readDigestFolder } from '../digest-key.ts';
import { scriptDir } from './scripts.ts';

interface Digest {
  run: number;
  title: string;
  toolCalls: number;
  outTokens: number;
  compactions: number;
  brief: string;
  report: string;
}

const dir = scriptDir('digest-key');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function digest(parts: Digest): string {
  return [
    `# Run ${parts.run}: ${parts.title}`,
    'child=c parent=p model=m effort=medium project=x',
    `created=2026-10-10 22:46:28.093000 active_s=9 toolCalls=${parts.toolCalls} toolErrors=0 compactions=${parts.compactions} outTokens=${parts.outTokens}`,
    '',
    '## Brief',
    parts.brief,
    '',
    '## Report',
    parts.report,
    '',
    '## Parent reaction (next turns)',
    '',
    '## Later mentions',
    '',
  ].join('\n');
}

function run(parts: Partial<Digest> & Pick<Digest, 'run' | 'title'>): Digest {
  return {
    toolCalls: 10,
    outTokens: 100,
    compactions: 0,
    brief: 'Do the thing. Then stop.',
    report: 'Done.',
    ...parts,
  };
}

const FIXTURE: Digest[] = [
  run({ run: 1, title: 'Grunt: Recon deploy', toolCalls: 30 }),
  run({
    run: 2,
    title: 'Grunt: Browser check',
    toolCalls: 50,
    outTokens: 900,
    compactions: 2,
    report: 'NOT FOUND',
  }),
  run({
    run: 3,
    title: 'Grunt: Open pages',
    compactions: 1,
    brief: 'Run it.\n\n## Report\nPer flow: PASS or FAIL.',
    report: 'NOT FOUND\n',
  }),
  run({ run: 4, title: 'Grunt: Shoot screenshots', report: 'NOT FOUND, see notes' }),
  run({
    run: 82,
    title: 'Grunt: Inventory parts',
    brief: 'Repo: /a/.b/c (a git worktree). Do not edit.',
  }),
  run({
    run: 83,
    title: 'Grunt: Inventory more',
    toolCalls: 20,
    outTokens: 1200,
    brief: 'Repo: /a/.b/c. Read-only: do nothing.\n\nSecond paragraph.',
  }),
  run({
    run: 84,
    title: 'Grunt: Find overflow',
    compactions: 1,
    brief: 'Read-only lookup; do not edit repo files.\nMore lines follow.',
  }),
];

function folderOf(digests: readonly Digest[]): Map<string, string> {
  return new Map(digests.map((item) => [`${item.run}-x.md`, digest(item)]));
}

describe('digestKey', () => {
  test('computes every answer from the digest files', () => {
    expect(digestKey(folderOf(FIXTURE))).toEqual({
      compacted: 3,
      mostToolCalls: { run: 2, title: 'Grunt: Browser check', value: 50 },
      notFound: [
        { run: 2, title: 'Grunt: Browser check' },
        { run: 3, title: 'Grunt: Open pages' },
      ],
      browserTitles: [
        { run: 2, title: 'Grunt: Browser check' },
        { run: 3, title: 'Grunt: Open pages' },
        { run: 4, title: 'Grunt: Shoot screenshots' },
      ],
      mostOutTokens: { run: 83, value: 1200 },
      briefs: [
        { run: 82, sentence: 'Repo: /a/.b/c (a git worktree).' },
        { run: 83, sentence: 'Repo: /a/.b/c.' },
        { run: 84, sentence: 'Read-only lookup; do not edit repo files.' },
      ],
    });
  });

  test('fails loud when a brief run is missing from the folder', () => {
    expect(() => digestKey(folderOf(FIXTURE.slice(0, 4)))).toThrow('run 82 is not in the folder');
  });

  test('fails loud on a file that is not a digest', () => {
    expect(() => digestKey(new Map([['x.md', 'hello']]))).toThrow('x.md: not a run digest');
  });
});

describe('firstSentence', () => {
  test('ends at a dot followed by a space, a newline or the end, not at a dot inside a path', () => {
    expect(firstSentence('See /a/.b/c.d v1.2 now. Next.')).toBe('See /a/.b/c.d v1.2 now.');
    expect(firstSentence('One line.\nTwo.')).toBe('One line.');
    expect(firstSentence('No end here\n\nOther paragraph.')).toBe('No end here');
  });
});

describe('readDigestFolder', () => {
  test('reads the numbered markdown files in order', () => {
    const folder = path.join(dir, 'digests');
    mkdirSync(folder);
    writeFileSync(path.join(folder, '02-b.md'), 'two');
    writeFileSync(path.join(folder, '01-a.md'), 'one');
    writeFileSync(path.join(folder, 'notes.txt'), 'skip');
    expect([...readDigestFolder(folder)]).toEqual([
      ['01-a.md', 'one'],
      ['02-b.md', 'two'],
    ]);
  });
});
