import { describe, expect, test } from 'bun:test';

import { REPRINT, stackedViewPatches } from '../stacked-view-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

describe('building the main chat units', () => {
  test.each([false, true])('forwards stock hook visibility (%s) before folding', (showHooks) => {
    const { replace } = patchNamed(stackedViewPatches, 'stacked-view-units');
    const messages = ['message'];
    const stockUnits = ['stock unit'];
    const foldedUnits = ['folded unit'];
    const images = Symbol('images');
    const imageVersion = Symbol('image version');
    const cuts = new Map([['thought', [4]]]);
    const pending = new Set(['x1']);
    const pinned = new Set<string>();
    const options = {
      includeHeader: true,
      reskin: true,
      staticToolIds: pinned,
      view: { kind: 'chat', showThinking: true },
      images,
      streamingCuts: cuts,
      toolOutputMode: 'stacked',
      hookRowsShown: showHooks,
    };
    const buildUnits = payloadFunction<
      [
        (compute: () => string[], deps: unknown[]) => string[],
        (input: string[], stockOptions: typeof options) => string[],
        (
          units: string[],
          fold: { open: boolean; showThinking: boolean; awaiting: (id: string) => boolean },
        ) => string[],
        string[],
        Set<string>,
        boolean,
        symbol,
        symbol,
        boolean,
        typeof cuts,
        string,
        boolean,
        boolean,
        Set<string>,
      ],
      string[]
    >(
      [
        'k',
        'Qs',
        '$ODstack',
        'd1',
        'c1',
        'x1',
        '_1',
        'D1',
        'q',
        'T1',
        'L1',
        '$ODstacked',
        '$ODturn',
        'Z',
      ],
      `let ${replace}return P1`,
    );
    const result = buildUnits(
      (compute, deps) => {
        expect(deps).toEqual([
          pinned,
          showHooks,
          images,
          imageVersion,
          messages,
          true,
          cuts,
          'stacked',
          true,
          true,
          pending,
        ]);
        return compute();
      },
      (input, stockOptions) => {
        expect(input).toBe(messages);
        expect(stockOptions).toEqual(options);
        return stockUnits;
      },
      (units, fold) => {
        expect(units).toBe(stockUnits);
        expect(fold.open).toBe(true);
        expect(fold.showThinking).toBe(true);
        expect(fold.awaiting('r1')).toBe(false);
        expect(fold.awaiting('x1')).toBe(true);
        return foldedUnits;
      },
      messages,
      pinned,
      showHooks,
      images,
      imageVersion,
      true,
      cuts,
      'stacked',
      true,
      true,
      pending,
    );
    expect(result).toBe(foldedUnits);
  });
});

interface LayoutState {
  baseStaticKey: number | string;
  epoch: number;
}

interface LayoutCommit {
  state: LayoutState;
  cuts: Map<string, number[]>;
  staticKey: number;
  drawnSessionId: string;
  $ODstacked: boolean;
}

interface LayoutRef {
  current: LayoutCommit | undefined;
}

describe('switching display modes', () => {
  test('a switch into or out of stacked clears and reprints, expanded to compact does not', () => {
    const ref: LayoutRef = { current: undefined };
    let resets = 0;
    const effect = payloadFunction<
      [
        typeof ref,
        (run: () => void) => void,
        LayoutState,
        LayoutCommit['cuts'],
        () => void,
        number,
        string,
        boolean,
      ],
      undefined
    >(['k1', 'vn', 'q1', 'T1', 'r1', 'P', 'R1', '$ODstacked'], REPRINT);
    const render = (
      mode: string,
      epoch = 0,
      { staticKey = 1, drawnSessionId = 'initial' } = {},
    ) => {
      const stacked = mode === 'stacked';
      const state = { baseStaticKey: stacked ? `${staticKey}:stacked` : staticKey, epoch };
      const cuts = new Map([['thought', [4]]]);
      effect(
        ref,
        (run) => {
          run();
        },
        state,
        cuts,
        () => {
          resets += 1;
          expect(ref.current?.state).toBe(state);
        },
        staticKey,
        drawnSessionId,
        stacked,
      );
      expect(ref.current).toEqual({ state, cuts, staticKey, drawnSessionId, $ODstacked: stacked });
      return resets;
    };
    expect(render('stacked')).toBe(0);
    expect(render('stacked')).toBe(0);
    expect(render('expanded')).toBe(1);
    expect(render('compact')).toBe(1);
    expect(render('stacked')).toBe(2);
    expect(render('stacked', 1)).toBe(3);
    expect(render('stacked', 0, { staticKey: 2, drawnSessionId: 'next-session' })).toBe(3);
  });
});
