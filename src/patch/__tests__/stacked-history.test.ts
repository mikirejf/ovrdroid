import { describe, expect, mock, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import { rewindScrollPatches } from '../rewind-scroll-patches.ts';
import {
  DRAWS_NOTHING,
  HOOKS_SHOW,
  RUN_CALLS,
  RUN_UNIT,
  STACK,
  stackedViewPatches,
  TABLES,
} from '../stacked-view-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { stock } from './session-mention-harness.ts';

const SLOW_PATCH_MS = 120_000;

const historyMode = patchNamed(stackedViewPatches, 'stacked-view-history-mode');
const historyPage = patchNamed(stackedViewPatches, 'stacked-view-history-page-prop');
const historyUnits = patchNamed(stackedViewPatches, 'stacked-view-history-units');

interface Item {
  id: string;
  toolName?: string;
  status?: string;
}

interface Unit {
  kind: string;
  item?: Item;
  sourceIds: string[];
  group?: { tools: Item[]; $ODopen?: boolean };
}

interface PageProps {
  toolOutputMode: string;
  hookRowsShown: boolean;
  showThinking: boolean;
  images: null;
  onPageHeight: null;
  $ODstacked: boolean;
}

interface HistorySettings {
  getToolOutputDisplay: () => string;
  getShowHookOutput: () => boolean;
}

type BuildUnits = (
  units: Unit[],
  options: Pick<PageProps, 'toolOutputMode' | 'hookRowsShown'>,
) => Unit[];

function pass(units: Unit[]): Unit[] {
  return units;
}

const windowPageProps = payloadFunction<[() => HistorySettings, boolean, null, null], PageProps>(
  ['f', 'B', 'Z', 'V'],
  `${historyMode.replace};return{${historyPage.replace}`,
);

const pageUnits = payloadFunction<
  [(item: Item) => boolean, () => object, BuildUnits, typeof pass, typeof pass],
  (
    props: PageProps & { page: { messages: Unit[] }; isMeasured: boolean; contentWidth: number },
  ) => Unit[]
>(
  ['va', 'iD', 'Qs', 'ic', 'UB'],
  `${TABLES}${HOOKS_SHOW}${RUN_CALLS}${DRAWS_NOTHING}${RUN_UNIT}${STACK}` +
    'let S=(current)=>({current}),sY=()=>void 0,k=(memo)=>memo();' +
    `return ({page:C,isMeasured:y,contentWidth:A,toolOutputMode:P,${historyUnits.replace}return t1}`,
);

function call(id: string, toolName: string): Unit {
  return { kind: 'item', item: { id, toolName, status: 'completed' }, sourceIds: [id] };
}

function page(mode: string, hookRowsShown = false, buildUnits: BuildUnits = pass): Unit[] {
  const text: Unit = { kind: 'item', item: { id: 'text' }, sourceIds: ['text'] };
  const props = windowPageProps(
    () => ({ getToolOutputDisplay: () => mode, getShowHookOutput: () => hookRowsShown }),
    false,
    null,
    null,
  );
  const renderPage = pageUnits(
    (item) => 'toolName' in item && 'status' in item,
    () => ({}),
    buildUnits,
    pass,
    pass,
  );
  return renderPage({
    ...props,
    page: { messages: [call('r1', 'Read'), call('g1', 'Grep'), text] },
    isMeasured: true,
    contentWidth: 80,
  });
}

function labels(units: Unit[]): string[] {
  return units.map((unit) =>
    unit.group === undefined ? unit.sourceIds.join(',') : `run:${unit.group.tools.length}`,
  );
}

describe('the scroll view', () => {
  test('a history page folds its calls into a closed run when the display is stacked', () => {
    const out = page('stacked');
    expect(labels(out)).toEqual(['run:2', 'text']);
    expect(out[0]?.group?.$ODopen).toBe(false);
  });

  test('a history page keeps every call when the display is not stacked', () => {
    expect(labels(page('expanded'))).toEqual(['r1', 'g1', 'text']);
  });

  test.each([true, false])(
    'the stock history builder receives stacked mode and hookRowsShown=%s',
    (hookRowsShown) => {
      const buildUnits = mock<BuildUnits>(pass);
      page('stacked', hookRowsShown, buildUnits);
      expect(buildUnits).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ toolOutputMode: 'stacked', hookRowsShown }),
      );
    },
  );
});

test.skipIf(stock === undefined)(
  'stacked history and rewind scroll apply together in shipped order',
  () => {
    const app = stock;
    if (app === undefined) {
      throw new Error('no stock Droid to patch');
    }
    const historyPatches = patches.filter(
      (patch) =>
        patch.name.startsWith('stacked-view-history-') || rewindScrollPatches.includes(patch),
    );
    expect(() => patchSource(app, historyPatches)).not.toThrow();
  },
  SLOW_PATCH_MS,
);
