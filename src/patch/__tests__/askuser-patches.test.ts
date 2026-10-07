import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp, readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { askUserPatches, askUserTextPatches } from '../askuser-patches.ts';
import { findMarker } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { rebaseAll } from '../rebase.ts';
import { blockEnd, freeNames } from '../tokens.ts';
import { patchNamed, payloadFunction } from './payload.ts';

const PATCH = patchNamed(askUserPatches, 'ask-user-tool-never-enabled');

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(askUserPatches.map((patch) => [patch.name, patch] as const))('%s', (_name, patch) => {
    const known = new Set(
      [patch.find, patch.until ?? '', ...(patch.lookups ?? [])].flatMap((text) => freeNames(text)),
    );
    const stray = freeNames(patch.replace).filter(
      (name) => !name.startsWith('$OD') && !known.has(name),
    );
    expect(stray).toEqual([]);
  });
});

interface ToolContext {
  cliDroidMode: string;
  askUserToolEnabled: boolean;
}

type EnabledCheck = boolean | ((context: ToolContext) => boolean);

function enabledCheckOf(payload: string): (context: ToolContext) => boolean {
  const property = payload.slice(payload.indexOf('isToolEnabled:'));
  const check = payloadFunction<[], { isToolEnabled: EnabledCheck }>([], `return{${property}}`)()
    .isToolEnabled;
  return typeof check === 'boolean' ? () => check : check;
}

const TERMINAL_UI: ToolContext = { cliDroidMode: 'terminal-ui', askUserToolEnabled: true };

const SURFACES = [
  ['the terminal UI', TERMINAL_UI],
  ['the interactive CLI', { cliDroidMode: 'interactive-cli', askUserToolEnabled: true }],
  ['droid exec', { cliDroidMode: 'exec', askUserToolEnabled: true }],
  ['ACP mode', { cliDroidMode: 'terminal-ui', askUserToolEnabled: false }],
] as const;

describe('the AskUser tool is off on every surface', () => {
  test('stock Droid turns it on in the terminal UI', () => {
    expect(enabledCheckOf(PATCH.find)(TERMINAL_UI)).toBe(true);
  });

  test.each(SURFACES)('the patched check says no in %s', (_surface, context) => {
    expect(enabledCheckOf(PATCH.replace)(context)).toBe(false);
  });
});

function stockAppAt(target: string): App | undefined {
  if (!existsSync(target)) {
    return undefined;
  }
  const app = readApp(readFileSync(target));
  return findMarker(app[0].text) === undefined ? app : undefined;
}

const stock = stockAppAt(INSTALLED_DROID) ?? stockAppAt(backupPath(INSTALLED_DROID));

const stockText = stock === undefined ? '' : joinApp(stock);
const patchedText = stock === undefined ? '' : joinApp(patchSource(stock, askUserPatches));

const rebased = new Map(
  rebaseAll(
    askUserPatches,
    (stock ?? []).map((module) => module.text),
  ).map((rebase) => [rebase.name, rebase] as const),
);

function rebasedNamed(name: string): Rebase {
  const rebase = rebased.get(name);
  if (rebase === undefined) {
    throw new TypeError(`${name} is missing from the AskUser patches`);
  }
  return rebase;
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

const ASK_USER_GATE = /askUserToolEnabled:(?<flag>[\w$]+)\}\)=>\k<flag>===!0/gu;

describe.skipIf(stock === undefined)('the shipped AskUser tool definition', () => {
  test('is switched off once patched', () => {
    const { find, replace } = rebasedNamed('ask-user-tool-never-enabled');
    expect(occurrences(stockText, find)).toBe(1);
    expect(occurrences(patchedText, find)).toBe(0);
    expect(occurrences(patchedText, replace)).toBe(1);
  });

  test('leaves every other tool that reads the AskUser flag alone', () => {
    const stockGates = [...stockText.matchAll(ASK_USER_GATE)].length;
    expect(stockGates).toBeGreaterThan(1);
    expect([...patchedText.matchAll(ASK_USER_GATE)]).toHaveLength(stockGates - 1);
  });
});

const SPEC_REMINDER =
  /function [\w$]+\(\{isAskUserEnabled:[\w$]+,usesCreateEditTools:[\w$]+\}\)\{/u;

interface ReminderFlags {
  isAskUserEnabled: boolean;
  usesCreateEditTools: boolean;
}

function specReminderIn(text: string): (flags: ReminderFlags) => string {
  const head = SPEC_REMINDER.exec(text);
  if (head === null) {
    throw new Error('the spec-mode reminder builder is missing');
  }
  const open = head.index + head[0].length - 1;
  const source = text.slice(head.index, blockEnd(text, open) + 1);
  return payloadFunction<[], (flags: ReminderFlags) => string>([], `return ${source}`)();
}

describe.skipIf(stock === undefined)('the spec-mode reminder', () => {
  test('stock Droid tells the model to use AskUser when the flag is on', () => {
    const reminder = specReminderIn(stockText);
    expect(reminder({ isAskUserEnabled: true, usesCreateEditTools: true })).toContain('AskUser');
  });

  test('the branch the patch forces never names AskUser', () => {
    const reminder = specReminderIn(patchedText);
    const text = reminder({ isAskUserEnabled: false, usesCreateEditTools: true });
    expect(text).toContain('Spec mode is active.');
    expect(text).not.toContain('AskUser');
  });

  test('the caller builds the reminder with the flag off', () => {
    const { find, replace } = rebasedNamed('spec-reminder-without-ask-user');
    expect(occurrences(stockText, find)).toBe(1);
    expect(occurrences(patchedText, find)).toBe(0);
    expect(occurrences(patchedText, `${replace},usesCreateEditTools:`)).toBe(1);
  });
});

const textPatchNames = askUserTextPatches.map((patch) => [patch.name] as const);

const rewrittenNames = askUserTextPatches
  .filter((patch) => patch.replace !== '')
  .map((patch) => [patch.name] as const);

describe.skipIf(stock === undefined)('each instruction to use AskUser is gone', () => {
  test.each(textPatchNames)('%s', (name) => {
    const { find, replace } = rebasedNamed(name);
    expect(find).toContain('AskUser');
    expect(occurrences(stockText, find)).toBe(1);
    expect(occurrences(patchedText, find)).toBe(0);
    expect(replace).not.toContain('AskUser');
  });
});

describe.skipIf(stock === undefined)('each rewritten instruction asks in plain text', () => {
  test.each(rewrittenNames)('%s', (name) => {
    const { replace } = rebasedNamed(name);
    expect(replace).toMatch(/plain[ -]text/u);
    expect(occurrences(patchedText, replace)).toBe(1);
  });
});
