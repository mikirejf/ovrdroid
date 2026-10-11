export const DEFAULT_TURNS = 150;
export const LAST_MARKER = 'RESUME-FIXTURE-LAST-REPLY';
const FIXTURE_MODEL = 'claude-opus-4-1-20250805';
const FIXTURE_START = Date.UTC(2026, 0, 1, 9, 0, 0);
const STEP_MS = 1500;
const ID_DIGITS = 12;

export interface FixtureOptions {
  id: string;
  cwd: string;
  owner: string;
  turns: number;
}

export interface Fixture {
  transcript: string;
  lastMarker: string;
  records: number;
}

interface ToolCall {
  name: string;
  input: Record<string, string>;
  output: string;
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, string> }
  | { type: 'tool_result'; tool_use_id: string; is_error: false; content: string };

const TOPICS = [
  'the retry queue',
  'the config loader',
  'the session cache',
  'the upload worker',
  'the billing report',
  'the search index',
  'the auth middleware',
] as const;

function topicOf(turn: number): string {
  return TOPICS[turn % TOPICS.length] ?? 'the module';
}

function tsBlock(turn: number): string {
  return [
    '```ts',
    `export function backoff${turn}(attempt: number): number {`,
    '  const base = 250;',
    '  const capped = Math.min(attempt, 6);',
    '  return base * 2 ** capped + Math.floor(Math.random() * base);',
    '}',
    '```',
  ].join('\n');
}

function pythonBlock(turn: number): string {
  return [
    '```python',
    `def summarise_${turn}(rows):`,
    '    totals = {}',
    '    for row in rows:',
    "        totals[row['key']] = totals.get(row['key'], 0) + row['value']",
    '    return sorted(totals.items(), key=lambda pair: -pair[1])',
    '```',
  ].join('\n');
}

function bashBlock(turn: number): string {
  return [
    '```bash',
    'set -euo pipefail',
    `for file in src/module-${turn}/*.ts; do`,
    '  wc -l "$file"',
    'done | sort -n | tail -5',
    '```',
  ].join('\n');
}

const CODE_BLOCKS = [tsBlock, pythonBlock, bashBlock] as const;

function codeBlockOf(turn: number): string {
  return (CODE_BLOCKS[turn % CODE_BLOCKS.length] ?? tsBlock)(turn);
}

function userText(turn: number): string {
  return `Turn ${turn}: look at ${topicOf(turn)} and tell me why it slows down under load. Keep the change small.`;
}

function toolCallOf(turn: number): ToolCall {
  const topic = topicOf(turn).replace('the ', '').replaceAll(' ', '-');
  const file = `src/${topic}/index-${turn}.ts`;
  const lines = Array.from(
    { length: 12 },
    (_, line) => `${String(line + 1).padStart(4)}  const value${line} = compute${turn}(${line});`,
  );
  const calls: readonly ToolCall[] = [
    { name: 'Read', input: { file_path: `/work/${file}` }, output: lines.join('\n') },
    {
      name: 'Execute',
      input: { command: `bun test src/${topic}`, riskLevel: 'low', summary: `Run ${topic} tests` },
      output: [
        `bun test v1.3.0`,
        '',
        `src/${topic}/__tests__/index.test.ts:`,
        ...Array.from({ length: 8 }, (_, test) => `(pass) case ${test + 1} for turn ${turn}`),
        '',
        ` 8 pass`,
        ` 0 fail`,
      ].join('\n'),
    },
    {
      name: 'Grep',
      input: { pattern: `compute${turn}`, path: '/work/src', output_mode: 'content' },
      output: Array.from(
        { length: 10 },
        (_, hit) => `/work/src/${topic}/part-${hit}.ts:${hit * 7 + 3}:  compute${turn}(input);`,
      ).join('\n'),
    },
  ];
  return calls[turn % calls.length] ?? { name: 'Read', input: {}, output: '' };
}

function replyText(turn: number, last: boolean): string {
  const topic = topicOf(turn);
  return [
    `I read ${topic} for turn ${turn}. The slow part is the loop that rebuilds its state on every call.`,
    '',
    '- It allocates a new map per request, so the garbage collector runs often.',
    '- It retries without a cap, so one bad upstream holds the queue.',
    `- The fix touches one function and keeps the public shape of ${topic}.`,
    '',
    codeBlockOf(turn),
    '',
    `With this change the hot path does less work. Run the tests again to confirm turn ${turn}.`,
    ...(last ? ['', LAST_MARKER] : []),
  ].join('\n');
}

function idOf(kind: number, index: number): string {
  return `00000000-0000-4000-${String(8000 + kind)}-${index.toString(16).padStart(ID_DIGITS, '0')}`;
}

export function resumeFixture(options: FixtureOptions): Fixture {
  const records: unknown[] = [
    {
      type: 'session_start',
      id: options.id,
      title: `ovrdroid resume fixture, ${options.turns} turns`,
      owner: options.owner,
      version: 2,
      cwd: options.cwd,
      isSessionTitleManuallySet: true,
    },
  ];
  let seq = 0;
  let parentId: string | undefined;

  const push = (role: 'user' | 'assistant', content: Block[], extra: Record<string, string>) => {
    const id = idOf(role === 'user' ? 1 : 2, seq);
    records.push({
      type: 'message',
      id,
      ...(parentId !== undefined && { parentId }),
      timestamp: new Date(FIXTURE_START + seq * STEP_MS).toISOString(),
      message: { role, content, ...extra },
      seq,
    });
    seq += 1;
    parentId = id;
    return id;
  };
  const assistant = {
    userMessageSource: 'cli_tui',
    modelId: FIXTURE_MODEL,
    reasoningEffort: 'medium',
  };

  for (let turn = 1; turn <= options.turns; turn++) {
    const turnId = push('user', [{ type: 'text', text: userText(turn) }], {
      userMessageSource: 'cli_tui',
      interactionMode: 'auto',
    });
    const call = toolCallOf(turn);
    const toolUseId = `toolu_fixture_${String(turn).padStart(6, '0')}`;
    push(
      'assistant',
      [
        { type: 'text', text: `I will check ${topicOf(turn)} first.` },
        { type: 'tool_use', id: toolUseId, name: call.name, input: call.input },
      ],
      assistant,
    );
    push(
      'user',
      [{ type: 'tool_result', tool_use_id: toolUseId, is_error: false, content: call.output }],
      {},
    );
    push('assistant', [{ type: 'text', text: replyText(turn, turn === options.turns) }], assistant);
    records.push({ type: 'agent_turn_outcome', turnId, reason: 'completed', resultKind: 'text' });
  }

  return {
    transcript: `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    lastMarker: LAST_MARKER,
    records: records.length,
  };
}
