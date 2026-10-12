import { describe, expect, test } from 'bun:test';

import { CHAT_INPUT_CALLBACKS, rerenderPatches } from '../rerender-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

type CallbackKey = (typeof CHAT_INPUT_CALLBACKS)[number];
type Callback = (...args: string[]) => string | undefined;

interface InputProps extends Partial<Record<CallbackKey, Callback | undefined>> {
  width?: number;
  isFocused?: boolean;
  onOpenHelp?: Callback;
  draftAttachments?: { images: string[] };
}

interface Rendered {
  type: { memoOf: () => string };
  props: InputProps;
}

interface Held {
  current: unknown;
}

interface Hooks {
  index: number;
  held: Held[];
}

const HEAD = 'a8.displayName="InputLine";';
const TAIL = 'function Hc({';

function input(): string {
  return 'input';
}

function memoOf(render: () => string): Rendered['type'] {
  return { memoOf: render };
}

function openHelp(): string {
  return 'help';
}

function jsx(type: Rendered['type'], props: InputProps): Rendered {
  return { type, props };
}

function wrapperBody(): string {
  const { replace } = patchNamed(rerenderPatches, 'chat-input-stable');
  expect(replace.startsWith(HEAD)).toBe(true);
  expect(replace.endsWith(TAIL)).toBe(true);
  return replace.slice(HEAD.length, -TAIL.length);
}

function mounted() {
  const hooks: Hooks = { index: 0, held: [] };
  const useRef = (initial: null): Held => {
    hooks.held[hooks.index] ??= { current: initial };
    const slot = hooks.held[hooks.index];
    hooks.index += 1;
    return slot ?? { current: initial };
  };
  const wrapper = payloadFunction<
    [typeof memoOf, typeof useRef, typeof jsx, typeof input],
    (props: InputProps) => Rendered
  >(['SA', 'b', 't', 'Hc'], `${wrapperBody()};return $ODIn`)(memoOf, useRef, jsx, input);
  return (props: InputProps): Rendered => {
    hooks.index = 0;
    return wrapper(props);
  };
}

function callbacks(log: string[], tag: string): Required<Pick<InputProps, CallbackKey>> {
  const make =
    (key: CallbackKey): Callback =>
    (...args) => {
      log.push(`${tag}:${key}:${args.join(',')}`);
      return `${tag}-${key}`;
    };
  return {
    onSubmit: make('onSubmit'),
    onInputChange: make('onInputChange'),
    onCursorPositionChange: make('onCursorPositionChange'),
    onModelCycle: make('onModelCycle'),
    onWarning: make('onWarning'),
    onCopied: make('onCopied'),
    onDownArrowAtBottom: make('onDownArrowAtBottom'),
  };
}

function standIn(rendered: Rendered, key: CallbackKey): Callback {
  const found = rendered.props[key];
  if (found === undefined) {
    throw new TypeError(`${key} was not passed on`);
  }
  return found;
}

describe('chat-input-stable', () => {
  test('the wrapper renders the memoized input, not the input itself', () => {
    const render = mounted();
    expect(render({ width: 80 }).type).toEqual({ memoOf: input });
  });

  test('a callback that is fresh every render reaches the input as the same function', () => {
    const render = mounted();
    const log: string[] = [];
    const first = render({ ...callbacks(log, 'one'), width: 80 });
    const second = render({ ...callbacks(log, 'two'), width: 80 });
    for (const key of CHAT_INPUT_CALLBACKS) {
      expect(standIn(second, key)).toBe(standIn(first, key));
    }
  });

  test('the same memoized type comes back every render, so memo can compare props', () => {
    const render = mounted();
    expect(render({ width: 80 }).type).toBe(render({ width: 80 }).type);
  });

  test('calling a stand-in calls the latest callback with its arguments and returns its answer', () => {
    const render = mounted();
    const log: string[] = [];
    const first = render(callbacks(log, 'one'));
    render(callbacks(log, 'two'));
    expect(standIn(first, 'onSubmit')('hello', 'now')).toBe('two-onSubmit');
    expect(log).toEqual(['two:onSubmit:hello,now']);
  });

  test('every other prop passes through as it came', () => {
    const render = mounted();
    const onOpenHelp: Callback = openHelp;
    const draftAttachments = { images: [] };
    const rendered = render({ onOpenHelp, draftAttachments, width: 80, isFocused: true });
    expect(rendered.props).toEqual({ onOpenHelp, draftAttachments, width: 80, isFocused: true });
    expect(rendered.props.onOpenHelp).toBe(onOpenHelp);
    expect(rendered.props.draftAttachments).toBe(draftAttachments);
  });

  test('a callback the parent does not pass stays missing', () => {
    const render = mounted();
    const rendered = render({ width: 80, onSubmit: undefined });
    expect(rendered.props.onSubmit).toBeUndefined();
    expect(Object.keys(rendered.props)).not.toContain('onInputChange');
  });

  test('a callback that goes away and comes back keeps one stand-in', () => {
    const render = mounted();
    const log: string[] = [];
    const first = render(callbacks(log, 'one'));
    expect(render({}).props.onCopied).toBeUndefined();
    const back = render(callbacks(log, 'three'));
    expect(standIn(back, 'onCopied')).toBe(standIn(first, 'onCopied'));
    standIn(first, 'onCopied')('x');
    expect(log).toEqual(['three:onCopied:x']);
  });

  test('a stand-in held after the parent drops the callback does nothing', () => {
    const render = mounted();
    const first = render(callbacks([], 'one'));
    render({});
    expect(standIn(first, 'onModelCycle')()).toBeUndefined();
  });

  test('the props the parent passed are not changed', () => {
    const render = mounted();
    const props = { ...callbacks([], 'one'), width: 80 };
    const before = { ...props };
    render(props);
    expect(props).toEqual(before);
    for (const key of CHAT_INPUT_CALLBACKS) {
      expect(props[key]).toBe(before[key]);
    }
  });
});

describe('chat-input-stable-use', () => {
  test('only the main chat input call site changes, from the input to the wrapper', () => {
    const patch = patchNamed(rerenderPatches, 'chat-input-stable-use');
    expect(patch.replace).toBe(patch.find.replace('t(Hc,{', 't($ODIn,{'));
  });
});
