import type { Rebase } from '../rebase.ts';
import { blockEnd } from '../tokens.ts';

export function rebasedNamed(rebased: readonly Rebase[], name: string): Rebase {
  const rebase = rebased.find((entry) => entry.name === name);
  if (rebase === undefined) {
    throw new TypeError(`${name} is missing from the session mention patches`);
  }
  return rebase;
}

export function callbackAround(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  if (at === -1) {
    throw new Error('the patched suggestions callback is missing');
  }
  const start = text.lastIndexOf('async(', at);
  const open = text.indexOf('=>{', start) + 2;
  return text.slice(start, blockEnd(text, open) + 1);
}

export function setterArrow(replace: string): string {
  const arrow = /^[\w$]+=[\w$]+\((?<arrow>.*),\[[\w$,]*\]\)$/su.exec(replace)?.groups?.['arrow'];
  if (arrow === undefined) {
    throw new Error('the patched setShowSuggestions has an unexpected shape');
  }
  return arrow;
}

export function calleeAfter(source: string, pattern: RegExp): string {
  const name = pattern.exec(source)?.groups?.['name'];
  if (name === undefined) {
    throw new Error(`the suggestions callback no longer matches ${pattern.source}`);
  }
  return name;
}

export function escaped(name: string): string {
  return name.replaceAll('$', String.raw`\$`);
}
