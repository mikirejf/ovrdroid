import { setSystemTime } from 'bun:test';

import type { Patch } from '../patches.ts';
import { patches } from '../patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

export const SESSION = 'footer-session';
export const OTHER_SESSION = 'other-session';

const THEME = { primary: 'primary', warning: 'warning', text: { muted: 'muted' } };
const SEPARATOR = ' | ';

interface Part {
  text: string;
  color: string;
}

export interface Timer {
  delay: number;
  active: boolean;
  callback: () => void;
}

interface Effect {
  run: () => (() => void) | undefined;
  deps: number[];
}

interface Committed {
  deps: number[];
  cleanup: (() => void) | undefined;
}

type Render = (
  ...args: [sessionId: string, status: string, theme: typeof THEME, bracket: string | null]
) => Part[];

type Bindings = [
  (initial: number) => [number, (update: (value: number) => number) => void],
  (run: Effect['run'], deps: number[]) => void,
  () => object,
  (text: string, style: { color: string }) => Part,
  (target: Part[], parts: Part[], separator?: string) => void,
  (callback: () => void, delay: number) => Timer,
  (timer: Timer) => void,
];

function inserted(patch: Patch): string {
  const { find, replace } = patch;
  let suffix = 0;
  while (suffix < find.length && find.at(-1 - suffix) === replace.at(-1 - suffix)) {
    suffix += 1;
  }
  let prefix = 0;
  while (prefix < find.length - suffix && find[prefix] === replace[prefix]) {
    prefix += 1;
  }
  return replace.slice(prefix, replace.length - suffix);
}

const STATE = patchNamed(patches, 'turn-clock-state').replace;
const TRACK_AND_TICK = inserted(patchNamed(patches, 'turn-clock-track'));
const PARTS = patchNamed(patches, 'turn-clock-parts').replace;

const BINDINGS = ['A', 'v', 'L', 'rt', 'sd', 'setTimeout', 'clearTimeout'];

const HELP = 'sd(Ie,[rt("? for help",{color:o.text.muted})]," ");';

const COMPONENT = `${STATE}$end=0;return function Footer(F,B,o,fe){let Ie=[];${TRACK_AND_TICK}${PARTS}${HELP}return Ie}`;

export class FooterWorld {
  readonly timers: Timer[] = [];
  bracket: string | null = null;
  private status = 'idle';
  private counters: number[] = [];
  private committed: Committed[] = [];
  private effects: Effect[] = [];
  private slot = 0;
  private parts: Part[] = [];
  private readonly footer: Render;

  constructor() {
    const build = payloadFunction<Bindings, Render>(BINDINGS, COMPONENT);
    this.footer = build(
      (initial) => this.useState(initial),
      (run, deps) => {
        this.effects.push({ run, deps });
      },
      () => ({
        getSessionStateManager: () => ({
          getSessionManager: () => ({ getDroidWorkingStateChangedAtMs: () => Date.now() }),
        }),
      }),
      (text, style) => ({ text, color: style.color }),
      (target, parts, separator = SEPARATOR) => {
        if (parts.length === 0) {
          return;
        }
        if (target.length > 0) {
          target.push({ text: separator, color: 'muted' });
        }
        target.push(...parts);
      },
      (callback, delay) => {
        const timer = { delay, active: true, callback };
        this.timers.push(timer);
        return timer;
      },
      (timer) => {
        timer.active = false;
      },
    );
  }

  static at(time: number): void {
    setSystemTime(new Date(time));
  }

  static reset(): void {
    setSystemTime();
    Reflect.deleteProperty(globalThis, '__odCache');
  }

  static cache(entries: Record<string, number>): void {
    Object.assign(globalThis, {
      __odCache: new Map(Object.entries(entries).map(([id, at]) => [id, { at }])),
    });
  }

  get pending(): Timer[] {
    return this.timers.filter((timer) => timer.active);
  }

  get text(): string {
    return this.parts.map((part) => part.text).join('');
  }

  colorOf(text: string): string | undefined {
    return this.parts.find((part) => part.text.trim() === text)?.color;
  }

  render(status = this.status): string {
    this.status = status;
    this.slot = 0;
    this.effects = [];
    this.parts = this.footer(SESSION, status, THEME, this.bracket);
    for (const [index, effect] of this.effects.entries()) {
      const before = this.committed[index];
      if (before?.deps.every((dep, at) => dep === effect.deps[at]) === true) {
        continue;
      }
      before?.cleanup?.();
      this.committed[index] = { deps: effect.deps, cleanup: effect.run() };
    }
    return this.text;
  }

  fireOnlyTimer(): string {
    const [timer, ...rest] = this.pending;
    if (timer === undefined || rest.length > 0) {
      throw new Error(`expected exactly one pending timer, found ${this.pending.length}`);
    }
    timer.active = false;
    FooterWorld.at(Date.now() + timer.delay);
    timer.callback();
    return this.text;
  }

  private useState(initial: number): [number, (update: (value: number) => number) => void] {
    const { slot } = this;
    this.slot += 1;
    const value = this.counters[slot] ?? initial;
    this.counters[slot] = value;
    return [
      value,
      (update) => {
        this.counters[slot] = update(this.counters[slot] ?? initial);
        this.render();
      },
    ];
  }
}
