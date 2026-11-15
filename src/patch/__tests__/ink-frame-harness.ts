import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp } from '../../binary/graph.ts';
import { inkFramePatches } from '../ink-frame-patches.ts';
import { patches } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { rebaseAll } from '../rebase.ts';
import { stock } from './session-mention-harness.ts';

export const STOCK = stock;

export function sourceApp(): App {
  if (STOCK === undefined) {
    throw new Error('no stock Droid to read');
  }
  return STOCK;
}

const rebases = rebaseAll(
  inkFramePatches,
  (STOCK ?? []).map((module) => module.text),
);

export function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the Ink frame patches`);
  }
  return found;
}

export function renamed(rebase: Rebase, written: string): string {
  return rebase.renames[written] ?? written;
}

export function moduleHolding(app: App, text: string): string {
  const found = app.find((module) => module.text.includes(text));
  if (found === undefined) {
    throw new Error('no module carries the anchor');
  }
  return found.name;
}

export function textOf(app: App, name: string): string {
  const found = app.find((module) => module.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the app`);
  }
  return found.text;
}

let shippedApp: App | undefined;
let shippedJoined: string | undefined;

export function shippedPatched(): App {
  shippedApp ??= patchSource(sourceApp(), patches);
  return shippedApp;
}

export function shippedText(): string {
  shippedJoined ??= joinApp(shippedPatched());
  return shippedJoined;
}

export function patchedApp(): App {
  return patchSource(sourceApp(), inkFramePatches);
}
