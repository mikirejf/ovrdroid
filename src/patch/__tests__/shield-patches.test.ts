// oxlint-disable no-template-curly-in-string
import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { findMarker } from '../patches.ts';
import { EXTRA_PREFIX_RULES, shieldPatches } from '../shield-patches.ts';
import { freeNames } from '../tokens.ts';
import { patchNamed, payloadFunction } from './payload.ts';

const PATH_PATCH = patchNamed(shieldPatches, 'shield-code-paths-skip-guessing-rules');

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(shieldPatches.map((patch) => [patch.name, patch] as const))('%s', (_name, patch) => {
    const known = new Set(
      [patch.find, patch.until ?? '', ...(patch.lookups ?? [])].flatMap((text) => freeNames(text)),
    );
    const stray = freeNames(patch.replace).filter(
      (name) => !name.startsWith('$OD') && !known.has(name),
    );
    expect(stray).toEqual([]);
  });
});

interface Finding {
  ruleId: string;
  start: number;
  end: number;
  blocking: boolean;
  guessing: boolean;
}

type LineMatcher = (line: string) => Finding[];

type Search = (cL: LineMatcher, P: { content: string }, m: string) => Finding | undefined;

const search = payloadFunction<Parameters<Search>, ReturnType<Search>>(
  ['cL', 'P', 'm'],
  `return ${PATH_PATCH.replace}`,
);

function blocksAt(path: string, finding: Finding): boolean {
  return search(() => [finding], { content: 'line' }, path) !== undefined;
}

const GUESSING: Finding = { ruleId: 'x', start: 0, end: 1, blocking: true, guessing: true };
const EXACT_PREFIX: Finding = { ...GUESSING, guessing: false };

describe('guessing rules are off for code, test, fixture and doc paths', () => {
  test.each([
    'src/a.ts',
    'src/A.TSX',
    'a.js',
    'a.jsx',
    'a.mjs',
    'a.cjs',
    'a.mts',
    'a.cts',
    'tools/run.py',
    'cmd/main.go',
    'src/lib.rs',
    'a.rb',
    'A.java',
    'A.kt',
    'A.swift',
    'a.c',
    'a.cc',
    'a.cpp',
    'a.h',
    'a.hpp',
    'A.cs',
    'a.php',
    'A.scala',
    'a.lua',
    'App.vue',
    'A.svelte',
    'a.dart',
    'a.ex',
    'a.exs',
    'a.css',
    'a.scss',
    'README.md',
    'a.mdx',
    'notes.txt',
    'a.rst',
    'index.html',
    'index.htm',
    'a/__tests__/x.json',
    'a/__fixtures__/x.yaml',
    'fixtures/x.env',
    'a/Fixtures/x.env',
    'test/a.sh',
    'tests/a',
    'a/TESTS/a.toml',
    'docs/x.json',
    'a/docs/b/c.yaml',
    'a.test.json',
    'b.spec.yaml',
    'c.test-support.json',
    'a/b.TEST.json',
    '.env.example',
    'infisical/.env.example',
    '.env.sample',
    '.env.template',
    '.ENV.EXAMPLE',
    String.raw`"b/src/caf\303\251.ts"`,
    String.raw`"b/__tests__/x\303\251.json"`,
    String.raw`"b/caf\303\251.test.json"`,
    '"b/.env.example"',
    String.raw`"tests/caf\303\251.json"`,
  ])('%s passes', (path) => {
    expect(blocksAt(path, GUESSING)).toBe(false);
  });

  test.each([
    '.env',
    '.env.local',
    '.env.production',
    '.agents/mcp.json',
    'config/settings.yaml',
    'pyproject.toml',
    'Dockerfile',
    'deploy.sh',
    'Makefile',
    'schema.sql',
    '.config/ghostty/config',
    'a/contest/x.json',
    'testing/x.json',
    'doc/x.json',
    'latest.json',
    'a.testing.json',
    '.env.examples',
    '.env.example.bak',
    'src/a.ts.json',
    'a.ts/b.json',
    String.raw`"b/caf\303\251.env"`,
    String.raw`"b/config/\303\251.json"`,
    '"b/.env.examples"',
  ])('%s keeps the guessing rules', (path) => {
    expect(blocksAt(path, GUESSING)).toBe(true);
  });

  test.each(['src/a.ts', 'README.md', 'a/__tests__/x.json', '.env.example', '.env', 'a.json'])(
    '%s keeps the exact-prefix rules',
    (path) => {
      expect(blocksAt(path, EXACT_PREFIX)).toBe(true);
    },
  );

  test('a finding that does not block stays unblocking', () => {
    expect(blocksAt('.env', { ...GUESSING, blocking: false })).toBe(false);
  });
});

async function stockApp(target: string): Promise<App | undefined> {
  let app: App;
  try {
    app = readApp(await Bun.file(target).bytes());
  } catch {
    return undefined;
  }
  return findMarker(app[0].text) === undefined ? app : undefined;
}

const stock = (await stockApp(INSTALLED_DROID)) ?? (await stockApp(backupPath(INSTALLED_DROID)));

const SCANNER_ANCHOR = '"(?<name>(?<!\\\\w)(?=\\\\w*?(?:key|token|secret|pass"';

const LINE_MATCHER =
  /function (?<name>[\w$]+)\(\w+\)\{let \w+=\w+\.replace\(\w+,\(\w+\)=>" "\.repeat\(/u;

const REDACTOR = /function [\w$]+\(\w+\)\{if\(!\w+\)return\{success:!0,value:\w+\};try\{/u;

function scannerText(app: App): string {
  const module = app.find((candidate) => candidate.text.includes(SCANNER_ANCHOR));
  if (module === undefined) {
    throw new Error('no module carries the secret-scanner rules');
  }
  return module.text;
}

function lineMatcherIn(app: App): LineMatcher {
  const text = scannerText(app);
  const rules = text.indexOf(SCANNER_ANCHOR);
  const name = LINE_MATCHER.exec(text.slice(rules))?.groups?.['name'];
  const end = text.slice(rules).search(REDACTOR);
  if (name === undefined || end === -1) {
    throw new Error('the secret-scanner line matcher is not where the tests expect it');
  }
  const body = text.slice(text.lastIndexOf('function ', rules), rules + end);
  // SAFETY: the body is the shipped scanner, from its rule helpers up to the redactor that follows the line matcher.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(`${body};return ${name}`)() as LineMatcher;
}

function ruleIdsIn(text: string): string[] {
  return [...text.matchAll(/(?:\bid:|\bSe\()"(?<id>[a-z0-9-]+)"/gu)].flatMap(
    (match) => match.groups?.['id'] ?? [],
  );
}

function blocks(match: LineMatcher, path: string, line: string): boolean {
  return search(match, { content: line }, path) !== undefined;
}

const SAMPLE = 'Hq83kdPzW1xLm0QaZt7';
const SHORT_SAMPLE = 'Hq83kdPzW1xLm0Qa';
const ANTHROPIC_KEY = `${['sk', 'ant', ''].join('-')}aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC2dF4hJ6k`;

type Case = readonly [line: string, path: string];

const PASSES: readonly Case[] = [
  ['http://${encodeURIComponent(user)}:${encodeURIComponent(p)}@p.webshare.io:80', 'a.json'],
  ['DATABASE_URL=postgresql://u:${TRIGGER_PG_PASS}@host', '.env'],
  ['const DEVICE_KEY_SQL = `SELECT a FROM devices`', 'convex/anticheat/reads/deviceReads.ts'],
  ['keybind = ctrl+shift+t=new_tab', '.config/ghostty/config'],
  ['export function keyWordsFromBytes(key: Uint8Array) {', 'src/encode.ts'],
  ["idempotencyKey: 'abcDEF123456xyz'", 'convex/money/__tests__/x.test.ts'],
  [
    `const LOCAL_DB_URL = 'postgresql://postgres:${SHORT_SAMPLE}@localhost:5432/x'`,
    'scripts/dump.ts',
  ],
  [`AUTH_SECRET=${SHORT_SAMPLE}`, 'infisical/.env.example'],
  [`keybind=${SAMPLE}`, '.env'],
];

const PASSES_BY_PATH: readonly Case[] = [
  [`const apiKey = '${SAMPLE}'`, 'src/a.ts'],
  [`password = "${SAMPLE}"`, 'README.md'],
  [`ENV API_KEY ${SAMPLE}`, 'tools/build.py'],
  [`apiKey: '${SAMPLE}'`, 'docs/guide.json'],
  [`API_KEY=${SAMPLE}`, 'src/App.vue'],
];

const BLOCKS: readonly Case[] = [
  [`OPENAI_API_KEY=${SAMPLE}`, '.env'],
  [`"url": "postgres://admin:${SHORT_SAMPLE}@db.internal.acme.io/x"`, '.agents/mcp.json'],
  [`const key = "${ANTHROPIC_KEY}"`, 'src/config.ts'],
  [`STRIPE_SECRET_KEY=${SAMPLE}`, '.env.local'],
  [`API_KEY=${SAMPLE}`, 'deploy.sh'],
  [`API_KEY=${SAMPLE}`, 'schema.sql'],
  [ANTHROPIC_KEY, '.env.example'],
  [ANTHROPIC_KEY, 'docs/guide.md'],
];

const HEX = '0123456789abcdef';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const LOWER_DIGITS = `${LOWER}0123456789`;
const UPPER_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALNUM = `${LOWER}${LOWER.toUpperCase()}0123456789`;
const BASE64 = `${ALNUM}+/`;
const WORD = `${ALNUM}_-`;

function fill(alphabet: string, length: number): string {
  return Array.from(
    { length },
    (_unused, at) => alphabet[(at * 7 + Math.floor(at / 5)) % alphabet.length],
  ).join('');
}

const PYPI_PREFIX = 'pypi-AgEIcHlwaS5vcmc';

const EXAMPLES = {
  'aws-access-token': `AKIA${fill(BASE32, 16)}`,
  'aws-bedrock-key': `ABSK${fill(BASE64, 120)}`,
  'digitalocean-access-token': `doo_v1_${fill(HEX, 64)}`,
  'digitalocean-pat': `dop_v1_${fill(HEX, 64)}`,
  'digitalocean-refresh-token': `dor_v1_${fill(HEX, 64)}`,
  'databricks-token': `dapi${fill(HEX, 32)}`,
  'flyio-token': `fo1_${fill(WORD, 43)}`,
  'grafana-cloud-token': `glc_${fill(BASE64, 40)}`,
  'grafana-service-token': `glsa_${fill(ALNUM, 32)}_${fill(HEX, 8)}`,
  'terraform-cloud-token': `${fill(LOWER_DIGITS, 14)}.atlasv1.${fill(`${LOWER_DIGITS}-_=`, 65)}`,
  'heroku-token-v2': `HRKU-AA${fill(WORD, 58)}`,
  'huggingface-org-token': `api_org_${fill(LOWER, 34)}`,
  'linear-token': `lin_api_${fill(ALNUM, 40)}`,
  'postman-token': `PMAK-${fill(HEX, 24)}-${fill(HEX, 34)}`,
  'pulumi-token': `pul-${fill(HEX, 40)}`,
  'pypi-upload-token': `${PYPI_PREFIX}${fill(WORD, 60)}`,
  'sentry-org-token': `sntrys_eyJpYXQiO${fill(BASE64, 20)}LCJyZWdpb25fdXJs${fill(BASE64, 20)}_${fill(BASE64, 43)}`,
  'sentry-user-token': `sntryu_${fill(HEX, 64)}`,
  'shopify-access-token': `shpat_${fill(HEX, 32)}`,
  'shopify-custom-access-token': `shpca_${fill(HEX, 32)}`,
  'shopify-private-app-token': `shppa_${fill(HEX, 32)}`,
  'shopify-shared-secret': `shpss_${fill(HEX, 32)}`,
  'anthropic-admin-key': `sk-ant-admin01-${fill(WORD, 93)}AA`,
  'vault-batch-token': `hvb.${fill(WORD, 150)}`,
  'vault-service-token': `hvs.${fill(WORD, 100)}`,
  'onepassword-secret-key': `A3-${fill(UPPER_DIGITS, 6)}-${fill(UPPER_DIGITS, 11)}-${fill(UPPER_DIGITS, 5)}-${fill(UPPER_DIGITS, 5)}-${fill(UPPER_DIGITS, 5)}`,
  'cloudflare-user-api-token': `cfut_${fill(ALNUM, 40)}${fill(HEX, 8)}`,
  'cloudflare-account-api-token': `cfat_${fill(ALNUM, 40)}${fill(HEX, 8)}`,
} satisfies Record<string, string>;

const LOOK_ALIKES = [
  'import { re_render } from "react-dom"',
  'const dapi_version = 3',
  'see https://example.com/docs',
  'run pul-request again',
  'AKIA',
  'fo1_',
  'lin_api_key_name',
  'hvs.example',
  'sk-ant-admin01-',
  'HRKU-AA',
  'shpat_',
  'glc_token',
  `dop_v1_${fill(HEX, 63)}`,
  `dop_v1_${fill(HEX, 65)}`,
  `AKIA${fill(BASE32, 15)}`,
  `x${EXAMPLES['pulumi-token']}`,
];

function sampleLine(token: string): string {
  return `const sample = "${token}"`;
}

if (stock !== undefined) {
  describe('the patched scanner on real lines', () => {
    const stockMatcher = lineMatcherIn(stock);
    const patchedMatcher = lineMatcherIn(patchSource(stock, shieldPatches));

    test.each([...PASSES, ...PASSES_BY_PATH])('%s in %s passes', (line, path) => {
      expect(blocks(patchedMatcher, path, line)).toBe(false);
    });

    test.each(BLOCKS)('%s in %s blocks', (line, path) => {
      expect(blocks(patchedMatcher, path, line)).toBe(true);
    });

    test.each(PASSES_BY_PATH)(
      'the stock scanner blocks %s in %s, so the path rule lets it pass',
      (line, path) => {
        expect(blocks(stockMatcher, path, line)).toBe(true);
      },
    );

    test('a finding from an exact-prefix rule is not marked as guessing', () => {
      const [finding] = patchedMatcher(ANTHROPIC_KEY);
      expect(finding).toMatchObject({ ruleId: 'anthropic-key', blocking: true, guessing: false });
    });

    test('a guessing finding in a code path is still reported for redaction', () => {
      const line = `API_KEY=${SAMPLE}`;
      expect(patchedMatcher(line).filter((finding) => finding.guessing)).toHaveLength(1);
      expect(blocks(patchedMatcher, 'src/a.ts', line)).toBe(false);
    });
  });

  describe('the extra exact-prefix rules', () => {
    const stockText = scannerText(stock);
    const stockMatcher = lineMatcherIn(stock);
    const patchedMatcher = lineMatcherIn(patchSource(stock, shieldPatches));
    const cases = Object.entries(EXAMPLES);

    test('every rule has an example and every example has a rule', () => {
      expect(Object.keys(EXAMPLES).toSorted()).toEqual(
        EXTRA_PREFIX_RULES.map(({ id }) => id).toSorted(),
      );
    });

    test('no id repeats or reuses an id the scanner already has', () => {
      const ids = EXTRA_PREFIX_RULES.map(({ id }) => id);
      const taken = new Set(ruleIdsIn(stockText));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => taken.has(id))).toEqual([]);
      expect(taken.size).toBeGreaterThan(30);
    });

    test.each(cases)('%s blocks in a code path and is masked exactly', (id, example) => {
      const line = sampleLine(example);
      expect(blocks(patchedMatcher, 'src/config.ts', line)).toBe(true);
      const hit = patchedMatcher(line).find((finding) => finding.ruleId === id);
      expect(hit).toMatchObject({ blocking: true, guessing: false });
      expect(line.slice(hit?.start, hit?.end)).toBe(example);
    });

    test.each(cases.filter(([id]) => id !== 'anthropic-admin-key'))(
      'the stock scanner lets %s through, so the new rule is what blocks it',
      (_id, example) => {
        expect(blocks(stockMatcher, 'src/config.ts', sampleLine(example))).toBe(false);
      },
    );

    test.each(LOOK_ALIKES)('the look-alike %s does not block', (line) => {
      expect(patchedMatcher(line).filter((finding) => finding.blocking)).toEqual([]);
    });

    test('an Anthropic admin key fires anthropic-key first and anthropic-admin-key too', () => {
      const line = sampleLine(EXAMPLES['anthropic-admin-key']);
      const ids = patchedMatcher(line).map((finding) => finding.ruleId);
      expect(ids).toEqual(['anthropic-key', 'anthropic-admin-key']);
      expect(search(patchedMatcher, { content: line }, 'src/config.ts')?.ruleId).toBe(
        'anthropic-key',
      );
    });
  });
}
