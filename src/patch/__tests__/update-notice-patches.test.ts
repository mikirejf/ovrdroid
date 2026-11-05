import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LATEST_RELEASE_URL, updateNoticePatches } from '../update-notice-patches.ts';
import { describeStrayNames, occurrences, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid as stock, stockText } from './stock-scanner.ts';

interface World {
  $ODpainted?: boolean;
  $ODafterPaint?: (() => void)[];
}

interface Answer {
  ok: boolean;
  text: () => Promise<string>;
}

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Answer>;

type Schedule = (ready: Promise<null>) => Promise<string>;

const OFF = patchNamed(updateNoticePatches, 'auto-update-off');
const CHECK = patchNamed(updateNoticePatches, 'release-check-after-paint');

const STOCK_SCHEDULER_TAIL =
  '{restartBlockingUpdate:!1,join:"detached",detachCheckAfterDecision:!0,executionReady:t}).catch((e)=>"error");return D}';

const UPDATE_FILE_UNDER_HOME = '.factory/ovrdroid/update.json';

const { patchedText, rebasedNamed } = shipped([OFF, CHECK]);

describeStrayNames(updateNoticePatches);

describe.skipIf(stock === undefined)('the shipped update code', () => {
  test.each([OFF.name, CHECK.name])('%s anchors once and applies', (name) => {
    expect(occurrences(stockText, rebasedNamed(name).find)).toBe(1);
  });

  test('the default config ships with auto-update off', () => {
    expect(occurrences(patchedText, 'autoUpdateEnabled:!1,airgapEnabled:!1')).toBe(1);
    expect(occurrences(patchedText, 'autoUpdateEnabled:!0,airgapEnabled:!1')).toBe(0);
  });

  test('the post-input-ready scheduler starts the release check', () => {
    expect(occurrences(patchedText, '$ODscheduleCheck(')).toBe(2);
  });
});

let scratch = '';
let world: World = {};
let calls: string[] = [];

function updateFile(): string {
  return path.join(scratch, UPDATE_FILE_UNDER_HOME);
}

function readVersion(): string | undefined {
  if (!fs.existsSync(updateFile())) {
    return undefined;
  }
  return /"version":"(?<version>[^"]+)"/u.exec(fs.readFileSync(updateFile(), 'utf-8'))?.groups?.[
    'version'
  ];
}

function fakeRequire(name: string): object | undefined {
  return new Map<string, object>([
    ['os', { homedir: () => scratch }],
    ['fs', fs],
    ['path', path],
  ]).get(name);
}

function schedulerWith(answer: Fetch): Schedule {
  const source = `var D=null;const LI=()=>Promise.resolve("classified");${CHECK.replace}${STOCK_SCHEDULER_TAIL}return gde`;
  const recording: Fetch = async (url, init) => {
    calls.push(url);
    return await answer(url, init);
  };
  return payloadFunction<[World, typeof fakeRequire, Fetch], Schedule>(
    ['globalThis', 'require', 'fetch'],
    source,
  )(world, fakeRequire, recording);
}

function body(text: string): Fetch {
  return async () =>
    await Promise.resolve({ ok: true, text: async () => await Promise.resolve(text) });
}

async function settle(): Promise<void> {
  await Bun.sleep(5);
}

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'update-notice-')));
  world = {};
  calls = [];
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('the release check writes the newest release to the update file', () => {
  test('a version answer is written as {version}', async () => {
    world.$ODpainted = true;
    await schedulerWith(body('1.5.0\n'))(Promise.resolve(null));
    await settle();
    expect(calls).toEqual([LATEST_RELEASE_URL]);
    expect(readVersion()).toBe('1.5.0');
  });

  test('it replaces the version an earlier launch found', async () => {
    fs.mkdirSync(path.dirname(updateFile()), { recursive: true });
    fs.writeFileSync(updateFile(), JSON.stringify({ version: '1.4.2' }));
    world.$ODpainted = true;
    await schedulerWith(body('1.5.0'))(Promise.resolve(null));
    await settle();
    expect(readVersion()).toBe('1.5.0');
  });

  test.each([
    ['a failed fetch', async () => await Promise.reject(new Error('offline'))],
    [
      'a non-2xx answer',
      async () =>
        await Promise.resolve({ ok: false, text: async () => await Promise.resolve('1.9.9') }),
    ],
    ['an answer that is not a version', body('<html>502 Bad Gateway</html>')],
    ['an empty answer', body('')],
    [
      'a body that fails to read',
      async () =>
        await Promise.resolve({
          ok: true,
          text: async () => await Promise.reject(new Error('reset')),
        }),
    ],
    [
      'a fetch that throws at once',
      () => {
        throw new Error('no network stack');
      },
    ],
  ])('%s leaves the file as it was and throws nothing', async (_case, answer) => {
    fs.mkdirSync(path.dirname(updateFile()), { recursive: true });
    fs.writeFileSync(updateFile(), JSON.stringify({ version: '1.4.2' }));
    world.$ODpainted = true;
    await schedulerWith(answer)(Promise.resolve(null));
    await settle();
    expect(calls).toEqual([LATEST_RELEASE_URL]);
    expect(readVersion()).toBe('1.4.2');
  });

  test('a failed fetch creates no file', async () => {
    world.$ODpainted = true;
    await schedulerWith(async () => await Promise.reject(new Error('offline')))(
      Promise.resolve(null),
    );
    await settle();
    expect(readVersion()).toBeUndefined();
  });
});

describe('the release check runs once per process, after the input is ready and painted', () => {
  test('a second call in the same process does not fetch again', async () => {
    world.$ODpainted = true;
    const schedule = schedulerWith(body('1.5.0'));
    await schedule(Promise.resolve(null));
    await schedule(Promise.resolve(null));
    await settle();
    expect(calls).toHaveLength(1);
  });

  test('two calls before paint still fetch once when the paint arrives', async () => {
    const schedule = schedulerWith(body('1.5.0'));
    await schedule(Promise.resolve(null));
    await schedule(Promise.resolve(null));
    await settle();
    expect(calls).toEqual([]);
    expect(world.$ODafterPaint).toHaveLength(2);
    for (const go of world.$ODafterPaint ?? []) {
      go();
    }
    await settle();
    expect(calls).toHaveLength(1);
    expect(readVersion()).toBe('1.5.0');
  });

  test('nothing is fetched before the input is ready', async () => {
    world.$ODpainted = true;
    const ready = Promise.withResolvers<null>();
    await schedulerWith(body('1.5.0'))(ready.promise);
    await settle();
    expect(calls).toEqual([]);
    ready.resolve(null);
    await settle();
    expect(calls).toHaveLength(1);
  });

  test('the scheduler returns the classification at once while the fetch hangs', async () => {
    world.$ODpainted = true;
    const hung = Promise.withResolvers<Answer>();
    const outcome = await schedulerWith(async () => await hung.promise)(Promise.resolve(null));
    expect(outcome).toBe('classified');
    await settle();
    expect(calls).toHaveLength(1);
    expect(readVersion()).toBeUndefined();
  });

  test('the scheduler returns even when the input never becomes ready', async () => {
    const never = Promise.withResolvers<null>();
    const outcome = await schedulerWith(body('1.5.0'))(never.promise);
    expect(outcome).toBe('classified');
    expect(calls).toEqual([]);
  });
});
