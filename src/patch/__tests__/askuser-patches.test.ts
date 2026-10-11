import { describe, expect, test } from 'bun:test';

import { askUserPatches, askUserTextPatches } from '../askuser-patches.ts';
import { blockEnd } from '../tokens.ts';
import { describeStrayNames, occurrences, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid as stock, stockText } from './stock-scanner.ts';

const PATCH = patchNamed(askUserPatches, 'ask-user-tool-never-enabled');

describeStrayNames(askUserPatches);

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

const { patchedText, rebasedNamed } = shipped(askUserPatches);

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
    expect(replace).toBe('isAskUserEnabled:!1,usesCreateEditTools:');
    expect(occurrences(patchedText, replace)).toBe(1);
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
