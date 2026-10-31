import type { Frame } from '../session.ts';

export function frame(atMs: number, text: string): Frame {
  return { atMs, text };
}

export function stockBox(input: string): string {
  return `╭────╮\n│ > ${input}   │\n╰────╯`;
}

export function flatBox(input: string): string {
  return `────\n  > ${input}\n────`;
}
