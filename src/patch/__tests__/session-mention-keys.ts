import type { Rebase } from '../rebase.ts';
import { blockEnd } from '../tokens.ts';
import { payloadFunction } from './payload.ts';
import { escaped, rebasedNamed } from './session-mention-callback.ts';
import type { Stand } from './session-mention-scope.ts';
import { scoped, scopeOver } from './session-mention-scope.ts';

type Scope = ReturnType<typeof scopeOver>;
type Stubs = Map<string, Stand>;

export type KeyResult = boolean | string | null;
export type EscapePath = 'key' | 'sequence' | 'callback';

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
  isShown: () => boolean;
  rows: () => readonly Row[];
  entry: Entry;
  picker: object;
}

export interface EscapeKeys {
  readonly escapes: string[];
  readonly bash: { active: boolean };
  press: (path: EscapePath) => KeyResult;
}

export interface EnterKey {
  readonly written: string[];
  press: () => boolean;
  down: () => boolean;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
function evaluate<Fn>(source: string, stubs: Stubs): Fn {
  return payloadFunction<[Scope], Fn>(['$ODscope'], scoped(source))(scopeOver(stubs));
}

function renamed(rebase: Rebase): (name: string) => string {
  return (name) => rebase.renames[name] ?? name;
}

function arrowAround(text: string, anchor: number): string {
  const start = text.lastIndexOf('=g((', anchor) + 3;
  const open = text.indexOf('=>{', start) + 2;
  return text.slice(start, blockEnd(text, open) + 1);
}

function group(match: RegExpExecArray | null, name: string, what: string): string {
  const found = match?.groups?.[name];
  if (found === undefined) {
    throw new Error(`the stock ${what} is missing`);
  }
  return found;
}

function windowsAround(text: string, anchor: string): string[] {
  const windows: string[] = [];
  for (let at = text.indexOf(anchor); at !== -1; at = text.indexOf(anchor, at + 1)) {
    windows.push(text.slice(Math.max(0, at - 400), at + 160));
  }
  return windows;
}

export function escapeKeys(
  patched: string,
  rebased: readonly Rebase[],
  { close, isShown }: Hooks,
): EscapeKeys {
  const rebase = rebasedNamed(rebased, 'session-mention-escape');
  const named = renamed(rebase);
  const hi = escaped(named('Hi'));
  const escapes: string[] = [];
  const bash = { active: false };
  const windows = windowsAround(patched, `if(${named('Hi')}())return`);
  const keyMatcher = new RegExp(
    String.raw`\((?<key>[\w$]+)\)=>\{let\{showSuggestions:(?<list>[\w$]+),showCommands:(?<menu>[\w$]+)\}=(?<state>[\w$]+)\(\);` +
      String.raw`if\(\k<key>\.escape&&!\k<list>&&!\k<menu>\)\{if\(${hi}\(\)\)return!0;return (?<escape>[\w$]+)\(\)\}return!1\}`,
    'u',
  );
  const callbackMatcher = new RegExp(
    String.raw`\(\)=>\{let\{showSuggestions:(?<list>[\w$]+),showCommands:(?<menu>[\w$]+)\}=[\w$]+\(\);if\(\k<list>\|\|\k<menu>\)\{[\w$]+\(\);return\}if\(${hi}\(\)\)return;[\w$]+\(\)\}`,
    'u',
  );
  const key = windows.map((text) => keyMatcher.exec(text)).find((hit) => hit !== null) ?? null;
  const callback =
    windows.map((text) => callbackMatcher.exec(text)).find((hit) => hit !== null) ?? null;
  const sequenceAt = patched.indexOf('==="[27u"){if(');
  if (key === null || callback === null || sequenceAt === -1) {
    throw new Error('the stock Esc key handlers are missing');
  }
  const names = {
    state: group(key, 'state', 'Esc key handler'),
    escape: group(key, 'escape', 'Esc key handler'),
  };
  const stubs: Stubs = new Map<string, Stand>([
    [names.state, () => ({ showSuggestions: isShown(), showCommands: false })],
    [
      names.escape,
      () => {
        escapes.push('escape');
        return 'stock escape';
      },
    ],
  ]);
  const sequence = arrowAround(patched, sequenceAt);
  const quit = new RegExp(
    String.raw`\[27u"\)\{if\([\w$]+\|\|[\w$]+\)return (?<un>[\w$]+)\(\),!0;if\(${hi}\(\)\)return!0;return [\w$]+\(\)`,
    'u',
  ).exec(sequence);
  stubs.set(group(quit, 'un', 'Esc sequence handler'), () => {
    close(false);
  });
  stubs.set(
    named('Hi'),
    evaluate<() => boolean>(
      rebase.replace.slice(rebase.replace.indexOf('=') + 1),
      new Map<string, Stand>([
        [named('g'), (run: () => boolean) => run],
        [named('U'), close],
        [
          named('mo'),
          {
            get current() {
              return bash.active;
            },
          },
        ],
        [
          named('ko'),
          () => {
            bash.active = false;
            return true;
          },
        ],
      ]),
    ),
  );
  const press = {
    key: evaluate<(key: { escape: boolean }) => KeyResult>(key[0], stubs),
    sequence: evaluate<(raw: string) => KeyResult>(sequence, stubs),
    callback: evaluate<() => KeyResult | undefined>(callback[0], stubs),
  };
  return {
    escapes,
    bash,
    press: (path) => {
      if (path === 'key') {
        return press.key({ escape: true });
      }
      if (path === 'sequence') {
        return press.sequence('[27u');
      }
      return press.callback() ?? null;
    },
  };
}

export function enterKey(patched: string, rebased: readonly Rebase[], hooks: Hooks): EnterKey {
  const rebase = rebasedNamed(rebased, 'session-mention-select');
  const named = renamed(rebase);
  const at = patched.indexOf(rebase.replace);
  if (at === -1) {
    throw new Error('the patched select callback is missing');
  }
  const select = arrowAround(patched, at);
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
      [group(writes, 'text', 'select callback'), (text: string) => written.push(text)],
      [
        group(writes, 'cursor', 'select callback'),
        () => {
          hooks.close(false);
        },
      ],
    ]),
  );
  const marker = /\.tab\|\|[\w$]+\.return&&!/u;
  let handlerAt = patched.indexOf('{suggestion:');
  while (handlerAt !== -1 && !marker.test(patched.slice(Math.max(0, handlerAt - 90), handlerAt))) {
    handlerAt = patched.indexOf('{suggestion:', handlerAt + 1);
  }
  if (handlerAt === -1) {
    throw new Error('the stock suggestion key handler is missing');
  }
  const handler = arrowAround(patched, handlerAt);
  const parts =
    /let\{showSuggestions:[\w$]+,suggestions:[\w$]+\}=(?<state>[\w$]+)\(\);.*?\.upArrow\)return (?<move>[\w$]+)\(.*?return (?<select>[\w$]+)\(\{suggestion:[\w$]+\[(?<index>[\w$]+)\.current\],input:(?<input>[\w$]+)\.current,cursorPosition:(?<cursor>[\w$]+)\.current\}\),!0;if\([\w$]+\.escape\)return (?<un>[\w$]+)\(\)/u.exec(
      handler,
    );
  const quiet = {
    get current(): number {
      return hooks.entry.keyIndex;
    },
  };
  const press = evaluate<(event: null, key: Record<string, boolean>) => boolean>(
    handler,
    new Map<string, Stand>([
      [
        group(parts, 'state', 'suggestion key handler'),
        () => ({ showSuggestions: hooks.isShown(), suggestions: hooks.rows() }),
      ],
      [
        group(parts, 'move', 'suggestion key handler'),
        (advance: (at: number) => number) => {
          hooks.entry.keyIndex = advance(hooks.entry.keyIndex);
          hooks.entry.selected = hooks.entry.keyIndex;
        },
      ],
      [group(parts, 'select', 'suggestion key handler'), selectRow],
      [group(parts, 'index', 'suggestion key handler'), quiet],
      [
        group(parts, 'input', 'suggestion key handler'),
        {
          get current(): string {
            return hooks.entry.text;
          },
        },
      ],
      [
        group(parts, 'cursor', 'suggestion key handler'),
        {
          get current(): number {
            return hooks.entry.cursor;
          },
        },
      ],
      [
        group(parts, 'un', 'suggestion key handler'),
        () => {
          hooks.close(false);
        },
      ],
    ]),
  );
  return {
    written,
    press: () => press(null, { return: true }),
    down: () => press(null, { downArrow: true }),
  };
}

export function serviceEffect(
  rebased: readonly Rebase[],
  sequence: Stand,
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
        [named('Po'), sequence],
        [named('ao'), { current: null }],
        [named('go'), { current: null }],
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
