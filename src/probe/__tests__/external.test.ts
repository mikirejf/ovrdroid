import { describe, expect, test } from 'bun:test';

import { describeExternal, readExternal, summariseExternal } from '../external.ts';

const FILE = '/repo/src/app.ts';

function line(role: string, ...content: unknown[]): string {
  return JSON.stringify({ type: 'message', timestamp: 't', message: { role, content } });
}

function use(
  id: string,
  name: string,
  input: { file_path?: string; command?: string; prompt?: string },
): string {
  return line('assistant', { type: 'tool_use', id, name, input });
}

function done(id: string, content = 'ok', isError = false): string {
  return line('user', { type: 'tool_result', tool_use_id: id, is_error: isError, content });
}

function read(id: string, file = FILE): string[] {
  return [use(id, 'Read', { file_path: file }), done(id)];
}

function shell(id: string, command: string): string[] {
  return [use(id, 'Execute', { command }), done(id)];
}

function reminder(...files: string[]): string {
  const listed = files.map((file) => `  - ${file}\n`).join('');
  return line('user', {
    type: 'text',
    text: `<system-reminder>\nThese files were modified externally since you last accessed them:\n${listed}</system-reminder>`,
  });
}

function refusedEdit(id: string, file = FILE): string[] {
  return [
    use(id, 'Edit', { file_path: file }),
    done(
      id,
      `Error: File "${file}" has been modified externally since it was last read. Please use the Read tool`,
      true,
    ),
  ];
}

function causesOf(lines: string[]): string[] {
  return readExternal(lines).findings.map((finding) => finding.cause);
}

describe('readExternal causes', () => {
  test('a shell command that names the file and writes is the cause', () => {
    expect(
      causesOf([...read('r'), ...shell('s', "sed -i 's/a/b/' src/app.ts"), reminder(FILE)]),
    ).toEqual(['shell-edit']);
  });

  test('a shell command that names the file but only reads it is not a write', () => {
    expect(causesOf([...read('r'), ...shell('s', 'wc -l src/app.ts'), reminder(FILE)])).toEqual([
      'other-shell',
    ]);
  });

  test('2>&1 and >/dev/null are not writes to the file the command names', () => {
    expect(
      causesOf([...read('r'), ...shell('s', 'rg foo src/app.ts 2>&1 >/dev/null'), reminder(FILE)]),
    ).toEqual(['other-shell']);
  });

  test('an append or a redirect into the file is a write', () => {
    expect(causesOf([...read('r'), ...shell('s', 'echo x >> src/app.ts'), reminder(FILE)])).toEqual(
      ['shell-edit'],
    );
    expect(causesOf([...read('r'), ...shell('s', 'cat > src/app.ts'), reminder(FILE)])).toEqual([
      'shell-edit',
    ]);
  });

  test('git beats a formatter, and a formatter beats a subagent', () => {
    expect(causesOf([...read('r'), ...shell('s', 'git checkout main'), reminder(FILE)])).toEqual([
      'git',
    ]);
    expect(
      causesOf([
        ...read('r'),
        ...shell('s', 'bun run format'),
        use('t', 'Task', { prompt: 'go' }),
        done('t'),
        reminder(FILE),
      ]),
    ).toEqual(['formatter']);
    expect(
      causesOf([...read('r'), use('t', 'Task', { prompt: 'go' }), done('t'), reminder(FILE)]),
    ).toEqual(['subagent']);
  });

  test('no agent action leaves the cause as nothing', () => {
    expect(causesOf([...read('r'), reminder(FILE)])).toEqual(['nothing']);
  });

  test('only calls after the last successful access count', () => {
    expect(
      causesOf([...shell('s', 'git stash'), ...read('r'), ...shell('o', 'ls'), reminder(FILE)]),
    ).toEqual(['other-shell']);
  });

  test('a Read that errored does not move the last access', () => {
    expect(
      causesOf([
        ...read('r'),
        ...shell('s', 'git stash'),
        use('bad', 'Read', { file_path: FILE }),
        done('bad', 'nope', true),
        reminder(FILE),
      ]),
    ).toEqual(['git']);
  });
});

describe('readExternal events', () => {
  test('a refused Edit is a refusal with the cause found the same way', () => {
    const reading = readExternal([
      ...read('r'),
      ...shell('s', `cp /tmp/x ${FILE}`),
      ...refusedEdit('e'),
    ]);

    expect(reading.findings).toEqual([{ kind: 'refusal', file: FILE, cause: 'shell-edit' }]);
  });

  test('a repeated warning counts once as a finding and again as repeated', () => {
    const reading = readExternal([...read('r'), reminder(FILE), reminder(FILE)]);

    expect(reading.findings).toHaveLength(1);
    expect(reading.repeated).toBe(1);
  });

  test('reading the file again lets the next warning count as new', () => {
    const reading = readExternal([...read('r'), reminder(FILE), ...read('r2'), reminder(FILE)]);

    expect(reading.findings).toHaveLength(2);
    expect(reading.repeated).toBe(0);
  });

  test('the single-file reminder form names its file', () => {
    const reading = readExternal([
      ...read('r'),
      line('user', {
        type: 'text',
        text: `IMPORTANT: The file ${FILE} has been modified externally since you last accessed it. Use Read.`,
      }),
    ]);

    expect(reading.findings).toEqual([{ kind: 'reminder', file: FILE, cause: 'nothing' }]);
  });

  test('a warning naming several files gives one finding per file', () => {
    const reading = readExternal([reminder('/a/one.ts', '/a/two.ts')]);

    expect(reading.findings.map((finding) => finding.file)).toEqual(['/a/one.ts', '/a/two.ts']);
  });

  test('broken lines and assistant text are ignored', () => {
    const reading = readExternal([
      'not json',
      '{"message":"x"}',
      line('assistant', { type: 'text', text: 'modified externally since you last accessed' }),
    ]);

    expect(reading).toEqual({ findings: [], repeated: 0 });
  });

  test('a tool result may carry its text as an array', () => {
    const reading = readExternal([
      use('e', 'Edit', { file_path: FILE }),
      line('user', {
        type: 'tool_result',
        tool_use_id: 'e',
        is_error: true,
        content: [{ type: 'text', text: 'has been modified externally since it was last read' }],
      }),
    ]);

    expect(reading.findings).toHaveLength(1);
  });
});

describe('summariseExternal', () => {
  const readings = [
    {
      session: '517d1ce2-2d3c-44c0',
      reading: readExternal([
        ...read('r'),
        ...shell('s', `tee ${FILE}`),
        ...refusedEdit('e'),
        reminder(FILE),
        reminder(FILE),
      ]),
    },
    { session: 'aaaaaaaa-1111', reading: readExternal([reminder('/b/other.ts')]) },
  ];

  test('counts events, sessions and repeats, and keeps short examples', () => {
    const summary = summariseExternal(readings);

    expect(summary.refusals).toEqual({
      total: 1,
      sessions: 1,
      causes: [
        { cause: 'shell-edit', count: 1, examples: [{ session: '517d1ce2', file: 'app.ts' }] },
      ],
    });
    expect(summary.reminders.total).toBe(2);
    expect(summary.reminders.sessions).toBe(2);
    expect(summary.repeated).toBe(1);
  });

  test('prints a count and a plain cause per line', () => {
    const text = describeExternal(summariseExternal(readings));

    expect(text).toContain('Edits refused because a file looked changed: 1 in 1 sessions');
    expect(text).toContain("1  the agent's own shell command edited the file");
    expect(text).toContain('e.g. 517d1ce2 app.ts');
    expect(text).toContain('1 more warnings');
  });
});
