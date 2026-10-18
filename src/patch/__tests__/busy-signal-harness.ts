import { busySignalPatches } from '../busy-signal-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

export interface Agent {
  sessionId: string;
  status: 'running' | 'idle';
}

export interface Environment {
  HERDR_ENV?: string;
  TERM_PROGRAM?: string;
}

type Listener = () => null;

interface Manager {
  getDroidWorkingState: () => string;
}

interface Bus {
  getSessionManager: (id: string) => Manager | undefined;
  subscribeToSessionEvents: (events: string[], listener: Listener) => null;
}

interface FakeProcess {
  stdout: { isTTY: boolean; write: (text: string) => null };
  env: Environment;
  on: (event: string, run: () => null) => null;
}

interface Timer {
  at: number;
  run: () => null;
  id: number;
  unref: () => null;
}

type Names = [
  FakeProcess,
  () => { getSessionStateManager: () => Bus },
  (bus: Bus, sessionId: string) => Agent[],
  (sessionId: string | null | undefined) => null,
  (run: () => null, ms: number) => Timer,
  (timer: Timer) => null,
  (run: () => null, ms: number) => Timer,
  (timer: Timer) => null,
];

const NAMES = [
  'process',
  'N',
  'qme',
  'zY',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

const { replace } = patchNamed(busySignalPatches, 'progress-busy-while-session-or-subagents-work');

const mount = payloadFunction<Names, (props: { sessionId: string | null | undefined }) => null>(
  NAMES,
  `${replace};return KIe`,
);

const ESCAPE = String.fromCodePoint(0x1b);
const BELL = String.fromCodePoint(0x07);

function payloadOf(text: string): string {
  return text.replace(`${ESCAPE}]9;`, '').replace(BELL, '');
}

export interface Pane {
  show: (sessionId: string | null | undefined) => null;
  setWorking: (sessionId: string, state: string) => null;
  setAgents: (sessionId: string, agents: Agent[]) => null;
  emit: () => null;
  advance: (ms: number) => null;
  exit: () => null;
  payloads: () => string[];
  last: () => string | undefined;
  subscribedTo: () => string[];
  subscriptions: () => number;
  timers: () => number;
  statusBarRenders: () => string[];
}

export function pane(env: Environment = {}, isTTY = true): Pane {
  const writes: string[] = [];
  const exitHooks: (() => null)[] = [];
  const listeners: Listener[] = [];
  const subscribed: string[] = [];
  const rendered: string[] = [];
  const working = new Map<string, string>();
  const agents = new Map<string, Agent[]>();
  const timers = new Map<number, Timer & { every: number }>();
  let now = 0;
  let nextId = 1;
  const schedule = (run: () => null, ms: number, every: number): Timer => {
    const id = nextId;
    nextId += 1;
    const timer = { at: now + ms, every, run, id, unref: () => null };
    timers.set(id, timer);
    return timer;
  };
  const cancel = (timer: Timer): null => {
    timers.delete(timer.id);
    return null;
  };
  const bus: Bus = {
    getSessionManager: (id) => {
      const state = working.get(id);
      return state === undefined ? undefined : { getDroidWorkingState: () => state };
    },
    subscribeToSessionEvents: (events, listener) => {
      subscribed.push(...events);
      listeners.push(listener);
      return null;
    },
  };
  const fakeProcess: FakeProcess = {
    stdout: {
      isTTY,
      write: (text) => {
        writes.push(text);
        return null;
      },
    },
    env,
    on: (event, run) => {
      if (event === 'exit') {
        exitHooks.push(run);
      }
      return null;
    },
  };
  const show = mount(
    fakeProcess,
    () => ({ getSessionStateManager: () => bus }),
    (_bus, id) => agents.get(id) ?? [],
    (sessionId) => {
      rendered.push(String(sessionId));
      return null;
    },
    (run, ms) => schedule(run, ms, ms),
    cancel,
    (run, ms) => schedule(run, ms, 0),
    cancel,
  );
  return {
    show: (sessionId) => show({ sessionId }),
    setWorking: (sessionId, state) => {
      working.set(sessionId, state);
      return null;
    },
    setAgents: (sessionId, list) => {
      agents.set(sessionId, list);
      return null;
    },
    emit: () => {
      for (const listener of listeners) {
        listener();
      }
      return null;
    },
    advance: (ms) => {
      const until = now + ms;
      for (;;) {
        const [due] = [...timers.values()]
          .filter((timer) => timer.at <= until)
          .toSorted((left, right) => left.at - right.at);
        if (due === undefined) {
          break;
        }
        now = due.at;
        if (due.every === 0) {
          timers.delete(due.id);
        } else {
          due.at += due.every;
        }
        due.run();
      }
      now = until;
      return null;
    },
    exit: () => {
      for (const hook of exitHooks) {
        hook();
      }
      return null;
    },
    payloads: () => writes.map((text) => payloadOf(text)),
    last: () => {
      const [latest] = writes.slice(-1);
      return latest === undefined ? latest : payloadOf(latest);
    },
    subscribedTo: () => subscribed,
    subscriptions: () => listeners.length,
    timers: () => timers.size,
    statusBarRenders: () => rendered,
  };
}
