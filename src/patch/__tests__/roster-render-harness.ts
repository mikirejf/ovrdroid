import { rosterRenderPatches } from '../roster-render-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

type Listener = () => void;

type Subscribe = (listener: Listener) => () => void;

interface Row {
  preview: string;
  lastActivityAt: number;
}

export interface Model {
  identity: { missionId: string } | null;
  loaded: boolean;
  counts: { working: number; needsYou: number };
  roster: { lead: { droid: { sessionId: string } }; rows: Row[] };
}

export interface Facts {
  identity: Model['identity'];
  loaded: boolean;
  working: number;
  needsYou: number;
  lead: string;
}

export interface Roster {
  listeners: Set<Listener>;
  subscribe: Subscribe;
  getSnapshot: () => Model | null;
  publish: (model: Model | null) => void;
  $ODfactsOf?: () => Facts | null;
}

export type RosterClass = new (sessionId: string | null) => Roster;

export interface ModelFields {
  lead?: string;
  working?: number;
  needsYou?: number;
  preview?: string;
  at?: number;
}

export function rosterModel(fields: ModelFields = {}): Model {
  const { lead = 'lead', working = 1, needsYou = 0, preview = 'hello', at = 1 } = fields;
  return {
    identity: null,
    loaded: true,
    counts: { working, needsYou },
    roster: { lead: { droid: { sessionId: lead } }, rows: [{ preview, lastActivityAt: at }] },
  };
}

export function rosterClass(start: Map<string, Model>): RosterClass {
  return class {
    listeners = new Set<Listener>();
    model: Model | null;
    constructor(sessionId: string | null) {
      this.model = sessionId === null ? null : (start.get(sessionId) ?? null);
    }
    subscribe = (listener: Listener): (() => void) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };
    getSnapshot = (): Model | null => this.model;
    publish(model: Model | null): void {
      this.model = model;
      for (const listener of this.listeners) {
        listener();
      }
    }
  };
}

type Snapshot = Model | Facts | Element | null | undefined;

interface Slot {
  deps?: readonly (string | null)[];
  store?: Roster;
  subscribe?: Subscribe;
  read?: () => Snapshot;
  seen?: Snapshot;
  stop?: () => void;
}

interface Mounted {
  slots: Slot[];
  index: number;
  render: () => void;
}

let current: Mounted | undefined;

interface Claimed {
  slot: Slot;
  owner: Mounted;
}

function nextSlot(): Claimed {
  if (current === undefined) {
    throw new Error('a hook ran outside a render');
  }
  const owner = current;
  const slot = owner.slots[owner.index] ?? {};
  owner.slots[owner.index] = slot;
  owner.index += 1;
  return { slot, owner };
}

function useMemoStandIn(factory: () => Roster, deps: readonly (string | null)[]): Roster {
  const { slot } = nextSlot();
  if (slot.store === undefined || deps.some((dep, i) => dep !== slot.deps?.[i])) {
    slot.deps = deps;
    slot.store = factory();
  }
  return slot.store;
}

function useStoreStandIn<T extends Snapshot>(subscribe: Subscribe, read: () => T): T {
  const { slot, owner } = nextSlot();
  const value = read();
  slot.read = read;
  slot.seen = value;
  if (slot.subscribe !== subscribe) {
    slot.stop?.();
    slot.subscribe = subscribe;
    slot.stop = subscribe(() => {
      if (slot.read?.() !== slot.seen) {
        owner.render();
      }
    });
  }
  return value;
}

export interface View<Props, Out> {
  readonly renders: number;
  readonly output: Out;
  rerender: (props: Props) => void;
}

export function mount<Props, Out>(body: (props: Props) => Out, props: Props): View<Props, Out> {
  let renders = 0;
  let shown = props;
  const mounted: Mounted = { slots: [], index: 0, render: () => {} };
  const run = (next: Props): Out => {
    const previous = current;
    current = mounted;
    mounted.index = 0;
    renders += 1;
    try {
      return body(next);
    } finally {
      current = previous;
    }
  };
  let output = run(shown);
  mounted.render = () => {
    output = run(shown);
  };
  return {
    get renders() {
      return renders;
    },
    get output() {
      return output;
    },
    rerender: (next) => {
      shown = next;
      mounted.render();
    },
  };
}
export function statusLine(): null {
  return null;
}

export interface LineProps {
  $ODstore?: Roster | undefined;
  model: Model | null;
  width: number;
  openingTitle?: string;
}

export interface Element {
  type: typeof statusLine;
  props: Omit<LineProps, '$ODstore'>;
}

function jsx(type: typeof statusLine, props: Omit<LineProps, '$ODstore'>): Element {
  return { type, props };
}

export interface Helpers {
  $ODrosterStore: (sessionId: string | null) => Roster;
  $ODrosterLive: (store: Roster | undefined, fallback: Model | null) => Model | null;
  $ODRosterLine: (props: LineProps) => Element | null;
}

export function helpers(Store: RosterClass): Helpers {
  return payloadFunction<
    [typeof useMemoStandIn, RosterClass, typeof useStoreStandIn, typeof jsx, typeof statusLine],
    Helpers
  >(
    ['k', 'fQ', 'Na', 't', '_q'],
    `${patchNamed(rosterRenderPatches, 'roster-render-split').replace};return{$ODrosterStore,$ODrosterLive,$ODRosterLine}`,
  )(useMemoStandIn, Store, useStoreStandIn, jsx, statusLine);
}

export interface ControllerArgs {
  model: Model | null;
  currentSessionId: string;
}

export function controllerArgs(store: Roster | undefined, rendered: Model | null): ControllerArgs {
  const { replace } = patchNamed(rosterRenderPatches, 'roster-render-split-controller');
  return payloadFunction<
    [(args: ControllerArgs) => ControllerArgs, Roster | undefined, Model | null, string],
    ControllerArgs
  >(['SZ', '$ODrl', 'qoe', 'Fo'], `let lu;${replace}});return lu`)(
    (args) => args,
    store,
    rendered,
    's1',
  );
}
