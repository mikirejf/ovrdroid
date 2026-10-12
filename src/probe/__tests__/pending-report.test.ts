import { describe, expect, test } from 'bun:test';

import {
  pendingCommand,
  pendingMissing,
  showsPendingTool,
  sleepSeconds,
} from '../pending-report.ts';

function frame(text: string) {
  return { atMs: 0, text };
}

describe('sleepSeconds', () => {
  test('outlasts the lead-in, the window and the margin, rounded up to whole seconds', () => {
    expect(sleepSeconds({ leadInMs: 2500, windowMs: 6000 }, 5000)).toBe(14);
    expect(sleepSeconds({ leadInMs: 100, windowMs: 100 }, 100)).toBe(1);
  });
});

describe('showsPendingTool', () => {
  const command = pendingCommand(14);

  test('is true when the last frame names the tool and its command', () => {
    expect(showsPendingTool([frame('older'), frame(`Execute ${command}`)], command)).toBe(true);
  });

  test('reads a tool name the shimmer coloured one letter at a time', () => {
    const letters = 'Execute'.split('').map((letter, index) => `\u001B[38;5;${index}m${letter}`);
    const shimmered = `${letters.join('')}\u001B[0m \u001B[2m${command}\u001B[0m`;
    expect(showsPendingTool([frame(shimmered)], command)).toBe(true);
  });

  test('is false when the last frame names the tool but not the command', () => {
    expect(showsPendingTool([frame('Execute sleep 3')], command)).toBe(false);
  });

  test('is false when only an older frame showed the tool', () => {
    expect(showsPendingTool([frame(`Execute ${command}`), frame('> ')], command)).toBe(false);
  });

  test('is false when no frame was drawn', () => {
    expect(showsPendingTool([], command)).toBe(false);
  });
});

describe('pendingMissing', () => {
  test('says what the last frame held, so a failed run can be read', () => {
    expect(pendingMissing([frame('> typed')], 'sleep 14')).toContain('> typed');
    expect(pendingMissing([], 'sleep 14')).toContain('no frame was drawn');
  });
});
