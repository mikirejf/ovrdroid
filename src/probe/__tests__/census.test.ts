import { describe, expect, test } from 'bun:test';

import {
  buildFamilies,
  findOrphans,
  formatDroid,
  formatFamilies,
  formatMachine,
  formatOrphans,
  medianOf,
  otherOrphansToShow,
  parseCommands,
  parseProcesses,
} from '../census.ts';

const BEFORE = [
  '  100     1  0:10.00  0:05.00     01:00 /Applications/Droid/droid',
  '  101   100  0:01.00  0:00.00     01:00 /Applications/Droid/droid',
  '  200     1  0:00.00  0:00.00  2-03:04:05 /usr/local/bin/node',
  '  300     1  0:00.00  0:00.00     05:00 /Applications/Google Chrome Helper',
].join('\n');

const AFTER = [
  '  100     1  0:20.00  0:05.00     01:10 /Applications/Droid/droid',
  '  101   100  0:01.00  0:00.00     01:10 /Applications/Droid/droid',
  '  200     1  0:00.00  0:00.00  2-03:04:15 /usr/local/bin/node',
  '  201     1  0:00.00  0:00.00     00:10 /usr/local/bin/node',
  '  300     1  0:00.00  0:00.00     05:10 /Applications/Google Chrome Helper',
].join('\n');

const FOOTPRINTS = new Map([
  [100, 300 * 1024],
  [101, 100 * 1024],
  [200, 50 * 1024],
  [201, 70 * 1024],
  [300, 10 * 1024],
]);

const COMMANDS = parseCommands(
  [
    '  100 /Applications/Droid/droid',
    '  200 node /Users/a/proj/server.js',
    '  201 /usr/local/bin/node /var/T/.tmpAbC/local.cjs --ipc-path /x',
    '  300 /Applications/Google Chrome Helper --type=gpu',
  ].join('\n'),
);

function families() {
  return buildFamilies({
    before: parseProcesses(BEFORE),
    after: parseProcesses(AFTER),
    footprints: FOOTPRINTS,
    windowS: 10,
  });
}

describe('parseProcesses', () => {
  test('reads pid, parent, cpu, age and the last path part with spaces', () => {
    const rows = parseProcesses(AFTER);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ pid: 100, ppid: 1, cpuMs: 25_000, age: '01:10', name: 'droid' });
    expect(rows[2]?.age).toBe('2-03:04:15');
    expect(rows[4]?.name).toBe('Google Chrome Helper');
  });

  test('skips lines that are not process rows', () => {
    expect(parseProcesses('garbage\n\n')).toEqual([]);
  });
});

describe('buildFamilies', () => {
  test('sums footprint and counts CPU cores from the change over the window', () => {
    const droid = families().find((family) => family.name === 'droid');
    expect(droid?.count).toBe(2);
    expect(droid?.totalKib).toBe(400 * 1024);
    expect(droid?.cores).toBeCloseTo(1, 5);
  });

  test('counts a process that appeared in the window as zero CPU', () => {
    const node = families().find((family) => family.name === 'node');
    expect(node?.count).toBe(2);
    expect(node?.cores).toBe(0);
  });
});

describe('medianOf', () => {
  test('takes the middle value, or the mean of the two middle values', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([])).toBe(0);
  });
});

describe('findOrphans', () => {
  const orphans = findOrphans({
    rows: parseProcesses(AFTER),
    commands: COMMANDS,
    footprints: FOOTPRINTS,
  });

  test('keeps parentless dev processes by footprint and drops the rest', () => {
    expect(orphans.map((orphan) => orphan.pid)).toEqual([201, 200]);
  });

  test('marks the Convex local backend executor', () => {
    expect(orphans.find((orphan) => orphan.pid === 201)?.convex).toBe(true);
    expect(orphans.find((orphan) => orphan.pid === 200)?.convex).toBe(false);
  });

  test('lists the other orphans for the working directory lookup', () => {
    expect(otherOrphansToShow(orphans, 5).map((orphan) => orphan.pid)).toEqual([200]);
  });
});

describe('formatting', () => {
  test('machine line gives the total in GB and the cores', () => {
    expect(formatMachine(families(), 10)).toBe(
      'The machine runs 5 processes. Together they hold 0.5 GB of memory and used 1.00 CPU cores over 10 seconds.',
    );
  });

  test('family tables sort by memory and by CPU', () => {
    const text = formatFamilies(families(), 1);
    const [memoryTitle, memoryRow, , cpuTitle, cpuRow] = text.split('\n');
    expect(memoryTitle).toContain('by memory');
    expect(memoryRow).toContain('droid');
    expect(cpuTitle).toContain('by CPU');
    expect(cpuRow).toContain('droid');
  });

  test('droid section gives count, total, median and share', () => {
    const text = formatDroid(families());
    expect(text).toContain('Droid runs 2 processes.');
    expect(text).toContain('400 MB');
    expect(text).toContain('The middle process holds 200 MB.');
    expect(text).toContain('75% of the machine memory');
    expect(text).toContain('100% of the machine CPU');
  });

  test('droid section says so when none run', () => {
    expect(formatDroid([])).toBe('No droid process is running.');
  });

  test('orphan section shows the total, the top rows with directory, and the Convex group', () => {
    const orphans = findOrphans({
      rows: parseProcesses(AFTER),
      commands: COMMANDS,
      footprints: FOOTPRINTS,
    });
    const text = formatOrphans(orphans, new Map([[200, '/Users/a/proj']]), 5);
    expect(text).toContain('2 dev processes lost their parent. They hold 120 MB.');
    expect(text).toContain('node /Users/a/proj/server.js  in /Users/a/proj');
    expect(text).toContain('1 of these are Convex local backend executors');
    expect(text).not.toContain('.tmpAbC');
  });

  test('cuts a long command to 110 characters', () => {
    const command = `node ${'x'.repeat(200)}`;
    const text = formatOrphans(
      [{ pid: 1, kib: 1024, age: '01:00', command, convex: false }],
      new Map(),
      5,
    );
    expect(text).toContain(command.slice(0, 110));
    expect(text).not.toContain(command.slice(0, 111));
  });
});
