import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MODEL_AND_DESCENDANTS,
  MODEL_OF_GLOBAL,
  sessionRosterPatches,
} from '../session-roster-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import {
  STOCK_EXPAND,
  STOCK_EXPAND_TOGGLE_FN,
  STOCK_ROW_BUILDER,
  STOCK_ROWS,
  STOCK_SET_TOGGLE,
  STOCK_TREE,
} from './session-roster-stock.ts';

export interface Store {
  getModelId: () => string | undefined;
  getReasoningEffort: () => string | undefined;
}

export function storeOf(model?: string, effort?: string): Store {
  return { getModelId: () => model, getReasoningEffort: () => effort };
}

export interface Entry {
  sessionId: string;
  title: string;
  status: 'running' | 'idle';
  createdAt: number;
  updatedAt: number | null;
  computerId: string | null;
  pullRequest: null;
  cwd: string | null;
}

export interface Described {
  sessionId: string;
  parentSessionId?: string | null;
  model?: string;
  reasoningEffort?: string;
  status?: string;
}

export interface StateManager {
  getSessionManager: (id: string) => { getStore: () => Store } | undefined;
}

interface SessionService {
  findSessionSettingsPath: (id: string, searchAll: boolean) => string | null;
}

interface ModelBag {
  [MODEL_OF_GLOBAL]?: (
    ssm: StateManager,
    id: string,
  ) => { model?: string; reasoningEffort?: string };
}

type LookupNames = [
  () => SessionService,
  (ssm: StateManager, parent: string) => Entry[],
  (name: string) => { readFileSync: typeof readFileSync },
  ModelBag,
];

interface Lookup {
  rosterOf: (ssm: StateManager, root: string) => Described[];
}

const lookup = payloadFunction<LookupNames, Lookup>(
  ['m', 'pCe', 'require', 'globalThis'],
  `${MODEL_AND_DESCENDANTS};return{rosterOf:$ODrosterOf}`,
);

export interface World {
  stores: Map<string, Store>;
  children: Map<string, Entry[]>;
  ssm: StateManager;
  bag: ModelBag;
  modelOf: (id: string) => { model?: string; reasoningEffort?: string };
  rosterOf: (root: string) => Described[];
  writeSettings: (id: string, content: string) => null;
  removeSettings: (id: string) => null;
  dispose: () => null;
}

export function entry(
  sessionId: string,
  createdAt = 0,
  status: 'running' | 'idle' = 'running',
): Entry {
  return {
    sessionId,
    title: sessionId,
    status,
    createdAt,
    updatedAt: null,
    computerId: null,
    pullRequest: null,
    cwd: null,
  };
}

export function world(): World {
  const stores = new Map<string, Store>();
  const children = new Map<string, Entry[]>();
  const dir = mkdtempSync(path.join(tmpdir(), 'session-roster-'));
  const settingsFile = (id: string): string => path.join(dir, `${id}.settings.json`);
  const ssm: StateManager = {
    getSessionManager: (id) => {
      const store = stores.get(id);
      return store && { getStore: () => store };
    },
  };
  const bag: ModelBag = {};
  const { rosterOf } = lookup(
    () => ({ findSessionSettingsPath: settingsFile }),
    (_ssm, parent) => children.get(parent) ?? [],
    () => ({ readFileSync }),
    bag,
  );
  const modelOf = bag[MODEL_OF_GLOBAL];
  if (modelOf === undefined) {
    throw new TypeError('the payload did not define the shared model lookup');
  }
  return {
    stores,
    children,
    ssm,
    bag,
    modelOf: (id) => modelOf(ssm, id),
    rosterOf: (root) => rosterOf(ssm, root),
    writeSettings: (id, content) => {
      writeFileSync(settingsFile(id), content);
      return null;
    },
    removeSettings: (id) => {
      rmSync(settingsFile(id), { force: true });
      return null;
    },
    dispose: () => {
      rmSync(dir, { recursive: true, force: true });
      return null;
    },
  };
}

function patchedText(stock: string, name: string): string {
  const { find, replace } = patchNamed(sessionRosterPatches, name);
  if (!stock.includes(find)) {
    throw new Error(`the stock snippet no longer holds the find of ${name}`);
  }
  return stock.replace(find, () => replace);
}

export interface Droid {
  sessionId: string;
  parentSessionId: string | null;
  joinOrdinal: number;
  model?: string;
  reasoningEffort?: string;
  nestedRoster?: boolean;
  workingState: string;
}

export interface Node {
  droid: Droid;
  group: string;
  children: Node[];
}

type RowNames = [
  () => Set<string>,
  (left: string | undefined, right: string) => string,
  () => null,
  () => null,
  (agent: { status?: string }) => string,
  () => boolean,
  (row: Droid) => Droid,
  Record<string, never>,
];

interface Lead {
  sessionId: string;
  machineId: string;
}

interface RowInput {
  lead: Lead;
  agents: Described[];
  agentMachineIds: Map<string, string>;
  live: Map<string, null>;
  remote: Map<string, null>;
  previews: Map<string, null>;
  activityAt: Map<string, number>;
  machines: null[];
}

function rowsOf(tee: string): (input: RowInput) => Droid[] {
  return payloadFunction<RowNames, (input: RowInput) => Droid[]>(
    ['ay', 'PS', 'hK', 'qe', 'ft', 'pt', 'mn', 'Ml'],
    `${STOCK_ROW_BUILDER};${tee};return Tee`,
  )(
    () => new Set(),
    (left, right) => left ?? right,
    () => null,
    () => null,
    (agent) => (agent.status === 'running' ? 'streaming' : 'idle'),
    () => false,
    (row) => row,
    {},
  );
}

const patchedRows = rowsOf(patchedText(STOCK_ROWS, 'session-roster-row-carries-model-and-parent'));

type TreeNames = [(droid: Droid) => boolean, (left: Node, right: Node) => number];

const buildTree = payloadFunction<
  TreeNames,
  (droids: Droid[], unreachable: Set<string>, paused: Set<string>) => Node[]
>(['yf', 'U'], `${STOCK_TREE};return tA`)(
  (droid) => droid.workingState !== 'idle',
  (left, right) => left.droid.joinOrdinal - right.droid.joinOrdinal,
);

export interface Rendered {
  sessionId: string;
  parent: string | null;
  depth: number;
  expanded: boolean;
  model: string | undefined;
  reasoningEffort: string | undefined;
}

interface Row {
  kind: string;
  id: string;
  node: Node;
  depth: number;
  parent: Droid | null;
  expanded: boolean;
}

interface ListState {
  expandedDroids: Set<string>;
}

interface Expansion {
  d9: (...args: [Row[], Node, number, Droid | null, Set<string>]) => undefined;
  ufe: (state: ListState, id: string, expand: boolean) => ListState;
}

const expansion = payloadFunction<[(node: Node) => boolean], Expansion>(
  ['np'],
  `${STOCK_SET_TOGGLE}${patchedText(STOCK_EXPAND_TOGGLE_FN, 'session-roster-remembers-a-collapse')}` +
    `${patchedText(STOCK_EXPAND, 'session-roster-expands-nested-by-default')};return{d9,ufe}`,
)(() => false);

export function nodesOf(agents: Described[], leadId = 'lead'): Node[] {
  const droids = patchedRows({
    lead: { sessionId: leadId, machineId: 'local' },
    agents,
    agentMachineIds: new Map(),
    live: new Map(),
    remote: new Map(),
    previews: new Map(),
    activityAt: new Map(),
    machines: [],
  });
  return buildTree(droids, new Set(), new Set());
}

export interface Listing {
  state: ListState;
  rows: () => Rendered[];
  expand: (id: string) => null;
  collapse: (id: string) => null;
}

export function listing(nodes: Node[]): Listing {
  const listState = { state: { expandedDroids: new Set<string>() } };
  return {
    get state() {
      return listState.state;
    },
    rows: () => {
      const out: Row[] = [];
      for (const node of nodes) {
        expansion.d9(out, node, 0, null, listState.state.expandedDroids);
      }
      return out.map((row) => ({
        sessionId: row.id,
        parent: row.parent?.sessionId ?? null,
        depth: row.depth,
        expanded: row.expanded,
        model: row.node.droid.model,
        reasoningEffort: row.node.droid.reasoningEffort,
      }));
    },
    expand: (id) => {
      listState.state = expansion.ufe(listState.state, id, true);
      return null;
    },
    collapse: (id) => {
      listState.state = expansion.ufe(listState.state, id, false);
      return null;
    },
  };
}
