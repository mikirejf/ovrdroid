import { describe, expect, test } from 'bun:test';

import { rerenderPatches } from '../rerender-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Hint {
  canOpen: boolean;
  attentionCount: number;
}

interface PrState {
  status: string;
  prUrl?: string | undefined;
  additions?: number | undefined;
}

interface PullRequest {
  kind: string;
  state: PrState;
}

interface FooterProps {
  width?: number;
  statusState?: string;
  pullRequest?: PullRequest | null;
  droidsHint?: Hint | undefined;
  onNothing?: () => number;
  ideState?: { file: { name: string } };
  when?: Date;
  list?: number[];
  extra?: number;
  a?: undefined;
  b?: undefined;
}

type Compare = (before: FooterProps, after: FooterProps) => boolean;

interface Memoed {
  render: () => string;
  compare: Compare | undefined;
}

interface Footer {
  EB: Memoed;
  ZG: Memoed;
  pme: Memoed;
  ZK: Memoed;
  footKey: (usage: number | null | undefined) => string;
}

interface Settings {
  tokenUsage: boolean;
  nerdFont: boolean;
}

interface SettingsReader {
  getShowTokenUsageIndicator: () => boolean;
  getNerdFont: () => boolean;
}

function memo(render: () => string, compare?: Compare): Memoed {
  return { render, compare };
}

function footerWith(settings: Settings, percentCalls: number[]): Footer {
  const reader = (): SettingsReader => ({
    getShowTokenUsageIndicator: () => settings.tokenUsage,
    getNerdFont: () => settings.nerdFont,
  });
  const percent = (usage: number): string => {
    percentCalls.push(usage);
    return `${usage}%`;
  };
  return payloadFunction<[object, typeof memo, typeof reader, typeof percent], Footer>(
    ['cP', 'dp', 'C', 'Mhe'],
    `let EB=()=>"footer",ZG=()=>"status line",pme=()=>"tasks",ZK=()=>"migration";${patchNamed(rerenderPatches, 'footer-memo').replace};return{EB,ZG,pme,ZK,footKey:$ODfootKey}`,
  )({}, memo, reader, percent);
}

function compareOf(memoed: Memoed): Compare {
  if (memoed.compare === undefined) {
    throw new Error('the component has no compare function');
  }
  return memoed.compare;
}

const DROIDS: Hint = { canOpen: true, attentionCount: 2 };
const PR: PrState = { status: 'found', prUrl: 'u', additions: 1 };
function NOTHING(): number {
  return 0;
}

function propsOf(extra: FooterProps = {}): FooterProps {
  return {
    width: 120,
    statusState: 'idle',
    pullRequest: { kind: 'branch', state: PR },
    droidsHint: DROIDS,
    onNothing: NOTHING,
    ...extra,
  };
}

describe('footer-memo', () => {
  const footer = footerWith({ tokenUsage: false, nerdFont: false }, []);
  const same = compareOf(footer.EB);

  test('the footer is wrapped with a compare, and the three labels with plain memo', () => {
    expect(footer.EB.render()).toBe('footer');
    expect(footer.EB.compare).toBeDefined();
    for (const label of [footer.ZG, footer.pme, footer.ZK]) {
      expect(label.compare).toBeUndefined();
    }
    expect(footer.ZG.render()).toBe('status line');
    expect(footer.pme.render()).toBe('tasks');
    expect(footer.ZK.render()).toBe('migration');
  });

  test('the same props are equal', () => {
    const one = propsOf();
    expect(same(one, one)).toBe(true);
    expect(same(one, { ...one })).toBe(true);
  });

  test('a fresh flat object with the same fields is equal, so the pull request and hint objects do not rerender', () => {
    const after = propsOf({
      pullRequest: { kind: 'branch', state: PR },
      droidsHint: { canOpen: true, attentionCount: 2 },
    });
    expect(same(propsOf(), after)).toBe(true);
  });

  test('a pull request wrapping a fresh copy of the same state is different, so the service must keep its state', () => {
    const after = propsOf({ pullRequest: { kind: 'branch', state: { ...PR } } });
    expect(same(propsOf(), after)).toBe(false);
  });

  test('a changed scalar is different', () => {
    const before = propsOf();
    expect(same(before, { ...before, width: 100 })).toBe(false);
    expect(same(before, { ...before, statusState: 'streaming' })).toBe(false);
  });

  test('a changed field inside a flat object is different', () => {
    const before = propsOf();
    expect(same(before, { ...before, pullRequest: { kind: 'session', state: PR } })).toBe(false);
    expect(same(before, { ...before, droidsHint: { canOpen: true, attentionCount: 3 } })).toBe(
      false,
    );
  });

  test('a hint that appears or goes away is different', () => {
    const shown = propsOf();
    const hidden = propsOf({ droidsHint: undefined });
    expect(same(shown, hidden)).toBe(false);
    expect(same(hidden, shown)).toBe(false);
  });

  test('a fresh function is different', () => {
    const before = propsOf();
    expect(same(before, { ...before, onNothing: () => 0 })).toBe(false);
  });

  test('an object inside an object is compared by identity, one level deep only', () => {
    const inner = { name: 'a' };
    expect(
      same(propsOf({ ideState: { file: inner } }), propsOf({ ideState: { file: inner } })),
    ).toBe(true);
    expect(
      same(propsOf({ ideState: { file: inner } }), propsOf({ ideState: { file: { name: 'a' } } })),
    ).toBe(false);
  });

  test('a prop that is added, dropped or renamed is different', () => {
    const before = propsOf();
    expect(same(before, { ...before, extra: 1 })).toBe(false);
    const { width: _width, ...without } = before;
    expect(same(before, without)).toBe(false);
    expect(same({ ...without, a: undefined }, { ...without, b: undefined })).toBe(false);
  });

  test('an object that is not a plain object is compared by identity', () => {
    const date = new Date(0);
    expect(same(propsOf({ when: date }), propsOf({ when: date }))).toBe(true);
    expect(same(propsOf({ when: date }), propsOf({ when: new Date(0) }))).toBe(false);
    expect(same(propsOf({ list: [1] }), propsOf({ list: [1] }))).toBe(false);
  });
});

describe('footer-memo reads what the footer reads outside its props', () => {
  test('the key follows the percentage the footer would show, so a model switch rerenders it', () => {
    const calls: number[] = [];
    const { footKey } = footerWith({ tokenUsage: true, nerdFont: false }, calls);
    expect(footKey(5000)).toBe('5000%|false');
    expect(calls).toEqual([5000]);
  });

  test('the key follows the nerd font setting and the token usage setting', () => {
    const settings = { tokenUsage: true, nerdFont: false };
    const { footKey } = footerWith(settings, []);
    const before = footKey(100);
    settings.nerdFont = true;
    const withFont = footKey(100);
    settings.tokenUsage = false;
    const withoutUsage = footKey(100);
    expect(new Set([before, withFont, withoutUsage]).size).toBe(3);
  });

  test('without the indicator, or without usage, the percentage is not computed', () => {
    const calls: number[] = [];
    const settings = { tokenUsage: false, nerdFont: false };
    const { footKey } = footerWith(settings, calls);
    footKey(100);
    settings.tokenUsage = true;
    footKey(null);
    footKey(0);
    expect(calls).toEqual([]);
  });
});

describe('footer-memo-key', () => {
  test('adds the key to the footer props and nothing else', () => {
    const patch = patchNamed(rerenderPatches, 'footer-memo-key');
    expect(patch.replace.startsWith(patch.find)).toBe(true);
    expect(patch.replace.slice(patch.find.length)).toBe('$ODfresh:$ODfootKey(qD),');
  });
});
