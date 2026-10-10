import { describe, expect, test } from 'bun:test';

import {
  commitResult,
  countMistakes,
  describeShield,
  describeUnjudged,
  hasVerdict,
  judgeCases,
  randomAlphanumeric,
  randomHex,
  randomSecret,
  readShield,
  SHIELD_CASES,
  SHIELD_COMMIT,
} from '../shield.ts';

const STOP_TEXT =
  'STOP: Do NOT retry this command against the same changes or attempt to work around this check.';

function blockedText(options: {
  count: number;
  files: string[];
  patterns: string[];
  extra?: string;
}): string {
  return (
    `Error: Error executing command: Droid-Shield detected potential secrets in ${options.count} location(s):\n\n` +
    `Files affected:\n${options.files.map((file) => `  - ${file}`).join('\n')}\n\n` +
    `Detected patterns:\n${options.patterns.map((entry) => `  - ${entry}`).join('\n')}\n` +
    `${options.extra ?? ''}\n\n${STOP_TEXT}`
  );
}

function stream(...events: object[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

function commitCall(id: string, command: string = SHIELD_COMMIT) {
  return { type: 'tool_call', id, toolName: 'Execute', parameters: { command } };
}

function failedResult(id: string, message: string) {
  return { type: 'tool_result', id, isError: true, error: { type: 'tool_error', message } };
}

function blockedStream(text: string): string {
  return stream({ type: 'system', subtype: 'init' }, commitCall('c1'), failedResult('c1', text), {
    type: 'completion',
    finalText: 'blocked',
  });
}

describe('commitResult finds what the commit printed', () => {
  test('it skips the result of any other command', () => {
    const lines = stream(
      commitCall('a', 'git status'),
      { type: 'tool_result', id: 'a', isError: false, value: 'clean' },
      commitCall('b'),
      { type: 'tool_result', id: 'b', isError: false, value: '[main abc] probe' },
    );
    expect(commitResult(lines)).toEqual({ isError: false, text: '[main abc] probe' });
  });

  test('a failed tool call gives its error message', () => {
    expect(commitResult(stream(commitCall('x'), failedResult('x', 'boom')))).toEqual({
      isError: true,
      text: 'boom',
    });
  });

  test('a run that never committed gives nothing', () => {
    expect(commitResult(stream({ type: 'completion' }))).toBeUndefined();
  });
});

describe('readShield', () => {
  test('a block lists the files and the patterns it printed', () => {
    const reading = readShield(
      blockedStream(
        blockedText({
          count: 2,
          files: ['.env', 'src/config.ts'],
          patterns: [
            '.env:1: OPENAI_API_KEY=*********************',
            "src/config.ts:1: export const k = '*****'",
          ],
        }),
      ),
    );
    expect(reading.outcome).toBe('blocked');
    expect(reading.locations).toBe(2);
    expect(reading.flagged).toEqual(['.env', 'src/config.ts']);
    expect(reading.patterns).toHaveLength(2);
  });

  test('a file named only in a warning section was not blocked', () => {
    const extra =
      '\nDroid-Shield reviewed deterministic finding(s):\n  - a/soft.ts:3 (downgraded to warning): looks like a test value\n' +
      '\nDroid-Shield learned classifier warning(s):\n  - b/maybe.ts:9: possible secret\n';
    const reading = readShield(
      blockedStream(
        blockedText({
          count: 1,
          files: ['.env', 'a/soft.ts', 'b/maybe.ts'],
          patterns: ['.env:1: KEY=****'],
          extra,
        }),
      ),
    );
    expect(reading.flagged).toEqual(['.env']);
  });

  test('a downgraded finding in a file that also blocks keeps the file blocked', () => {
    const extra =
      '\nDroid-Shield reviewed deterministic finding(s):\n  - .env:2 (downgraded to warning): fine\n';
    const reading = readShield(
      blockedStream(
        blockedText({ count: 1, files: ['.env'], patterns: ['.env:1: KEY=****'], extra }),
      ),
    );
    expect(reading.flagged).toEqual(['.env']);
  });

  test('warnings past the five it prints leave the reading ambiguous, not blocked', () => {
    const warned = Array.from({ length: 6 }, (_unused, at) => `warn${at}.ts`);
    const extra = `\nDroid-Shield learned classifier warning(s):\n${warned
      .slice(0, 5)
      .map((file) => `  - ${file}:1: possible secret`)
      .join('\n')}\n`;
    const reading = readShield(
      blockedStream(
        blockedText({
          count: 1,
          files: ['.env', ...warned],
          patterns: ['.env:1: KEY=****'],
          extra,
        }),
      ),
    );
    expect(reading.outcome).toBe('ambiguous');
    expect(reading.locations).toBe(1);
    expect(reading.flagged).toHaveLength(2);
    expect(hasVerdict(reading)).toBe(false);
    expect(describeUnjudged({ label: 'stock', reading })).toBe(
      'stock: Droid-Shield blocked 1 places but the reader can tie only 2 files to them, so no case has a verdict',
    );
  });

  test('a clean commit blocks nothing', () => {
    const reading = readShield(
      stream(commitCall('c'), {
        type: 'tool_result',
        id: 'c',
        isError: false,
        value: '[main (root-commit) 5e6eea9] probe\n\n\n[Process exited with code 0]',
      }),
    );
    expect(reading.outcome).toBe('committed');
    expect(reading.flagged).toEqual([]);
  });

  test('a diff too large to scan is neither blocked nor committed', () => {
    const reading = readShield(
      stream(
        commitCall('c'),
        failedResult(
          'c',
          'Error: Droid-Shield could not scan a diff this large: exceeded the configured buffer size',
        ),
      ),
    );
    expect(reading.outcome).toBe('unscannable');
    expect(hasVerdict(reading)).toBe(false);
  });

  test('a commit that git refused is a failure, not a pass', () => {
    const reading = readShield(
      stream(commitCall('c'), {
        type: 'tool_result',
        id: 'c',
        isError: false,
        value: 'nothing to commit\n\n\n[Process exited with code 1]',
      }),
    );
    expect(reading.outcome).toBe('failed');
    expect(hasVerdict(reading)).toBe(false);
  });

  test('a model that never ran the commit is reported as such', () => {
    expect(readShield(stream({ type: 'completion' })).outcome).toBe('not-run');
  });
});

describe('judgeCases', () => {
  const cases = [
    { path: 'ok.ts', line: 'x', expect: 'pass' as const },
    { path: 'noisy.ts', line: 'x', expect: 'pass' as const },
    { path: '.env', line: 'x', expect: 'block' as const },
    { path: 'quiet.ts', line: 'x', expect: 'block' as const },
  ];
  const reading = readShield(
    blockedStream(
      blockedText({
        count: 2,
        files: ['noisy.ts', '.env'],
        patterns: ['noisy.ts:1: a', '.env:1: b'],
      }),
    ),
  );

  test('a blocked pass case is a false block and a passed must-block case is a missed secret', () => {
    const verdicts = judgeCases(cases, reading);
    expect(verdicts.map((verdict) => verdict.mistake)).toEqual([
      undefined,
      'false block',
      undefined,
      'missed secret',
    ]);
    expect(countMistakes(verdicts)).toEqual({ falseBlocks: 1, missedSecrets: 1 });
  });

  test('the report says the two counts in words', () => {
    const verdicts = judgeCases(cases, reading);
    const text = describeShield(cases, [{ label: 'stock', reading, verdicts }]);
    expect(text).toContain('stock: 1 false blocks, 1 missed secrets');
    expect(text).toContain('BLOCKED (false block)');
    expect(text).toContain('PASSED (missed secret)');
    expect(text).toContain('Droid-Shield counted 2 blocking locations in 2 files');
  });

  test('two binaries sit side by side in one table', () => {
    const clean = readShield(
      stream(commitCall('c'), { type: 'tool_result', id: 'c', isError: false, value: 'done' }),
    );
    const text = describeShield(cases, [
      { label: 'stock', reading, verdicts: judgeCases(cases, reading) },
      { label: 'patched', reading: clean, verdicts: judgeCases(cases, clean) },
    ]);
    const header = text.split('\n').at(0) ?? '';
    expect(header).toMatch(/case\s+should\s+stock\s+patched/u);
    expect(text).toContain('patched: 0 false blocks, 2 missed secrets');
  });

  test('a run with no verdict says why', () => {
    const unread = readShield(stream({ type: 'completion' }));
    expect(describeUnjudged({ label: 'stock', reading: unread })).toBe(
      'stock: the model never ran the commit, so no case has a verdict',
    );
  });
});

const DOLLAR = '$';

function lineOf(file: string): string {
  return SHIELD_CASES.find((shieldCase) => shieldCase.path === file)?.line ?? '';
}

const SECRET = '([A-Za-z0-9]{24})';

const GENERATED_LINES: readonly (readonly [string, RegExp])[] = [
  ['src/client.ts', new RegExp(`^const apiKey = '${SECRET}'$`, 'u')],
  ['src/__tests__/login.test.ts', new RegExp(`^password: '${SECRET}'$`, 'u')],
  ['docs/setup.md', new RegExp(`^export API_TOKEN=${SECRET}$`, 'u')],
  ['infisical/.env.example', new RegExp(`^AUTH_SECRET=${SECRET}$`, 'u')],
  ['tests/fixtures/page.html', new RegExp(`data-token="${SECRET}">$`, 'u')],
  ['.env', new RegExp(`^OPENAI_API_KEY=${SECRET}$`, 'u')],
  ['.env.local', new RegExp(`^STRIPE_SECRET_KEY=${SECRET}$`, 'u')],
  ['.env.production', new RegExp(`^SECRET_KEY_BASE=${SECRET}$`, 'u')],
  ['.agents/mcp.json', new RegExp(`admin:${SECRET}@db\\.internal\\.acme\\.io/`, 'u')],
];

describe('the case list', () => {
  test('every case has its own file', () => {
    const paths = SHIELD_CASES.map((shieldCase) => shieldCase.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test('each secret-like value is 24 letters and digits with at least 14 distinct', () => {
    for (const [file, pattern] of GENERATED_LINES) {
      const value = pattern.exec(lineOf(file))?.[1];
      expect(value, file).toBeDefined();
      expect(new Set(value).size, file).toBeGreaterThanOrEqual(14);
    }
  });

  test('every run makes new values', () => {
    expect(new Set(GENERATED_LINES.map(([file]) => lineOf(file))).size).toBe(
      GENERATED_LINES.length,
    );
  });

  test('the values from parts keep the shapes the brief names', () => {
    expect(lineOf('scripts/gen-env.sh')).toContain(`triggeruser:${DOLLAR}{TRIGGER_PG_PASS}`);
    expect(lineOf('probes/proxy.mjs')).toContain(`http://${DOLLAR}{encodeURIComponent(user)}`);
  });

  test('both kinds of case are present', () => {
    expect(SHIELD_CASES.some((shieldCase) => shieldCase.expect === 'pass')).toBe(true);
    expect(SHIELD_CASES.some((shieldCase) => shieldCase.expect === 'block')).toBe(true);
  });

  test('the Anthropic key is 40 random letters and digits after its prefix', () => {
    expect(lineOf('src/config.ts')).toMatch(/sk-ant-api03-[A-Za-z0-9]{40}'$/u);
  });

  test('the JSON keys are 64 hex digits and a UUID with at least 14 distinct digits', () => {
    expect(lineOf('config/hex-key.json')).toMatch(/"apiKey": "[a-f0-9]{64}",$/u);
    const uuid = /"(?<uuid>[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})",$/u.exec(
      lineOf('config/uuid-key.json'),
    )?.groups?.['uuid'];
    expect(new Set(uuid?.replaceAll('-', '')).size).toBeGreaterThanOrEqual(14);
  });

  test('the DigitalOcean token is its prefix and 64 lower-case hex digits', () => {
    expect(lineOf('src/do.ts')).toMatch(/'dop_v1_[a-f0-9]{64}'$/u);
  });

  test('random strings have the length asked for and differ between calls', () => {
    expect(randomAlphanumeric(12)).toMatch(/^[A-Za-z0-9]{12}$/u);
    expect(randomAlphanumeric(30)).not.toBe(randomAlphanumeric(30));
    expect(randomHex(64)).toMatch(/^[a-f0-9]{64}$/u);
  });

  test('a random secret always clears the distinct-character floor', () => {
    for (let run = 0; run < 500; run += 1) {
      expect(new Set(randomSecret()).size).toBeGreaterThanOrEqual(14);
    }
  });
});
