import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MODEL_LOOKUP,
  MODEL_OF_GLOBAL,
  PATCHED_ROSTER_READ,
  sessionRosterPatches,
} from '../session-roster-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { STOCK_ROW_BUILDER, STOCK_ROWS } from './session-roster-stock.ts';

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
  pullRequestArtifacts: never[];
  cwd: string | null;
}

export interface Described {
  sessionId: string;
  model?: string;
  reasoningEffort?: string;
  status?: string;
  archived?: boolean;
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
  (ssm: StateManager, root: string) => Entry[],
  (ssm: StateManager, root: string) => string,
  Described[],
  (name: string) => { readFileSync: typeof readFileSync },
  ModelBag,
];

interface Lookup {
  rosterOf: (ssm: StateManager, root: string) => Described[];
}

const lookup = payloadFunction<LookupNames, Lookup>(
  ['m', 'pCe', '_Ce', 'GP', 'require', 'globalThis'],
  `${MODEL_LOOKUP}${PATCHED_ROSTER_READ}return A}return{rosterOf:Wke}`,
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
    pullRequestArtifacts: [],
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
    (_ssm, root) => children.get(root) ?? [],
    (_ssm, root) => root,
    [],
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
  model?: string;
  reasoningEffort?: string;
  workingState: string;
  archived?: boolean;
}

type RowNames = [
  () => Set<string>,
  (left: string | undefined, right: string) => string,
  () => null,
  () => null,
  (agent: { status?: string }) => string,
  () => null,
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

const patchedRows = payloadFunction<RowNames, (input: RowInput) => Droid[]>(
  ['k9', 'Cb', 'OQ', 'Pe', 'ze', 'l_', 'bT'],
  `${STOCK_ROW_BUILDER};${patchedText(STOCK_ROWS, 'session-roster-row-carries-model')};return qQ`,
)(
  () => new Set(),
  (left, right) => left ?? right,
  () => null,
  () => null,
  (agent) => (agent.status === 'running' ? 'streaming' : 'idle'),
  () => null,
  {},
);

export function rowsOf(agents: Described[], leadId = 'lead'): Droid[] {
  return patchedRows({
    lead: { sessionId: leadId, machineId: 'local' },
    agents,
    agentMachineIds: new Map(),
    live: new Map(),
    remote: new Map(),
    previews: new Map(),
    activityAt: new Map(),
    machines: [],
  });
}
