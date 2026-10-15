import { describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { ITEM_MODEL_LABEL, subagentPanelModelPatches } from '../subagent-panel-model-patches.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(subagentPanelModelPatches);

interface Store {
  getModelId: () => string | undefined;
  getReasoningEffort: () => string | undefined;
}

interface Item {
  sessionId?: string;
  model?: string;
  reasoningEffort?: string;
}

interface SessionStateManager {
  getSessionManager: (id: string) => { getStore: () => Store } | undefined;
}

type ItemLabel = (item: Item) => string | undefined;

const SHORT_NAMES = new Map([
  ['opus-5-5', 'Opus 5.5'],
  ['haiku-5-5', 'Haiku 5.5'],
]);
const EFFORT_LABELS = new Map([
  ['high', 'High'],
  ['xhigh', 'Extra High'],
]);

function storeOf(modelId: string | null, effort?: string): Store {
  return { getModelId: () => modelId ?? undefined, getReasoningEffort: () => effort };
}

function itemLabelOver(stores: Record<string, Store>): ItemLabel {
  const manager: SessionStateManager = {
    getSessionManager: (id) => {
      const store = stores[id];
      return store === undefined ? undefined : { getStore: () => store };
    },
  };
  return payloadFunction<
    [(id: string) => { shortDisplayName: string }, (effort: string) => string, SessionStateManager],
    ItemLabel
  >(['ue', 'ti', 'K'], `return (ee)=>${ITEM_MODEL_LABEL}`)(
    (id) => ({ shortDisplayName: SHORT_NAMES.get(id) ?? id }),
    (effort) => EFFORT_LABELS.get(effort) ?? effort,
    manager,
  );
}

function labelOf(store: Store | null): string | undefined {
  return itemLabelOver(store === null ? {} : { child: store })({ sessionId: 'child' });
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

  test('a sub-agent with no session store and no saved model shows nothing', () => {
    expect(labelOf(null)).toBeUndefined();
  });

  test('a sub-agent with no session store shows the model saved on its row', () => {
    const label = itemLabelOver({})({
      sessionId: 'child',
      model: 'opus-5-5',
      reasoningEffort: 'high',
    });
    expect(label).toBe('Opus 5.5 (High)');
  });

  test('a loaded store wins over the model saved on the row', () => {
    const label = itemLabelOver({ child: storeOf('haiku-5-5', 'xhigh') })({
      sessionId: 'child',
      model: 'opus-5-5',
      reasoningEffort: 'high',
    });
    expect(label).toBe('Haiku 5.5 (Extra High)');
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
