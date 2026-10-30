import { describe, expect, test } from 'bun:test';

import { toolSurfacePatches } from '../tool-surface-patches.ts';
import { occurrences, patchNamed } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

const KEPT_BATCH_TAIL =
  '\n- Advancing work: mark the finished item [completed], mark the next [in_progress], AND issue the next action, all in one message.\nA solo TodoWrite produces nothing the user asked for';

const BATCH_RULE = patchNamed(toolSurfacePatches, 'todo-write-batch-rule-tool-neutral').replace;

describe.skipIf(stockDroid === undefined)('the prompt text that steers models into Scripts', () => {
  const { patchedText } = shipped(toolSurfacePatches);

  test('the rest of the TodoWrite description is untouched', () => {
    expect(occurrences(patchedText, `${BATCH_RULE}${KEPT_BATCH_TAIL}`)).toBe(1);
  });
});
