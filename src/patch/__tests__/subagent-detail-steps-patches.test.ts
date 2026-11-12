import { describe, expect, mock, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { subagentDetailStepsPatches } from '../subagent-detail-steps-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(subagentDetailStepsPatches);

interface Update {
  type: string;
  text?: string;
  toolName?: string;
}

interface SubscriptionInput {
  input: { subagent_type?: string };
  toolUseId: string;
  progressUpdates?: Update[] | undefined;
}

type Child = string | boolean | Element | Child[];

interface Props {
  flexDirection?: string;
  color?: string;
  children: Child;
}

interface Element {
  type: string;
  props: Props;
  key: string | undefined;
}

interface Row {
  key: string;
  node: string;
}

type Subscribe = (input: SubscriptionInput) => { updates: Update[] };
type Jsx = (type: string, props: Props, key?: string) => Element;
type Translate = () => { t: (key: string, values?: { count: number }) => string };
type DetailSteps = (
  input: SubscriptionInput & { step: (update: Update, index: number) => Row | null },
) => Element;

function element(type: string, props: Props, key?: string): Element {
  return { type, props, key };
}

function detailSteps(subscribe: Subscribe): DetailSteps {
  const component = patchNamed(subagentDetailStepsPatches, 'subagent-detail-steps-component');
  return payloadFunction<
    [Subscribe, Jsx, Jsx, string, string, { text: { muted: string } }, Translate, number],
    DetailSteps
  >(
    ['phe', 'l', 't', 'c', 'o', 'a', 'u', 'N1'],
    `${component.replace.slice(component.find.length)};return $ODDetailSteps`,
  )(
    subscribe,
    element,
    element,
    'Box',
    'Text',
    { text: { muted: 'muted' } },
    () => ({
      t: (key, values) => `${key}${values === undefined ? '' : `:${values.count}`}`,
    }),
    10,
  );
}

function step(update: Update, index: number): Row | null {
  return update.text === undefined ? null : { key: `step-${index}`, node: update.text };
}

describe('direct-child detailed updates', () => {
  test('subscribes by the direct Task id and renders live updates without progress events', () => {
    const updates: Update[] = [
      { type: 'status', text: 'Starting' },
      { type: 'tool_call', toolName: 'Read', text: 'Read src/main.ts' },
    ];
    const subscribe = mock<Subscribe>(() => ({ updates }));
    const render = detailSteps(subscribe);
    const input = { subagent_type: 'reviewer' };

    expect(render({ input, toolUseId: 'direct-task', step })).toEqual(
      element('Box', {
        flexDirection: 'column',
        children: [
          false,
          [
            element('Box', { children: 'Starting' }, 'step-0'),
            element('Box', { children: 'Read src/main.ts' }, 'step-1'),
          ],
        ],
      }),
    );
    expect(subscribe.mock.calls).toEqual([
      [{ input, toolUseId: 'direct-task', progressUpdates: undefined }],
    ]);
  });

  test('new child updates appear on the next subscribed render', () => {
    const updates: Update[] = [];
    const render = detailSteps(() => ({ updates }));
    const args = { input: {}, toolUseId: 'direct-task', step };

    expect(render(args)).toEqual(
      element('Text', {
        color: 'muted',
        children: 'common:toolDisplay.task.initializingDetail',
      }),
    );
    updates.push({ type: 'message', text: 'Reviewing callers' });
    expect(render(args)).toEqual(
      element('Box', {
        flexDirection: 'column',
        children: [false, [element('Box', { children: 'Reviewing callers' }, 'step-0')]],
      }),
    );
  });

  test('keeps progress events available to the stock subscription fallback', () => {
    const progressUpdates = [{ type: 'status', text: 'Queued' }];
    const render = detailSteps(({ progressUpdates: updates }) => ({ updates: updates ?? [] }));

    expect(render({ input: {}, toolUseId: 'direct-task', progressUpdates, step })).toEqual(
      element('Box', {
        flexDirection: 'column',
        children: [false, [element('Box', { children: 'Queued' }, 'step-0')]],
      }),
    );
  });

  test('ignores undisplayed updates and shows the last ten formatted rows', () => {
    const updates: Update[] = [
      ...Array.from({ length: 12 }, (_, index) => ({ type: 'status', text: `Update ${index}` })),
      { type: 'message' },
    ];
    const render = detailSteps(() => ({ updates }));

    expect(render({ input: {}, toolUseId: 'direct-task', step })).toEqual(
      element('Box', {
        flexDirection: 'column',
        children: [
          element('Text', {
            color: 'muted',
            children: 'common:toolDisplay.task.earlierUpdates:2',
          }),
          Array.from({ length: 10 }, (_, index) =>
            element('Box', { children: `Update ${index + 2}` }, `step-${index + 2}`),
          ),
        ],
      }),
    );
  });
});

const { patchedText, rebasedNamed } = shipped(subagentDetailStepsPatches);

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  test.each(subagentDetailStepsPatches.map((patch) => [patch.name] as const))(
    '%s applies and is in the patched source',
    (name) => {
      const patch = rebasedNamed(name);
      expect(applies(patch)).toBe(true);
      expect(patchedText).toContain(patch.replace);
    },
  );

  test('the detailed view formats every step through the stock switch, rendered live', () => {
    const formatter = rebasedNamed('subagent-ui-detail-step');
    const returns = rebasedNamed('subagent-ui-detail-step-returns');
    const live = rebasedNamed('subagent-ui-detail-live-steps');
    expect(formatter.replace).toContain('function $ODstep(');
    expect(live.replace).toContain('($ODDetailSteps,{input:');
    expect(patchedText).not.toContain(returns.find);
    expect(patchedText).toContain(returns.replace);
  });
});
