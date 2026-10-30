import type { Rebase } from '../rebase.ts';
import { arrowAt, evaluate, renamed } from './first-message-harness.ts';
import { rebasedNamed } from './payload.ts';
import { escaped } from './session-mention-callback.ts';
import type { Stand } from './session-mention-scope.ts';

export type KeyResult = boolean | string | null;

export interface Row {
  label: string;
  value: string;
  $ODsession?: string;
}

export interface Entry {
  selected: number;
  keyIndex: number;
  text: string;
  cursor: number;
}

export interface Hooks {
  close: (shown: boolean) => void;
  cancel: () => void;
  isShown: () => boolean;
  rows: () => readonly Row[];
  entry: Entry;
  picker: object;
}

export interface KeyEvent {
  kind: string;
  key: string;
  modifiers: { ctrl: boolean; shift: boolean; alt: string };
}

interface KeyWant {
  ctrl?: boolean;
  shift?: boolean;
  altFamily?: boolean;
}

export function namedKey(key: string, modifiers: Partial<KeyEvent['modifiers']> = {}): KeyEvent {
  return {
    kind: 'named',
    key,
    modifiers: { ctrl: false, shift: false, alt: 'none', ...modifiers },
  };
}

function keyIs(event: KeyEvent, key: string, want: KeyWant = {}): boolean {
  const { ctrl, shift, alt } = event.modifiers;
  return (
    event.kind === 'named' &&
    event.key === key &&
    (want.ctrl === undefined || ctrl === want.ctrl) &&
    (want.shift === undefined || shift === want.shift) &&
    (want.altFamily === undefined || (alt !== 'none') === want.altFamily)
  );
}

export interface EscapeKeys {
  readonly escapes: string[];
  readonly bash: { active: boolean };
  press: () => KeyResult;
}

export interface EnterKey {
  readonly written: string[];
  press: () => boolean;
  down: () => boolean;
  scope: (event: KeyEvent) => boolean;
}

function arrowAround(text: string, anchor: number, wrapper: string): string {
  return arrowAt(text, text.lastIndexOf(`=${wrapper}((`, anchor) + wrapper.length + 2);
}

function callbackName(rebased: readonly Rebase[]): string {
  return renamed(rebasedNamed(rebased, 'session-mention-close-cancels'))('g');
}

function group(match: RegExpExecArray | null, name: string, what: string): string {
  const found = match?.groups?.[name];
  if (found === undefined) {
    throw new Error(`the stock ${what} is missing`);
  }
  return found;
}

function stockCloseMenus(
  patched: string,
  suggest: (name: string) => string,
  hooks: Hooks,
): () => void {
  const close = new RegExp(
    String.raw`=[\w$]+\((?<arrow>\(\)=>\{${escaped(suggest('Yi'))}\(\),${escaped(suggest('Qt'))}\(!1\),[\w$]+\(!1\)\}),\[`,
    'u',
  ).exec(patched);
  return evaluate<() => void>(
    group(close, 'arrow', 'closeAutocompleteMenus callback'),
    new Map<string, Stand>([
      [suggest('Yi'), hooks.cancel],
      [suggest('Qt'), hooks.close],
    ]),
  );
}

function stockBashEscape(
  patched: string,
  { name, wrapper }: { name: string; wrapper: string },
  bash: { active: boolean },
): () => boolean {
  const arrow = new RegExp(
    String.raw`[^\w$]${escaped(name)}=${escaped(wrapper)}\((?<arrow>\(\)=>(?<flag>[\w$]+)\.current&&(?<leave>[\w$]+)\(\)),\[`,
    'u',
  ).exec(patched);
  return evaluate<() => boolean>(
    group(arrow, 'arrow', 'bash-mode Esc callback'),
    new Map<string, Stand>([
      [
        group(arrow, 'flag', 'bash-mode Esc callback'),
        {
          get current() {
            return bash.active;
          },
        },
      ],
      [
        group(arrow, 'leave', 'bash-mode Esc callback'),
        () => {
          bash.active = false;
          return true;
        },
      ],
    ]),
  );
}

export function escapeKeys(patched: string, rebased: readonly Rebase[], hooks: Hooks): EscapeKeys {
  const suggest = renamed(rebasedNamed(rebased, 'session-mention-suggest'));
  const escapes: string[] = [];
  const bash = { active: false };
  const key = new RegExp(
    String.raw`\((?<key>[\w$]+)\)=>\{let\{showSuggestions:(?<list>[\w$]+),showCommands:(?<menu>[\w$]+)\}=(?<state>[\w$]+)\(\);` +
      String.raw`if\((?<is>[\w$]+)\(\k<key>,"escape"\)&&!\k<list>&&!\k<menu>\)\{if\((?<close>[\w$]+)\(\),(?<bash>[\w$]+)\(\)\)return!0;` +
      String.raw`if\((?<vim>[\w$]+)\(\)\)return!0;return (?<escape>[\w$]+)\(\)\}return!1\}`,
    'u',
  ).exec(patched);
  const what = 'Esc key handler';
  const press = evaluate<(event: KeyEvent) => KeyResult>(
    key?.[0] ?? '',
    new Map<string, Stand>([
      [
        group(key, 'state', what),
        () => ({ showSuggestions: hooks.isShown(), showCommands: false }),
      ],
      [group(key, 'is', what), keyIs],
      [group(key, 'close', what), stockCloseMenus(patched, suggest, hooks)],
      [
        group(key, 'bash', what),
        stockBashEscape(
          patched,
          { name: group(key, 'bash', what), wrapper: callbackName(rebased) },
          bash,
        ),
      ],
      [group(key, 'vim', what), () => false],
      [
        group(key, 'escape', what),
        () => {
          escapes.push('escape');
          return 'stock escape';
        },
      ],
    ]),
  );
  return { escapes, bash, press: () => press(namedKey('escape')) };
}

export function enterKey(patched: string, rebased: readonly Rebase[], hooks: Hooks): EnterKey {
  const rebase = rebasedNamed(rebased, 'session-mention-select');
  const named = renamed(rebase);
  const at = patched.indexOf(rebase.replace);
  if (at === -1) {
    throw new Error('the patched select callback is missing');
  }
  const select = arrowAround(patched, at, callbackName(rebased));
  const di = escaped(named('Di'));
  const writes = new RegExp(
    String.raw`(?<text>[\w$]+)\(${di}\.newText\),(?<cursor>[\w$]+)\(${di}\.newCursorPosition\)`,
    'u',
  ).exec(select);
  const written: string[] = [];
  const selectRow = evaluate<
    (pick: { suggestion: Row; input: string; cursorPosition: number }) => void
  >(
    select,
    new Map<string, Stand>([
      [named('uu'), hooks.picker],
      [renamed(rebasedNamed(rebased, 'session-mention-suggest'))('Yi'), hooks.cancel],
      [group(writes, 'text', 'select callback'), (text: string) => written.push(text)],
      [
        group(writes, 'cursor', 'select callback'),
        () => {
          hooks.close(false);
        },
      ],
    ]),
  );
  const marker = /"tab"\)\|\|[\w$]+\([\w$]+,"return"/u;
  let handlerAt = patched.indexOf('{suggestion:');
  while (handlerAt !== -1 && !marker.test(patched.slice(Math.max(0, handlerAt - 120), handlerAt))) {
    handlerAt = patched.indexOf('{suggestion:', handlerAt + 1);
  }
  if (handlerAt === -1) {
    throw new Error('the stock suggestion key handler is missing');
  }
  const handler = arrowAround(patched, handlerAt, callbackName(rebased));
  const parts =
    /let\{showSuggestions:[\w$]+,suggestions:[\w$]+\}=(?<state>[\w$]+)\(\);.*?"upArrow"\)\)return (?<move>[\w$]+)\(.*?return (?<select>[\w$]+)\(\{suggestion:[\w$]+\[(?<index>[\w$]+)\.current\],input:(?<input>[\w$]+)\.current,cursorPosition:(?<cursor>[\w$]+)\.current\}\),!0;if\((?<is>[\w$]+)\([\w$]+,"escape"\)\)return (?<un>[\w$]+)\(\)/u.exec(
      handler,
    );
  const quiet = {
    get current(): number {
      return hooks.entry.keyIndex;
    },
  };
  const scopeNamed = renamed(rebasedNamed(rebased, 'session-mention-scope-key'));
  const what = 'suggestion key handler';
  const press = evaluate<(event: KeyEvent) => boolean>(
    handler,
    new Map<string, Stand>([
      [scopeNamed('uu'), hooks.picker],
      [group(parts, 'is', what), keyIs],
      [
        group(parts, 'state', what),
        () => ({ showSuggestions: hooks.isShown(), suggestions: hooks.rows() }),
      ],
      [
        group(parts, 'move', what),
        (advance: (at: number) => number) => {
          hooks.entry.keyIndex = advance(hooks.entry.keyIndex);
          hooks.entry.selected = hooks.entry.keyIndex;
        },
      ],
      [group(parts, 'select', what), selectRow],
      [group(parts, 'index', what), quiet],
      [
        group(parts, 'input', what),
        {
          get current(): string {
            return hooks.entry.text;
          },
        },
      ],
      [
        group(parts, 'cursor', what),
        {
          get current(): number {
            return hooks.entry.cursor;
          },
        },
      ],
      [
        group(parts, 'un', what),
        () => {
          hooks.close(false);
        },
      ],
    ]),
  );
  return {
    written,
    press: () => press(namedKey('return')),
    down: () => press(namedKey('downArrow')),
    scope: (event) => press(event),
  };
}

export interface Warmup {
  readonly timers: { run: () => void; delay: number }[];
  readonly cleared: number[];
  readonly loaded: string[];
}

export function serviceEffect(
  rebased: readonly Rebase[],
  stands: { cancel: Stand; search: Stand },
  warmup: Warmup,
): (service: Stand) => () => void {
  const rebase = rebasedNamed(rebased, 'session-mention-service-drops');
  const named = renamed(rebase);
  return (service) => {
    let cleanup: (() => void) | null = null;
    evaluate<undefined>(
      rebase.replace,
      new Map<string, Stand>([
        [
          named('v'),
          (effect: () => () => void) => {
            cleanup = effect();
          },
        ],
        [named('Yi'), stands.cancel],
        [named('uu'), stands.search],
        ['setTimeout', (run: () => void, delay: number) => warmup.timers.push({ run, delay })],
        ['clearTimeout', (timer: number) => warmup.cleared.push(timer)],
        [
          named('p'),
          () => ({
            getSessionsForSelector: async (cwd: string) => {
              await Promise.resolve();
              warmup.loaded.push(cwd);
              return [];
            },
          }),
        ],
        [named('h'), () => 0],
        [named('Ba'), service],
      ]),
    );
    return () => {
      if (cleanup === null) {
        throw new Error('the service effect did not register a cleanup');
      }
      cleanup();
    };
  };
}
