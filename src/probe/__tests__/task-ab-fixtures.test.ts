import { describe, expect, test } from 'bun:test';

import { buildTask, TASK_NAMES } from '../task-ab-fixtures.ts';
import type { TaskName } from '../task-ab-fixtures.ts';

function taskOf(name: TaskName, seed = '1:1') {
  return buildTask(name, `${seed}:${name}`);
}

describe('buildTask', () => {
  test('builds the same files from the same seed and different ones from another', () => {
    for (const name of ['chain', 'callers', 'explore'] as const) {
      expect(taskOf(name).files).toEqual(taskOf(name).files);
      expect(taskOf(name).files).not.toEqual(taskOf(name, '1:2').files);
    }
  });

  test('every task has a prompt and a name', () => {
    for (const name of TASK_NAMES) {
      expect(taskOf(name).name).toBe(name);
      expect(taskOf(name).prompt.length).toBeGreaterThan(20);
    }
  });
});

describe('chain', () => {
  test('is 31 files that lead from start.txt to a code', () => {
    const { files, grade } = taskOf('chain');
    expect(Object.keys(files)).toHaveLength(31);
    let current = 'start.txt';
    const visited = new Set<string>();
    for (;;) {
      visited.add(current);
      const text = files[current] ?? '';
      const next = /^next: (?<file>.+)$/mu.exec(text)?.groups?.['file'];
      if (next === undefined) {
        const code = /^code: (?<code>\d{4})$/mu.exec(text)?.groups?.['code'] ?? '';
        expect(visited.size).toBe(31);
        expect(grade({ reply: `It is ${code}`, files: {}, testExit: undefined }).pass).toBe(true);
        expect(grade({ reply: 'It is 0000', files: {}, testExit: undefined }).pass).toBe(false);
        return;
      }
      current = next;
    }
  });
});

describe('callers', () => {
  const task = taskOf('callers');
  const target = /`(?<name>\w+)`/u.exec(task.prompt)?.groups?.['name'] ?? '';
  const calls = (text: string) => text.match(new RegExp(`${target}\\(`, 'gu'))?.length ?? 0;
  const entries = Object.entries(task.files);
  const definition = entries.find(([, text]) => text.includes(`function ${target}(`))?.[0] ?? '';
  const callers = entries.filter(([name, text]) => name !== definition && calls(text) > 0);

  test('has one definition and three callers with different counts', () => {
    expect(definition).not.toBe('');
    expect(callers).toHaveLength(3);
    expect(new Set(callers.map(([, text]) => calls(text))).size).toBe(3);
  });

  test('has decoys that match the name without calling it', () => {
    const decoys = entries.filter(
      ([name, text]) => name !== definition && text.includes(target) && calls(text) === 0,
    );
    expect(decoys.length).toBeGreaterThanOrEqual(3);
  });

  test('grades a reply built from the real call counts as right, and a shifted one as wrong', () => {
    const reply = [
      `Defined in ${definition}.`,
      ...callers.map(([name, text]) => `- ${name}: ${calls(text)} calls`),
    ];
    expect(task.grade({ reply: reply.join('\n'), files: {}, testExit: undefined }).pass).toBe(true);
    const shifted = reply.map((line) =>
      line.replace(/\d(?= calls)/u, (count) => String(Number(count) + 1)),
    );
    expect(task.grade({ reply: shifted.join('\n'), files: {}, testExit: undefined }).pass).toBe(
      false,
    );
  });
});

describe('explore', () => {
  const task = taskOf('explore');

  test('hides four implementing files among at least fifteen others', () => {
    expect(Object.keys(task.files).length).toBeGreaterThanOrEqual(19);
  });

  const port = /DEFAULT_PORT = (?<port>\d+);/u.exec(Object.values(task.files).join('\n'))?.groups?.[
    'port'
  ];

  test('passes a reply naming the four files and the port, and fails one that stops early', () => {
    const named = `serve.ts, then config/load.ts, config/validate.ts and config/defaults.ts, default ${port}`;
    expect(task.grade({ reply: named, files: {}, testExit: undefined }).pass).toBe(true);
    const noPort = named.replace(String(port), 'unknown');
    expect(task.grade({ reply: noPort, files: {}, testExit: undefined }).pass).toBe(false);
    expect(task.grade({ reply: 'serve.ts, load.ts', files: {}, testExit: undefined }).pass).toBe(
      false,
    );
  });
});

describe('fix', () => {
  const task = taskOf('fix');

  test('runs the tests with auto medium and watches the test file', () => {
    expect(task.autonomy).toEqual(['--auto', 'medium']);
    expect(task.runTests).toBe(true);
    expect(task.watch).toEqual(['src/price.test.ts']);
  });

  test('starts with both defects', () => {
    expect(task.files['src/tax.ts']).toContain('Math.round(cents * TAX_RATE)');
    expect(task.files['src/price.ts']).toContain('discountPercent / 10');
  });

  test('grades on the watched file and the test exit', () => {
    const original = task.files['src/price.test.ts'];
    expect(
      task.grade({ reply: '', files: { 'src/price.test.ts': original }, testExit: 0 }).pass,
    ).toBe(true);
    expect(
      task.grade({ reply: '', files: { 'src/price.test.ts': original }, testExit: 1 }).pass,
    ).toBe(false);
  });
});
