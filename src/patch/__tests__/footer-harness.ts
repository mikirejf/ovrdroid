import { setSystemTime } from 'bun:test';

import { CACHE_CLOCK_KEY } from '../cache-clock.ts';
import type { Patch } from '../patches.ts';
import { patches } from '../patches.ts';
import type { ClockRuntime } from './clock-env.ts';
import { ClockEnv } from './clock-env.ts';
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

type Dependency = number | string;

interface Effect {
  run: () => (() => void) | undefined;
  deps: Dependency[];
}

interface Committed {
  deps: Dependency[];
  cleanup: (() => void) | undefined;
}

type Render = (
  ...args: [sessionId: string, status: string, theme: typeof THEME, bracket: string | null]
) => Part[];

type Bindings = [
  (initial: number) => [number, (update: (value: number) => number) => void],
  (run: Effect['run'], deps: Dependency[]) => void,
  () => object,
  (text: string, style: { color: string }) => Part,
  (target: Part[], parts: Part[], separator?: string) => void,
  (callback: () => void, delay: number) => Timer,
  (timer: Timer) => void,
  () => { refresh: () => void },
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

const BINDINGS = ['_', 'W', 'L', 'lt', 'up', 'setTimeout', 'clearTimeout', 'df'];

const LEFT_GROUPS = 'let fe=[[lt("? for help",{color:a.text.muted})]]';

const LEFT_REST = 'return fe.slice(0,We).forEach((Ht)=>{up(it,Ht," ")}),it};return Me(fe.length)';

const COMPONENT = `${STATE}$end=0;return function Footer(w,x,a,ye){${TRACK_AND_TICK}${LEFT_GROUPS}${PARTS}${LEFT_REST}}`;

export class FooterWorld {
  readonly timers: Timer[] = [];
  bracket: string | null = null;
  prRefreshes = 0;
  private status = 'idle';
  private counters: number[] = [];
  private committed: Committed[] = [];
  private effects: Effect[] = [];
  private slot = 0;
  private parts: Part[] = [];
  private readonly footer: Render;

  readonly clock = new ClockEnv();
  readonly runtime: ClockRuntime;

  constructor() {
    this.runtime = this.clock.runtime();
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
      () => ({
        refresh: () => {
          this.prRefreshes += 1;
        },
      }),
    );
  }

  static at(time: number): void {
    setSystemTime(new Date(time));
  }

  static reset(): void {
    setSystemTime();
    ClockEnv.close();
  }

  static cache(entries: Record<string, number>): void {
    Object.assign(globalThis, {
      [CACHE_CLOCK_KEY]: new Map(Object.entries(entries).map(([id, at]) => [id, { at }])),
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
