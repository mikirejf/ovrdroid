import { copySelectPatches } from '../copy-select-patches.ts';
import type { Patch } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebasePatch } from '../rebase.ts';
import { closureOf, declarationText } from './module-closure.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { requireStock } from './stock-scanner.ts';

interface ShellSpan {
  text: string;
  style?: { color?: string; dim?: boolean; inverse?: boolean };
}

type ShellRenderer = (options: {
  handoff: { draft: string; placeholder: string; cursor: number };
  width: number;
  windowsLike: boolean;
}) => ShellSpan[][];

function wrapShellFixture(text: string, width: number) {
  const ends: number[] = [];
  for (let at = 0; at < text.length; at += width) {
    ends.push(Math.min(text.length, at + width));
  }
  return { ends: ends.length === 0 ? [0] : ends, visible: text };
}

function resolveShellPatch(patch: Patch, modules: readonly string[]): Rebase {
  const rebased = rebasePatch(patch, modules);
  if (!applies(rebased)) {
    throw new Error(`${patch.name}: ${rebased.status}`);
  }
  return rebased;
}

function shellName(rebased: Rebase, original: string): string {
  return rebased.renames[original] ?? original;
}

function sourceOf(patch: Rebase, modules: readonly string[]): string {
  const source = modules.find((module) => module.includes(patch.find));
  if (source === undefined) {
    throw new Error(`${patch.name}: the resolved code has no module`);
  }
  return source;
}

function captureLayout(modules: readonly string[]) {
  const layout = resolveShellPatch(
    {
      name: 'shell-wrapped-layout',
      find: 'function N2({value:e,maxLineWidth:n,firstLineInset:t=0}){',
      replace: '',
    },
    modules,
  );
  const source = sourceOf(layout, modules);
  const cursor = resolveShellPatch(
    {
      name: 'shell-cursor-layout',
      find: 'function D2({wrappedLayout:e,cursorOffset:n}){',
      replace: '',
    },
    [source],
  );
  const roots = [shellName(layout, 'N2'), shellName(cursor, 'D2')];
  const closure = closureOf(source, roots);
  const wrapping = resolveShellPatch(
    {
      name: 'shell-line-wrap',
      find: 'let h=r[u]??"",{ends:g,visible:m}=Yue(h,o,u===0?s:o),f=m===h,S=0;',
      replace: '',
    },
    [closure],
  );
  return { closure, roots, parameters: [shellName(wrapping, 'Yue')] };
}

export function captureShell(modules: readonly string[]) {
  const patch = resolveShellPatch(
    patchNamed(copySelectPatches, 'copy-select-early-input-flat'),
    modules,
  );
  const source = sourceOf(patch, modules);
  const root = shellName(patch, 'OTe');
  const widths = resolveShellPatch(
    {
      name: 'shell-span-width',
      find: 'function mt(e){return e.reduce((n,t)=>n+ee(t.text),0)}',
      replace: '',
    },
    [declarationText(source, shellName(patch, 'mt'))],
  );
  return {
    source,
    patch,
    root,
    layout: captureLayout(modules),
    parameters: [
      shellName(patch, 'a'),
      shellName(widths, 'ee'),
      shellName(patch, 'N2'),
      shellName(patch, 'D2'),
    ],
  };
}

export function shippedShell() {
  return captureShell(requireStock().map((module) => module.text));
}

export function shellRenderer(
  fixture: ReturnType<typeof captureShell>,
  patched: boolean,
): ShellRenderer {
  const { source, patch, root, parameters, layout } = fixture;
  const text = patched ? source.replace(patch.find, patch.replace) : source;
  const helpers = payloadFunction<unknown[], unknown[]>(
    layout.parameters,
    `${layout.closure};return [${layout.roots.join(',')}]`,
  )(wrapShellFixture);
  return payloadFunction<unknown[], ShellRenderer>(
    parameters,
    `${closureOf(text, [root])};return ${root}`,
  )({ border: 'gray', primary: 'magenta' }, Bun.stringWidth, ...helpers);
}
