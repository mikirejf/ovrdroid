import { blockEnd } from '../tokens.ts';
import {
  moduleHolding,
  patchedApp,
  rebased,
  renamed,
  sourceApp,
  textOf,
} from './ink-frame-harness.ts';
import { payloadFunction } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';
import { scoped, scopeOver } from './session-mention-harness.ts';

type Wrapper = ((text: string, width: number, rows: number) => string[]) & {
  $ODwraps?: Map<string, unknown>;
};

export interface Wrapping {
  wrapper: Wrapper;
  calls: () => number;
}

export interface WrapPair {
  stockWrap: Wrapping;
  patchedWrap: Wrapping;
}

function stubWrap(text: string, width: number): string {
  return text.match(new RegExp(`.{1,${width}}`, 'gu'))?.join('\n') ?? '';
}

function wrapperIn(text: string): Wrapping {
  const rebase = rebased('ink-frame-wrap-cache');
  const name = renamed(rebase, 'Gg');
  const open = text.indexOf(`${name}=(`);
  const arrow = text.slice(
    open + name.length + 1,
    blockEnd(text, text.indexOf('=>{', open) + 2) + 1,
  );
  let calls = 0;
  const stubs = new Map<string, Stand>([
    [
      renamed(rebase, '_n'),
      (line: string, width: number) => {
        calls += 1;
        return stubWrap(line, width);
      },
    ],
  ]);
  const wrapper = payloadFunction<[ReturnType<typeof scopeOver>], Wrapper>(
    ['$ODscope'],
    scoped(`(()=>{let ${name}=${arrow};return ${name}})()`),
  )(scopeOver(stubs));
  return { wrapper, calls: () => calls };
}

export function wrappers(): WrapPair {
  const name = moduleHolding(sourceApp(), rebased('ink-frame-wrap-cache').find);
  return {
    stockWrap: wrapperIn(textOf(sourceApp(), name)),
    patchedWrap: wrapperIn(textOf(patchedApp(), name)),
  };
}

export const FRAMES = [
  '',
  'one line',
  'short\n\nlonger than ten characters\n  indented line that wraps twice over\ntail',
  'a'.repeat(95),
  `${'word '.repeat(30)}\n${'x'.repeat(7)}\n`,
  Array.from({ length: 60 }, (_row, index) => `row ${index} ${'z'.repeat(index % 25)}`).join('\n'),
];
