import { arrowAt } from './first-message-harness.ts';

export function callbackAround(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  if (at === -1) {
    throw new Error('the patched suggestions callback is missing');
  }
  return arrowAt(text, text.lastIndexOf('async(', at));
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

export function cancelArrow(text: string, name: string, sequence: string): string {
  const at = new RegExp(
    String.raw`[^\w$]${escaped(name)}=[\w$]+\(\(\)=>\{if\(${escaped(sequence)}\.current\+=1,`,
    'u',
  ).exec(text)?.index;
  if (at === undefined) {
    throw new Error('the stock suggestion cancel callback is missing');
  }
  return arrowAt(text, text.indexOf('(()=>', at) + 1);
}
