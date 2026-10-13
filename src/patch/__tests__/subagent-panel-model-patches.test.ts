import { describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { MODEL_LABEL_OF, subagentPanelModelPatches } from '../subagent-panel-model-patches.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(subagentPanelModelPatches);

interface Store {
  getModelId: () => string | undefined;
  getReasoningEffort: () => string | undefined;
}

type LabelOf = (store: Store | null) => string | undefined;

const SHORT_NAMES = new Map([
  ['opus-5-5', 'Opus 5.5'],
  ['haiku-5-5', 'Haiku 5.5'],
]);
const EFFORT_LABELS = new Map([
  ['high', 'High'],
  ['xhigh', 'Extra High'],
]);

const labelOf = payloadFunction<
  [(id: string) => { shortDisplayName: string }, (effort: string) => string],
  LabelOf
>(['ue', 'ti'], `return ${MODEL_LABEL_OF}`)(
  (id) => ({ shortDisplayName: SHORT_NAMES.get(id) ?? id }),
  (effort) => EFFORT_LABELS.get(effort) ?? effort,
);

function storeOf(modelId: string | null, effort?: string): Store {
  return { getModelId: () => modelId ?? undefined, getReasoningEffort: () => effort };
}

describe('the panel names the model and effort a sub-agent runs on', () => {
  test('a model with an effort shows both, in the app style', () => {
    expect(labelOf(storeOf('opus-5-5', 'high'))).toBe('Opus 5.5 (High)');
  });

  test('the effort label comes from the app, not the raw id', () => {
    expect(labelOf(storeOf('haiku-5-5', 'xhigh'))).toBe('Haiku 5.5 (Extra High)');
  });

  test('a model with no effort shows the model name alone', () => {
    expect(labelOf(storeOf('opus-5-5'))).toBe('Opus 5.5');
  });

  test('no model shows nothing, even when an effort is set', () => {
    expect(labelOf(storeOf(null, 'high'))).toBeUndefined();
  });

  test('a sub-agent with no session store shows nothing', () => {
    expect(labelOf(null)).toBeUndefined();
  });
});

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  const { patchedText, rebasedNamed } = shipped(subagentPanelModelPatches);

  test.each(subagentPanelModelPatches.map((patch) => [patch.name] as const))(
    '%s applies',
    (name) => {
      const rebased = rebasedNamed(name);
      expect(applies(rebased)).toBe(true);
      expect(patchedText).toContain(rebased.replace);
    },
  );

  test('the row puts the model before the description, so truncation cuts the description first', () => {
    expect(rebasedNamed('subagent-panel-model-row').replace).toMatch(
      /\.modelLabel\?`[^`]*`:""\)\+\(\w+\.detail\?/u,
    );
  });
});
