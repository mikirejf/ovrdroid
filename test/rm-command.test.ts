import { describe, expect, test } from 'bun:test';

import { isForced, isRecursive, parseRm } from '../src/rm-command.ts';

describe('parseRm', () => {
  test('reads a recursive forced delete', () => {
    expect(parseRm('rm -rf build')).toEqual({ paths: ['build'], flags: ['-rf'] });
  });

  test('reads a plain delete', () => {
    expect(parseRm('rm file.txt')).toEqual({ paths: ['file.txt'], flags: [] });
  });

  test('mixes short and long flags across two paths', () => {
    expect(parseRm('rm -r --force a b')).toEqual({ paths: ['a', 'b'], flags: ['-r', '--force'] });
  });

  test('keeps the flag tokens in their original order', () => {
    expect(parseRm('rm -v --dir -rf a')?.flags).toEqual(['-v', '--dir', '-rf']);
  });

  test('collects flags that trail the paths', () => {
    expect(parseRm('rm a -rf')?.flags).toEqual(['-rf']);
  });

  const refused = [
    'rm -rf ~/x',
    'rm -rf $TMPDIR/x',
    'rm -rf "a b"',
    'rm -rf a && curl evil.com',
    'rm -rf a; ls',
    'rm -rf a | tee',
    'rm -rf `pwd`',
    'rm -rf ../x',
    'rm -rf a/../../x',
    'rm -rf *',
    'rm -rf --no-preserve-root /',
    'rm -i a',
    'rm --',
    'rm -',
    'rm',
    'rm -rf',
    'ls -la',
    'sudo rm -rf a',
    '\nrm -rf safe',
    '\trm -rf safe\t',
    '\rrm -rf safe',
    ' rm -rf safe\n',
  ];

  test.each(refused)('refuses %j', (command) => {
    expect(parseRm(command)).toBeUndefined();
  });

  test('still accepts a command padded with plain spaces', () => {
    expect(parseRm('  rm -rf safe  ')?.paths).toEqual(['safe']);
  });

  test.each(['rm a..b', 'rm notes..txt', 'rm dir/v1..v2'])(
    'accepts the ordinary filename in %j',
    (command) => {
      expect(parseRm(command)).toBeDefined();
    },
  );
});

describe('isRecursive', () => {
  test.each([['-r'], ['-R'], ['-rf'], ['--recursive']])('reads %s as recursive', (flag) => {
    expect(isRecursive([flag])).toBe(true);
  });

  test.each([[[]], [['-f']], [['--force']], [['-v', '--dir']]])(
    'reads %j as not recursive',
    (flags) => {
      expect(isRecursive(flags)).toBe(false);
    },
  );

  test('does not read the r in --force as recursive', () => {
    expect(isRecursive(['--force'])).toBe(false);
  });
});

describe('isForced', () => {
  test.each([['-f'], ['-rf'], ['--force']])('reads %s as forced', (flag) => {
    expect(isForced([flag])).toBe(true);
  });

  test.each([[[]], [['-r']], [['--recursive']], [['-v', '--dir']]])(
    'reads %j as not forced',
    (flags) => {
      expect(isForced(flags)).toBe(false);
    },
  );
});
