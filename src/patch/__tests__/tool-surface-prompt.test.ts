import { describe, expect, test } from 'bun:test';

import { toolSurfacePatches } from '../tool-surface-patches.ts';
import { occurrences, patchNamed } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

const KEPT_BATCH_TAIL =
  '\n- Advancing work: mark the finished item [completed], mark the next [in_progress], AND issue the next action, all in one message.\nA solo TodoWrite produces nothing the user asked for';

const BATCH_RULE = patchNamed(toolSurfacePatches, 'todo-write-batch-rule-tool-neutral').replace;

describe.skipIf(stockDroid === undefined)('the prompt text that steers models into Scripts', () => {
  const { patchedText, rebasedNamed } = shipped(toolSurfacePatches);

  test('the Script-only section keeps the direct-call and dependent-step steering', () => {
    const section = rebasedNamed('script-only-section-steers-to-scripts');
    expect(occurrences(patchedText, section.replace)).toBe(1);
    expect(occurrences(patchedText, section.find)).toBe(0);
    expect(section.replace).toContain(
      'exist only as `tools.<Name>(input)` inside a Script; never call them top level.',
    );
    expect(section.replace).toContain(
      'put the calls in one Script and start independent ones together.',
    );
    expect(section.replace).toContain(
      'loop inside one Script instead of spending a turn per call.',
    );
  });

  test('the rest of the TodoWrite description is untouched', () => {
    expect(occurrences(patchedText, `${BATCH_RULE}${KEPT_BATCH_TAIL}`)).toBe(1);
  });
});
