import { randomInt } from 'node:crypto';

import { fieldsOf, worded } from './fields.ts';

export type Expectation = 'pass' | 'block';

export interface ShieldCase {
  path: string;
  line: string;
  expect: Expectation;
}

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const HEX = '0123456789abcdef';
const KUBE_SECRET_CHARS = 16;
const ANTHROPIC_KEY_CHARS = 40;
const SECRET_CHARS = 24;
const SECRET_MIN_DISTINCT = 14;
const DIGITALOCEAN_HEX_CHARS = 64;
const HEX_KEY_CHARS = 64;
const UUID_GROUPS = [8, 4, 4, 4, 12] as const;
const UUID_MIN_DISTINCT = 14;
const TICK = '`';
const DOLLAR = '$';
const AT = '@';
const DIGITALOCEAN_PREFIX = ['dop', 'v1', ''].join('_');

function randomFrom(alphabet: string, length: number): string {
  return Array.from({ length }, () => alphabet.charAt(randomInt(alphabet.length))).join('');
}

export function randomAlphanumeric(length: number): string {
  return randomFrom(ALPHANUMERIC, length);
}

export function randomHex(length: number): string {
  return randomFrom(HEX, length);
}

function randomUuid(): string {
  let uuid = '';
  while (new Set(uuid.replaceAll('-', '')).size < UUID_MIN_DISTINCT) {
    uuid = UUID_GROUPS.map((length) => randomHex(length)).join('-');
  }
  return uuid;
}

export function randomSecret(): string {
  let secret = randomAlphanumeric(SECRET_CHARS);
  while (new Set(secret).size < SECRET_MIN_DISTINCT) {
    secret = randomAlphanumeric(SECRET_CHARS);
  }
  return secret;
}

function passes(path: string, line: string): ShieldCase {
  return { path, line, expect: 'pass' };
}

function blocks(path: string, line: string): ShieldCase {
  return { path, line, expect: 'block' };
}

export const SHIELD_CASES: readonly ShieldCase[] = [
  passes(
    'probes/proxy.mjs',
    `export const u = (user, p) => ${TICK}http://${DOLLAR}{encodeURIComponent(user)}:${DOLLAR}{encodeURIComponent(p)}${AT}p.webshare.io:80${TICK};`,
  ),
  passes(
    'scripts/gen-env.sh',
    `DATABASE_URL=postgresql://triggeruser:${DOLLAR}{TRIGGER_PG_PASS}@db:5432/trigger`,
  ),
  passes(
    'convex/anticheat/reads/deviceReads.ts',
    'const DEVICE_KEY_SQL = `SELECT device_id FROM devices WHERE platform = ?`;',
  ),
  passes('.config/ghostty/config', 'keybind = ctrl+shift+t=new_tab'),
  passes('src/encode.ts', 'export function keyWordsFromBytes(key: Uint8Array) { return key }'),
  passes(
    'convex/money/__tests__/contract.test.ts',
    "const x = { idempotencyKey: 'abcDEF123456xyzQ' }",
  ),
  passes(
    'scripts/dump.ts',
    "const LOCAL_DB_URL = 'postgresql://postgres:Hq83kdPzW1@localhost:5432/x'",
  ),
  passes(
    'server/__tests__/boot.test.ts',
    "const h = 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='",
  ),
  passes('src/client.ts', `const apiKey = '${randomSecret()}'`),
  passes('src/__tests__/login.test.ts', `password: '${randomSecret()}'`),
  passes('docs/setup.md', `export API_TOKEN=${randomSecret()}`),
  passes('infisical/.env.example', `AUTH_SECRET=${randomSecret()}`),
  passes('tests/fixtures/page.html', `<meta name="x" content="x" data-token="${randomSecret()}">`),
  passes(
    'design-system/audit/typography.json',
    '  "styleToken": "typography.p22-mackinac-pro.h6-18-bold",',
  ),
  passes(
    'design-system/audit/headings.json',
    '  "styleToken": "typography.p22-mackinac-pro.h3-32-bold",',
  ),
  blocks('config/hex-key.json', `  "apiKey": "${randomHex(HEX_KEY_CHARS)}",`),
  blocks('config/uuid-key.json', `  "apiKey": "${randomUuid()}",`),
  blocks(
    'config/kube-join.json',
    `  "bootstrapToken": "abcdef.${randomFrom('0123456789', KUBE_SECRET_CHARS)}",`,
  ),
  blocks('.env', `OPENAI_API_KEY=${randomSecret()}`),
  blocks('.env.local', `STRIPE_SECRET_KEY=${randomSecret()}`),
  blocks('scripts/backup.sh', `PGPASSWORD=${randomSecret()} pg_dump mydb`),
  blocks('.env.production', `SECRET_KEY_BASE=${randomSecret()}`),
  blocks(
    '.agents/mcp.json',
    `{ "url": "postgres://admin:${randomSecret()}${AT}db.internal.acme.io/x" }`,
  ),
  blocks(
    'src/config.ts',
    `export const k = 'sk-ant-api03-${randomAlphanumeric(ANTHROPIC_KEY_CHARS)}'`,
  ),
  blocks(
    'src/do.ts',
    `export const t = '${DIGITALOCEAN_PREFIX}${randomHex(DIGITALOCEAN_HEX_CHARS)}'`,
  ),
];

export const SHIELD_COMMIT = 'git commit -m probe';

export const SHIELD_PROMPT =
  `Run exactly \`${SHIELD_COMMIT}\` once with your Execute tool, then stop. ` +
  'If it fails, do not retry it, do not fix anything and do not run any other command.';

export type ShieldOutcome =
  | 'committed'
  | 'blocked'
  | 'ambiguous'
  | 'unscannable'
  | 'failed'
  | 'not-run';

export interface ShieldReading {
  outcome: ShieldOutcome;
  text: string;
  locations: number;
  flagged: string[];
  patterns: string[];
}

interface ToolResult {
  isError: boolean;
  text: string;
}

const BLOCK_HEADER = /Droid-Shield detected potential secrets in (?<count>\d+) location/u;
const UNSCANNABLE = /Droid-Shield could not/u;
const EXIT_LINE = /\[Process exited with code (?<code>\d+)\]/u;
const BULLET = '  - ';
const ENTRY_PATH = /^(?<path>.+?):(?:\d+|\?)(?=[: ]|$)/u;
const FILES_HEADING = 'Files affected:';
const PATTERNS_HEADING = 'Detected patterns:';
const REVIEWED_HEADING = 'Droid-Shield reviewed deterministic finding(s):';
const CLASSIFIER_HEADING = 'Droid-Shield learned classifier warning(s):';
const DOWNGRADED = '(downgraded to warning)';

function bulletsAfter(text: string, heading: string): string[] {
  const start = text.indexOf(heading);
  if (start === -1) {
    return [];
  }
  const bullets: string[] = [];
  for (const line of text
    .slice(start + heading.length)
    .split('\n')
    .slice(1)) {
    if (!line.startsWith(BULLET)) {
      break;
    }
    bullets.push(line.slice(BULLET.length));
  }
  return bullets;
}

function pathsOf(entries: readonly string[]): string[] {
  return entries.flatMap((entry) => {
    const found = ENTRY_PATH.exec(entry)?.groups?.['path'];
    return found === undefined ? [] : [found];
  });
}

export function commitResult(stdout: string): ToolResult | undefined {
  const commits = new Set<string>();
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const event = fieldsOf(JSON.parse(line));
    const type = worded(event, 'type');
    if (
      type === 'tool_call' &&
      worded(fieldsOf(event.get('parameters')), 'command').includes(SHIELD_COMMIT)
    ) {
      commits.add(worded(event, 'id'));
    }
    if (type === 'tool_result' && commits.has(worded(event, 'id'))) {
      const failure = worded(fieldsOf(event.get('error')), 'message');
      return event.get('isError') === true
        ? { isError: true, text: failure }
        : { isError: false, text: worded(event, 'value') };
    }
  }
  return undefined;
}

function flaggedFiles(text: string): string[] {
  const patterns = bulletsAfter(text, PATTERNS_HEADING);
  const reviewed = bulletsAfter(text, REVIEWED_HEADING);
  const kept = new Set(
    pathsOf([...patterns, ...reviewed.filter((entry) => !entry.includes(DOWNGRADED))]),
  );
  const warnedOnly = new Set(
    pathsOf([
      ...reviewed.filter((entry) => entry.includes(DOWNGRADED)),
      ...bulletsAfter(text, CLASSIFIER_HEADING),
    ]).filter((file) => !kept.has(file)),
  );
  return bulletsAfter(text, FILES_HEADING).filter((file) => !warnedOnly.has(file));
}

function outcomeOf(result: ToolResult): ShieldOutcome {
  if (BLOCK_HEADER.test(result.text)) {
    return 'blocked';
  }
  if (UNSCANNABLE.test(result.text)) {
    return 'unscannable';
  }
  const code = EXIT_LINE.exec(result.text)?.groups?.['code'];
  return result.isError || (code !== undefined && code !== '0') ? 'failed' : 'committed';
}

export function readShield(stdout: string): ShieldReading {
  const result = commitResult(stdout);
  if (result === undefined) {
    return { outcome: 'not-run', text: '', locations: 0, flagged: [], patterns: [] };
  }
  const read = outcomeOf(result);
  const blocked = read === 'blocked';
  const locations = Number(BLOCK_HEADER.exec(result.text)?.groups?.['count'] ?? 0);
  const flagged = blocked ? flaggedFiles(result.text) : [];
  return {
    outcome: blocked && flagged.length !== locations ? 'ambiguous' : read,
    text: result.text,
    locations,
    flagged,
    patterns: blocked ? bulletsAfter(result.text, PATTERNS_HEADING) : [],
  };
}

export type Mistake = 'false block' | 'missed secret';

export interface CaseVerdict {
  shieldCase: ShieldCase;
  blocked: boolean;
  mistake: Mistake | undefined;
}

export function judgeCases(cases: readonly ShieldCase[], reading: ShieldReading): CaseVerdict[] {
  return cases.map((shieldCase) => {
    const blocked = reading.flagged.includes(shieldCase.path);
    const wanted = shieldCase.expect === 'block';
    let mistake: Mistake | undefined;
    if (blocked && !wanted) {
      mistake = 'false block';
    } else if (!blocked && wanted) {
      mistake = 'missed secret';
    }
    return { shieldCase, blocked, mistake };
  });
}

export function hasVerdict(reading: ShieldReading): boolean {
  return reading.outcome === 'committed' || reading.outcome === 'blocked';
}

export function countMistakes(verdicts: readonly CaseVerdict[]) {
  return {
    falseBlocks: verdicts.filter((verdict) => verdict.mistake === 'false block').length,
    missedSecrets: verdicts.filter((verdict) => verdict.mistake === 'missed secret').length,
  };
}

export interface ShieldRun {
  label: string;
  reading: ShieldReading;
}

export interface JudgedRun extends ShieldRun {
  verdicts: readonly CaseVerdict[];
}

function cell(verdict: CaseVerdict): string {
  const word = verdict.blocked ? 'BLOCKED' : 'PASSED';
  return verdict.mistake === undefined ? word : `${word} (${verdict.mistake})`;
}

function padded(columns: readonly (readonly string[])[]): string[] {
  const widths = columns.map((column) => Math.max(...column.map((text) => text.length)));
  const rows = Math.max(...columns.map((column) => column.length));
  return Array.from({ length: rows }, (_, row) =>
    columns
      .map((column, index) => (column[row] ?? '').padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd(),
  );
}

export function describeUnjudged(run: ShieldRun): string {
  const { outcome, text, locations, flagged } = run.reading;
  const reasons: Record<ShieldOutcome, string> = {
    committed: '',
    blocked: '',
    ambiguous: `Droid-Shield blocked ${locations} places but the reader can tie only ${flagged.length} files to them, so no case has a verdict`,
    unscannable: `Droid-Shield could not scan the staged files, so no case has a verdict: ${text}`,
    failed: `the commit failed for a reason other than Droid-Shield, so no case has a verdict: ${text}`,
    'not-run': 'the model never ran the commit, so no case has a verdict',
  };
  return `${run.label}: ${reasons[outcome]}`;
}

export function describeShield(cases: readonly ShieldCase[], runs: readonly JudgedRun[]): string {
  const columns = [
    ['case', ...cases.map((shieldCase) => shieldCase.path)],
    ['should', ...cases.map((shieldCase) => shieldCase.expect)],
    ...runs.map((run) => [run.label, ...run.verdicts.map((verdict) => cell(verdict))]),
  ];
  const lines = padded(columns);
  lines.push('');
  for (const run of runs) {
    const { falseBlocks, missedSecrets } = countMistakes(run.verdicts);
    lines.push(
      `${run.label}: ${falseBlocks} false blocks, ${missedSecrets} missed secrets`,
      `  Droid-Shield counted ${run.reading.locations} blocking locations in ${run.reading.flagged.length} files`,
      ...run.reading.patterns.map((pattern) => `  it printed: ${pattern}`),
    );
  }
  return lines.join('\n');
}
