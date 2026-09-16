import { describe, expect, test } from 'bun:test';

import type { ExecRun } from '../exec.ts';
import {
  checkRun,
  defaultModel,
  formatExec,
  helpWorkload,
  MODEL_VARIABLE,
  turnWorkload,
  workloadFor,
} from '../exec.ts';

function run(over: Partial<ExecRun> = {}): ExecRun {
  return {
    firstMs: 500,
    totalMs: 700,
    tailMs: 200,
    exitCode: 0,
    signal: null,
    stdout: 'ok\n',
    stderr: '',
    ...over,
  };
}

const WANT = { exitCode: 0, contains: 'ok' };

describe('checkRun refuses to time a run that did not do the work', () => {
  test('a clean run that printed the answer passes', () => {
    expect(checkRun(run(), WANT)).toBeUndefined();
  });

  test('a blocked model exits non-zero and is rejected, not timed', () => {
    const blocked = run({
      exitCode: 1,
      stdout: '',
      stderr: 'Model blocked by organization policy: \n\nRun droid settings',
    });
    const problem = checkRun(blocked, WANT);
    expect(problem).toContain('exit 1');
    expect(problem).toContain('Model blocked by organization policy');
  });

  test('the reason comes from stdout when the failure printed nothing to stderr', () => {
    expect(checkRun(run({ exitCode: 1, stdout: 'Invalid model: nope\n' }), WANT)).toContain(
      'Invalid model: nope',
    );
  });

  test('a failure with no output at all still explains itself', () => {
    expect(checkRun(run({ exitCode: 2, stdout: '', stderr: '' }), WANT)).toContain(
      'no output at all',
    );
  });

  test('a run killed by a signal is rejected before its exit code is read', () => {
    expect(checkRun(run({ signal: 'SIGKILL', exitCode: null }), WANT)).toBe('killed by SIGKILL');
  });

  test('exiting zero but answering something else is rejected', () => {
    expect(checkRun(run({ stdout: 'nope\n' }), WANT)).toContain('never said "ok"');
  });

  test('a run that wrote nothing has no first byte to time', () => {
    expect(checkRun(run({ firstMs: Number.NaN, stdout: '' }), WANT)).toContain('no first byte');
  });

  test('a long error is clipped to one line so the report stays readable', () => {
    const problem = checkRun(run({ exitCode: 1, stderr: `${'x'.repeat(400)}\nsecond line` }), WANT);
    expect(problem?.split('\n')).toHaveLength(1);
    expect(problem).toContain('\u2026');
    expect(problem).not.toContain('second line');
  });
});

describe('workloads say what they actually measure', () => {
  test('help never calls a model, and says so', () => {
    expect(helpWorkload().argv).toEqual(['exec', '--help']);
    expect(helpWorkload().what).toContain('no model');
  });

  test('help is held to the usage banner, so a silent failure cannot pass', () => {
    expect(helpWorkload().expect).toEqual({ exitCode: 0, contains: 'Usage: droid exec' });
  });

  test('a turn passes the model and prompt through', () => {
    expect(turnWorkload('luna', 'say ok', 'ok').argv).toEqual(['exec', '-m', 'luna', 'say ok']);
  });

  test('a turn warns that first byte includes the model thinking', () => {
    expect(turnWorkload('luna', 'say ok', 'ok').firstMeans).toContain('thinking time');
  });

  test('the stage picks the workload', () => {
    const turn = { model: 'luna', prompt: 'say ok', expect: 'ok' };
    expect(workloadFor('help', turn).argv).toEqual(['exec', '--help']);
    expect(workloadFor('turn', turn).argv).toContain('luna');
  });
});

describe('the model comes from the environment', () => {
  test('the variable wins when it is set', () => {
    expect(defaultModel({ [MODEL_VARIABLE]: 'custom:someone:else' })).toBe('custom:someone:else');
  });

  test('an unset variable means no model, never a guessed one', () => {
    expect(defaultModel({})).toBeUndefined();
  });

  test('a blank or spaces-only variable is treated as unset, not as a model named ""', () => {
    expect(defaultModel({ [MODEL_VARIABLE]: '   ' })).toBeUndefined();
  });

  test('a turn with no model stops and says where to set one', () => {
    expect(() => workloadFor('turn', { model: undefined, prompt: 'p', expect: 'ok' })).toThrow(
      MODEL_VARIABLE,
    );
  });

  test('help needs no model at all', () => {
    expect(workloadFor('help', { model: undefined, prompt: 'p', expect: 'ok' }).argv).toEqual([
      'exec',
      '--help',
    ]);
  });

  test('surrounding whitespace is trimmed off a real value', () => {
    expect(defaultModel({ [MODEL_VARIABLE]: ' luna \n' })).toBe('luna');
  });
});

describe('the report separates startup from shutdown', () => {
  test('first, tail and total each get a line', () => {
    const text = formatExec([run(), run({ firstMs: 600, tailMs: 300, totalMs: 900 })]);
    expect(text).toContain('first');
    expect(text).toContain('tail');
    expect(text).toContain('total');
    expect(text.split('\n')).toHaveLength(3);
  });

  test('the tail is reported per run, not as a difference of two medians', () => {
    const text = formatExec([run({ tailMs: 10 }), run({ tailMs: 990 })]);
    expect(text).toContain('min 10');
    expect(text).toContain('p75 745');
  });
});
