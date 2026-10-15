import { describe, expect, test } from 'bun:test';

import type { Usage } from '../anthropic.ts';
import type { Arm } from '../compaction-replay-plan.ts';
import type { SavedReply } from '../compaction-saved.ts';
import { NO_REPLIES, variantsReport } from '../compaction-variants-report.ts';
import type { ModelPrice } from '../prices.ts';
import { REFUSAL, SUMMARY } from './compaction-replay-harness.ts';

const DOLLAR_PER_TOKEN = 1_000_000;

const PRICE: ModelPrice = {
  droidId: 'model-x',
  provider: 'anthropic',
  modelId: 'model-x',
  input: DOLLAR_PER_TOKEN,
  output: 2 * DOLLAR_PER_TOKEN,
  cacheRead: DOLLAR_PER_TOKEN / 10,
  cacheWrite5m: DOLLAR_PER_TOKEN,
  cacheWrite1h: 2 * DOLLAR_PER_TOKEN,
};

const OWN_LAYOUT = `# Summary of the conversation\n\n${'The session read many files. '.repeat(20)}`;

type Kind = 'summary' | 'refusal' | 'tool' | 'own-layout' | 'error';

interface Spec {
  arm?: Arm;
  row?: number;
  run?: number;
  kind?: Kind;
  warm?: boolean;
  usage?: Partial<Usage>;
}

const CONTENT: Record<Kind, unknown[]> = {
  summary: [{ type: 'text', text: SUMMARY }],
  refusal: [{ type: 'text', text: REFUSAL }],
  tool: [
    { type: 'text', text: 'Next.' },
    { type: 'tool_use', name: 'Read', input: {} },
  ],
  'own-layout': [{ type: 'text', text: OWN_LAYOUT }],
  error: [],
};

function reply({
  arm = 'reuse',
  row = 1,
  run = 1,
  kind = 'summary',
  warm = false,
  usage,
}: Spec = {}) {
  const failed = kind === 'error';
  const saved: SavedReply = {
    row,
    arm,
    run,
    warm,
    model: 'model-x',
    latencyMs: 10,
    content: CONTENT[kind],
    stopReason: failed ? '' : 'end_turn',
    usage: failed
      ? undefined
      : {
          inputTokens: 10,
          cacheRead: 90,
          cacheWrite: 0,
          write5m: 0,
          write1h: 0,
          outputTokens: 5,
          ...usage,
        },
    error: failed ? '529 Overloaded' : undefined,
  };
  return saved;
}

function many(count: number, spec: Spec, kinds: Kind[]): SavedReply[] {
  return Array.from({ length: count }, (_unused, at) =>
    reply({ ...spec, run: at + 1, kind: kinds[at] ?? 'summary' }),
  );
}

function cells(line: string | undefined): string[] {
  return (line ?? '').trim().split(/\s{2,}/u);
}

function rowFor(lines: string[], arm: string, from = 0): string[] {
  const start = lines.indexOf('all rows') + from;
  return cells(lines.slice(start).find((line) => line.startsWith(arm)));
}

function headingCells(lines: string[]): string[] {
  return cells(lines[lines.indexOf('all rows') + 1]);
}

describe('variantsReport counts outcomes per arm', () => {
  const replies = [
    reply({ run: 1 }),
    reply({ run: 2, kind: 'refusal' }),
    reply({ run: 3, kind: 'tool' }),
    reply({ run: 4, kind: 'own-layout' }),
    reply({ run: 5, kind: 'error' }),
    reply({ run: 0, warm: true, kind: 'refusal' }),
  ];
  const lines = variantsReport(replies, PRICE);

  test('the table has one column per count and the warm-up is left out', () => {
    expect(headingCells(lines).slice(0, 8)).toEqual([
      'arm',
      'n',
      'summary',
      'own-layout',
      'refusal',
      'by tool',
      'error',
      'refusal rate',
    ]);
    expect(rowFor(lines, 'reuse').slice(0, 8)).toEqual([
      'reuse',
      '5',
      '1',
      '1',
      '2',
      '1',
      '1',
      '50%',
    ]);
  });

  test('the refusal rate counts answered requests only, with a Wilson interval', () => {
    expect(rowFor(lines, 'reuse')[8]).toBe('15-85%');
  });

  test('a row section repeats the table for each row', () => {
    expect(lines.filter((line) => line.startsWith('row '))).toEqual(['row 1']);
  });
});

describe('variantsReport tests each arm against reuse', () => {
  const reuse = many(
    40,
    { arm: 'reuse' },
    Array.from({ length: 21 }, (): Kind => 'refusal'),
  );
  const mention = many(40, { arm: 'no-mention' }, ['refusal', 'tool', 'refusal']);
  const lines = variantsReport([...reuse, ...mention], PRICE);

  test('the finding line says the counts, the interval and the p-value in words', () => {
    expect(lines).toContain(
      'no-mention refused 3 of 40 (8%, 3-20%), against reuse 21 of 40 (p<0.001)',
    );
  });

  test('the table carries p against reuse, and the baseline has none', () => {
    expect(rowFor(lines, 'no-mention')[9]).toBe('p<0.001');
    expect(rowFor(lines, 'reuse')[9]).toBe('-');
  });

  test('a close call gets a plain p-value', () => {
    const close = variantsReport(
      [
        ...many(10, { arm: 'reuse' }, ['refusal', 'refusal', 'refusal']),
        ...many(10, { arm: 'system' }, ['refusal', 'refusal']),
      ],
      PRICE,
    );
    expect(close).toContain('system refused 2 of 10 (20%, 6-51%), against reuse 3 of 10 (p=1.000)');
  });
});

describe('variantsReport prices what was sent', () => {
  test('cache share, mean output tokens and mean cost per request', () => {
    const lines = variantsReport(
      [
        reply({
          run: 1,
          usage: { inputTokens: 10, cacheRead: 90, cacheWrite: 0, outputTokens: 4 },
        }),
        reply({
          row: 2,
          usage: { inputTokens: 10, cacheRead: 0, cacheWrite: 90, outputTokens: 6 },
        }),
      ],
      PRICE,
    );
    expect(rowFor(lines, 'reuse').slice(10, 13)).toEqual(['45%', '5', '$69.50000']);
  });

  test('1 hour cache writes use the 1 hour price', () => {
    const lines = variantsReport(
      [
        reply({
          usage: { inputTokens: 0, cacheRead: 0, cacheWrite: 10, write1h: 10, outputTokens: 0 },
        }),
      ],
      PRICE,
    );
    expect(rowFor(lines, 'reuse')[12]).toBe('$20.00000');
  });

  test('a compaction costs the arm request plus one stock request when the reply is not a summary', () => {
    const usage = { inputTokens: 1, cacheRead: 0, cacheWrite: 0, outputTokens: 0 };
    const lines = variantsReport(
      [
        reply({ arm: 'reuse', run: 1, usage }),
        reply({ arm: 'reuse', run: 2, kind: 'refusal', usage }),
        reply({ arm: 'stock', run: 1, usage: { ...usage, inputTokens: 10 } }),
      ],
      PRICE,
    );
    expect(rowFor(lines, 'reuse').slice(12)).toEqual(['$1.00000', '$6.00000']);
    expect(rowFor(lines, 'stock').slice(12)).toEqual(['$10.00000', '$10.00000']);
  });

  test('stock is priced cold, its replayed cache reads counted as 1 hour writes', () => {
    const lines = variantsReport(
      [
        reply({
          arm: 'stock',
          usage: { inputTokens: 1, cacheRead: 90, cacheWrite: 0, outputTokens: 0 },
        }),
      ],
      PRICE,
    );
    expect(rowFor(lines, 'stock').slice(10, 13)).toEqual(['0%', '0', '$181.00000']);
  });

  test("later replies are priced with the cache the arm's first request of the row met", () => {
    const lines = variantsReport(
      [
        reply({
          arm: 'system',
          run: 2,
          usage: { inputTokens: 0, cacheRead: 100, cacheWrite: 0, outputTokens: 0 },
        }),
        reply({
          arm: 'system',
          run: 1,
          usage: { inputTokens: 0, cacheRead: 10, cacheWrite: 90, outputTokens: 0 },
        }),
      ],
      PRICE,
    );
    expect(rowFor(lines, 'system').slice(10, 13)).toEqual(['10%', '0', '$91.00000']);
  });

  test('without a stock arm the expected cost is unknown', () => {
    const lines = variantsReport([reply({ kind: 'refusal' })], PRICE);
    expect(rowFor(lines, 'reuse')[13]).toBe('-');
  });
});

describe('variantsReport derives reuse plus retry from reuse runs', () => {
  const usage = { inputTokens: 1, cacheRead: 0, cacheWrite: 0, outputTokens: 0 };
  const stock = reply({ arm: 'stock', usage: { ...usage, inputTokens: 10 } });

  const retry = (kinds: Kind[]): string | undefined => {
    const runs = kinds.map((kind, at) => reply({ run: at + 1, kind, usage }));
    return variantsReport([...runs, stock], PRICE).find((line) => line.startsWith('reuse+retry'));
  };

  test('the first reply stands when it is a summary, so the pair costs one request', () => {
    expect(retry(['summary', 'refusal'])).toBe(
      'reuse+retry: 1 pairs, both replies failed in 0 (0%, 0-79%), those fall back to stock; expected cost per compaction $1.00000',
    );
  });

  test('a failed first reply is retried and costs two requests', () => {
    expect(retry(['refusal', 'summary'])).toContain('failed in 0');
    expect(retry(['refusal', 'summary'])).toContain('$2.00000');
  });

  test('a pair that fails twice falls back to stock', () => {
    expect(retry(['refusal', 'error'])).toContain('failed in 1 (100%, 21-100%)');
    expect(retry(['refusal', 'error'])).toContain('$11.00000');
  });

  test('runs pair as 1 with 2 and 3 with 4, and a leftover run is ignored', () => {
    expect(retry(['summary', 'summary', 'refusal', 'refusal', 'refusal'])).toContain('2 pairs');
  });

  test('one run makes no pair', () => {
    expect(retry(['summary'])).toContain('needs two reuse runs');
  });
});

describe('variantsReport edge cases', () => {
  test('only warm-ups gives a plain sentence', () => {
    expect(variantsReport([reply({ warm: true })], PRICE)).toEqual([`${NO_REPLIES}.`]);
    expect(variantsReport([], PRICE)).toEqual([`${NO_REPLIES}.`]);
  });

  test('a row with only errors shows dashes instead of a rate', () => {
    const lines = variantsReport([reply({ kind: 'error' })], PRICE);
    expect(rowFor(lines, 'reuse').slice(6, 10)).toEqual(['1', '-', '-', '-']);
  });
});
