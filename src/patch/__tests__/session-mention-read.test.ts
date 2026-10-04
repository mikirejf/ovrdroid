import { afterAll, describe, expect, test } from 'bun:test';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TRANSCRIPT_HEAD_BYTES, TRANSCRIPT_MAX_BYTES } from '../session-mention-patches.ts';
import type { Files, ReadArgs } from './session-mention-harness.ts';
import { picker, pickerReading, transcript, userLine } from './session-mention-harness.ts';

interface Reads {
  bytes: number;
}

function hidden(bytes: number): string {
  return userLine('', { visibility: 'user_only', pad: 'x'.repeat(bytes) });
}

interface CappedFile {
  file: string;
  reads: Reads;
}

function readsAtMost(most: number, reads: Reads): Files {
  return {
    openSync,
    closeSync,
    readSync: (...args: ReadArgs) => {
      const [fd, buffer, offset, length, position] = args;
      const got = readSync(fd, buffer, offset, Math.min(length, most), position);
      reads.bytes += got;
      return got;
    },
  };
}

describe('the transcript read stays bounded', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'od-head-'));
  afterAll(() => {
    rmSync(folder, { recursive: true });
  });

  test('reads the first message from a file', () => {
    const file = path.join(folder, 'one.jsonl');
    writeFileSync(file, transcript(userLine('hello there')));
    expect(picker.$ODsessionHead(file)).toBe('hello there');
  });

  test('a typed message that ends past the first read is still found', () => {
    const file = path.join(folder, 'straddle.jsonl');
    const typed = `typed after a long context ${'y'.repeat(TRANSCRIPT_HEAD_BYTES)}`;
    writeFileSync(file, transcript(hidden(TRANSCRIPT_HEAD_BYTES / 2), userLine(typed)));
    expect(picker.$ODsessionHead(file)).toBe(typed);
  });

  test('a typed message after many reads of hidden records is found', () => {
    const file = path.join(folder, 'deep.jsonl');
    const padding = Array.from({ length: 10 }, () => hidden(TRANSCRIPT_HEAD_BYTES / 3));
    writeFileSync(file, transcript(...padding, userLine('found deep')));
    expect(picker.$ODsessionHead(file)).toBe('found deep');
  });

  test('a typed message past the read cap is not shown', () => {
    const file = path.join(folder, 'late.jsonl');
    const padding = Array.from({ length: 5 }, () => hidden(TRANSCRIPT_MAX_BYTES / 4));
    writeFileSync(file, transcript(...padding, userLine('too late')));
    expect(picker.$ODsessionHead(file)).toBeNull();
  });

  test('repeated short reads still find the typed message', () => {
    const file = path.join(folder, 'short.jsonl');
    writeFileSync(file, transcript(hidden(200), userLine('first typed message')));
    expect(pickerReading(readsAtMost(28, { bytes: 0 })).$ODsessionHead(file)).toBe(
      'first typed message',
    );
  });

  test('repeated short reads still count a last line without a newline', () => {
    const file = path.join(folder, 'short-bare.jsonl');
    writeFileSync(file, transcript(hidden(200), userLine('typed at the very end')).trimEnd());
    expect(pickerReading(readsAtMost(28, { bytes: 0 })).$ODsessionHead(file)).toBe(
      'typed at the very end',
    );
  });

  const capped = (name: string, typedAt: number): CappedFile => {
    const lines: string[] = [];
    const block = hidden(1024);
    let { length } = transcript();
    while (length + block.length + 1 < typedAt) {
      lines.push(block);
      length += block.length + 1;
    }
    lines.push(hidden(typedAt - length - hidden(0).length - 1));
    const typed = userLine('beyond the cap');
    const text = transcript(...lines, typed);
    expect(text.indexOf(typed)).toBe(typedAt);
    const file = path.join(folder, name);
    writeFileSync(file, text);
    return { file, reads: { bytes: 0 } };
  };

  test('a complete typed message right after the cap is not shown, and no byte past the cap is read', () => {
    const { file, reads } = capped('after-cap.jsonl', TRANSCRIPT_MAX_BYTES + 1);
    expect(
      pickerReading(readsAtMost(Number.MAX_SAFE_INTEGER, reads)).$ODsessionHead(file),
    ).toBeNull();
    expect(reads.bytes).toBeLessThanOrEqual(TRANSCRIPT_MAX_BYTES);
  });

  test('a typed message that is complete only past the cap is not shown', () => {
    const { file, reads } = capped('across-cap.jsonl', TRANSCRIPT_MAX_BYTES - 20);
    expect(
      pickerReading(readsAtMost(Number.MAX_SAFE_INTEGER, reads)).$ODsessionHead(file),
    ).toBeNull();
    expect(reads.bytes).toBeLessThanOrEqual(TRANSCRIPT_MAX_BYTES);
  });

  test('a file shorter than the read limit counts its last line without a newline', () => {
    const file = path.join(folder, 'bare.jsonl');
    writeFileSync(file, transcript(userLine('no newline at the end')).trimEnd());
    expect(picker.$ODsessionHead(file)).toBe('no newline at the end');
  });

  test('a missing transcript shows one line', () => {
    expect(picker.$ODsessionHead(path.join(folder, 'gone.jsonl'))).toBeNull();
  });
});
