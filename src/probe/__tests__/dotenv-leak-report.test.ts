import { describe, expect, test } from 'bun:test';

import {
  describeDotenvLeak,
  dotenvText,
  parseEnvDump,
  plantsFor,
  readDotenvLeak,
} from '../dotenv-leak-report.ts';

const PLANTS = plantsFor('abc123');
const [ENV, LOCAL] = PLANTS;
const BASE_ENV = 'PATH=/usr/bin\nHOME=/Users/someone\nTERM=xterm-256color\n';

function dumpWith(...lines: string[]): string {
  return `${BASE_ENV}${lines.join('\n')}\n`;
}

describe('plantsFor', () => {
  test('gives each file its own key and a value that carries the run token', () => {
    expect(PLANTS.map((plant) => plant.file)).toEqual(['.env', '.env.local']);
    expect(new Set(PLANTS.map((plant) => plant.key)).size).toBe(2);
    expect(PLANTS.every((plant) => plant.value.includes('abc123'))).toBe(true);
  });

  test('writes a dotenv line for a plant', () => {
    expect(dotenvText(ENV)).toBe(`${ENV.key}=${ENV.value}\n`);
  });
});

describe('parseEnvDump', () => {
  test('reads KEY=VALUE lines and keeps an = inside a value', () => {
    expect(parseEnvDump('A=1\nB=x=y\nC=\n').get('B')).toBe('x=y');
    expect(parseEnvDump('A=1\nB=x=y\nC=\n').get('C')).toBe('');
  });

  test('ignores continuation lines of a multi-line value', () => {
    expect([...parseEnvDump('A=first\nsecond line\nB=2\n').keys()]).toEqual(['A', 'B']);
  });
});

describe('readDotenvLeak', () => {
  test('a planted value in the dump leaks, and names the file it came from', () => {
    const reading = readDotenvLeak(dumpWith(`${LOCAL.key}=${LOCAL.value}`), PLANTS);

    expect(reading.outcome).toBe('leaks');
    expect(reading.leaked).toEqual([LOCAL]);
  });

  test('both files leaking are both reported', () => {
    const reading = readDotenvLeak(
      dumpWith(`${ENV.key}=${ENV.value}`, `${LOCAL.key}=${LOCAL.value}`),
      PLANTS,
    );

    expect(reading.leaked).toEqual(PLANTS);
  });

  test('an environment without the planted keys is clean', () => {
    expect(readDotenvLeak(BASE_ENV, PLANTS).outcome).toBe('clean');
  });

  test('a planted key carrying another value is not the planted file', () => {
    expect(readDotenvLeak(dumpWith(`${ENV.key}=somebody-else`), PLANTS).outcome).toBe('clean');
  });

  test('no dump, or an empty one, proves nothing', () => {
    expect(readDotenvLeak(undefined, PLANTS).outcome).toBe('unproven');
    expect(readDotenvLeak('', PLANTS).outcome).toBe('unproven');
  });
});

describe('describeDotenvLeak', () => {
  test('says which key reached the server from which file', () => {
    expect(
      describeDotenvLeak(readDotenvLeak(dumpWith(`${LOCAL.key}=${LOCAL.value}`), PLANTS)),
    ).toBe(`leaks: the MCP server it started saw ${LOCAL.key} from .env.local`);
  });

  test('says what the clean server did not see', () => {
    expect(describeDotenvLeak(readDotenvLeak(BASE_ENV, PLANTS))).toBe(
      `no leak: the MCP server it started saw none of ${ENV.key} from .env and ${LOCAL.key} from .env.local`,
    );
  });

  test('says an unstarted server proves nothing', () => {
    expect(describeDotenvLeak(readDotenvLeak(undefined, PLANTS))).toBe(
      'unproven: Droid never started the MCP server, so there is no environment to read',
    );
  });
});
