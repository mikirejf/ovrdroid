import type { DigestKey } from './digest-key.ts';

export const RUN_COUNT = 84;
export const ITEM_COUNT = 6;

const QUOTED = /"[^"]*"|“[^”]*”/gu;
const THOUSANDS = /(?<=\d),(?=\d{3}\b)/gu;
const TOTAL_PHRASE = new RegExp(`\\b(?:all|the|of)\\s+${RUN_COUNT}\\b`, 'gu');
const NUMBER = /(?<![\w./:#-])\d+(?![\w/%]|[.-]\d)/gu;
const QUOTE_MARKS = /["'`“”‘’]/gu;
const BOLD = /\*\*/gu;
const SPACES = /\s+/gu;

export interface ItemScore {
  item: number;
  score: number;
  reason: string;
}

export interface Grade {
  items: ItemScore[];
  total: number;
}

function markerOf(item: number): RegExp[] {
  return [
    new RegExp(
      `^[ \\t]{0,3}(?:#{1,6}[ \\t]+)?(?:\\*\\*)?(?:Item[ \\t]+)?${item}(?:[.):]\\*{0,2}|\\*\\*[.):]?)(?=[ \\t]|$)`,
      'u',
    ),
    new RegExp(
      `^[ \\t]{0,3}(?:#{1,6}[ \\t]+(?:\\*\\*)?(?:Item[ \\t]+)?|(?:\\*\\*)?Item[ \\t]+)${item}(?!\\d)\\**`,
      'u',
    ),
  ];
}

export function splitItems(reply: string): Map<number, string> {
  const lines = reply.split('\n');
  const starts: { item: number; line: number; marker: RegExp }[] = [];
  let cursor = 0;
  for (let item = 1; item <= ITEM_COUNT; item += 1) {
    for (let line = cursor; line < lines.length; line += 1) {
      const marker = markerOf(item).find((candidate) => candidate.test(lines[line] ?? ''));
      if (marker !== undefined) {
        starts.push({ item, line, marker });
        cursor = line + 1;
        break;
      }
    }
  }
  return new Map(
    starts.map(({ item, line, marker }, index) => {
      const end = starts[index + 1]?.line ?? lines.length;
      const body = [(lines[line] ?? '').replace(marker, ''), ...lines.slice(line + 1, end)];
      return [item, body.join('\n')];
    }),
  );
}

function numbersIn(text: string): number[] {
  const bare = text.replace(QUOTED, ' ').replace(TOTAL_PHRASE, ' ').replace(THOUSANDS, '');
  return [...bare.matchAll(NUMBER)].map((found) => Number(found[0]));
}

function runsIn(text: string): Set<number> {
  return new Set(numbersIn(text).filter((value) => value >= 1 && value <= RUN_COUNT));
}

function sorted(values: Iterable<number>): number[] {
  return [...values].toSorted((a, b) => a - b);
}

function normalized(text: string): string {
  return text.replace(BOLD, '').replace(QUOTE_MARKS, '').replace(SPACES, ' ').trim();
}

function missing(item: number): ItemScore {
  return { item, score: 0, reason: 'item not found in the reply' };
}

function gradeCount(reply: string, key: DigestKey): ItemScore {
  const said = numbersIn(reply).find((value) => value !== 0 && value !== RUN_COUNT);
  const reason = `said ${said ?? 'no number'}, key ${key.compacted}`;
  return { item: 1, score: said === key.compacted ? 1 : 0, reason };
}

function gradeRunAndValue(
  item: number,
  reply: string,
  expected: { run: number; value: number },
): ItemScore {
  const named = new Set(numbersIn(reply));
  const absent = [
    named.has(expected.run) ? undefined : `run ${expected.run}`,
    named.has(expected.value) ? undefined : `value ${expected.value}`,
  ].filter((part) => part !== undefined);
  const reason =
    absent.length === 0
      ? `named run ${expected.run} and value ${expected.value}`
      : `missing ${absent.join(' and ')}`;
  return { item, score: absent.length === 0 ? 1 : 0, reason };
}

function gradeRunSet(item: number, reply: string, expected: readonly number[]): ItemScore {
  const named = runsIn(reply);
  const key = new Set(expected);
  const shared = sorted(named).filter((run) => key.has(run));
  const missed = sorted(key).filter((run) => !named.has(run));
  const extra = sorted(named).filter((run) => !key.has(run));
  const union = shared.length + missed.length + extra.length;
  const score = union === 0 ? 1 : shared.length / union;
  const parts = [
    missed.length > 0 ? `missed runs ${missed.join(', ')}` : '',
    extra.length > 0 ? `extra runs ${extra.join(', ')}` : '',
  ].filter((part) => part !== '');
  return { item, score, reason: parts.length === 0 ? 'exact' : parts.join('; ') };
}

function gradeBriefs(reply: string, briefs: DigestKey['briefs']): ItemScore {
  const text = normalized(reply);
  const matched = briefs.filter(({ sentence }) => text.includes(normalized(sentence)));
  const missed = briefs.filter((brief) => !matched.includes(brief));
  const reason =
    missed.length === 0
      ? `matched runs ${matched.map(({ run }) => run).join(', ')}`
      : `missed runs ${missed.map(({ run }) => run).join(', ')}`;
  return { item: 6, score: matched.length / briefs.length, reason };
}

export function gradeReply(key: DigestKey, reply: string): Grade {
  const parts = splitItems(reply);
  const graders: [number, (text: string) => ItemScore][] = [
    [1, (text) => gradeCount(text, key)],
    [2, (text) => gradeRunAndValue(2, text, key.mostToolCalls)],
    [
      3,
      (text) =>
        gradeRunSet(
          3,
          text,
          key.notFound.map(({ run }) => run),
        ),
    ],
    [
      4,
      (text) =>
        gradeRunSet(
          4,
          text,
          key.browserTitles.map(({ run }) => run),
        ),
    ],
    [5, (text) => gradeRunAndValue(5, text, key.mostOutTokens)],
    [6, (text) => gradeBriefs(text, key.briefs)],
  ];
  const items = graders.map(([item, grade]) => {
    const text = parts.get(item);
    return text === undefined ? missing(item) : grade(text);
  });
  return { items, total: items.reduce((sum, { score }) => sum + score, 0) };
}

export function describeGrade(grade: Grade): string {
  const rows = grade.items.map(
    ({ item, score, reason }) => `item ${item}: ${score.toFixed(2)}  ${reason}`,
  );
  return [...rows, `total: ${grade.total.toFixed(2)} out of ${ITEM_COUNT}`].join('\n');
}
