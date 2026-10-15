import fs from 'node:fs';
import path from 'node:path';

import { PATCHED_RUNNING_TASKS } from '../nested-subagent-ui-patches.ts';
import { payloadFunction } from './payload.ts';

export interface PanelTask {
  taskId: string;
  parentSessionId: string;
  status: string;
}

export interface PanelRow {
  taskId: string;
  sessionId?: string;
  parentSessionId?: string;
  toolCallId?: string;
  status?: string;
  subagentType?: string;
  description?: string;
  startTime?: number;
  nestDepth: number;
  model?: string;
  reasoningEffort?: string;
}

export interface PanelLedgerEntry {
  childSessionId: string;
  parentSessionId: string;
  taskInvocationId: string;
  parentToolUseId?: string;
  subagentType?: string;
  description?: string;
  createdAt?: number;
}

export interface PanelSummary {
  status: string;
  subagentType: string;
  description: string;
}

export interface PanelWorld {
  decomp?: readonly string[];
  ledger?: readonly PanelLedgerEntry[];
  invocations?: Readonly<Record<string, string>>;
  summaries?: Readonly<Record<string, PanelSummary>>;
  sessionsDir?: string;
}

interface Manager {
  getAllSessionIds: () => string[];
  getSessionManager: (id: string) => {
    getStore: () => { getDecompSessionType: () => string | null };
  };
  getSubagentInvocationSummary: (id: string) => PanelSummary | undefined;
}

interface SessionService {
  findSessionSettingsPath: (id: string, searchAllProjects: boolean) => string | null;
}

type RunningTasks = (manager: Manager, root: string) => PanelRow[];

export function panelLister(
  tasks: readonly PanelTask[],
  world: PanelWorld = {},
): (root: string) => PanelRow[] {
  const ledger = world.ledger ?? [];
  const { sessionsDir } = world;
  const service: SessionService = {
    findSessionSettingsPath: (id, searchAllProjects) =>
      sessionsDir !== undefined && searchAllProjects
        ? path.join(sessionsDir, `${id}.settings.json`)
        : null,
  };
  const decomp = new Set(world.decomp);
  const manager: Manager = {
    getAllSessionIds: () => tasks.map((entry) => entry.taskId),
    getSessionManager: (id) => ({
      getStore: () => ({ getDecompSessionType: () => (decomp.has(id) ? 'decomp' : null) }),
    }),
    getSubagentInvocationSummary: (id) => world.summaries?.[id],
  };
  const list = payloadFunction<
    [
      (manager: unknown, parent?: string) => readonly PanelTask[],
      (parent: string) => readonly PanelLedgerEntry[],
      (child: string) => { taskInvocationId: string } | undefined,
      (status: string) => boolean,
      () => SessionService,
      (name: 'fs') => typeof fs,
    ],
    RunningTasks
  >(['v6', 'Ol', 'hn', 'Ri', 'p', 'require'], `${PATCHED_RUNNING_TASKS};return oRe`)(
    (_manager, parent) =>
      parent === undefined ? tasks : tasks.filter((entry) => entry.parentSessionId === parent),
    (parent) => ledger.filter((entry) => entry.parentSessionId === parent),
    (child) => {
      const taskInvocationId = world.invocations?.[child];
      return taskInvocationId === undefined ? undefined : { taskInvocationId };
    },
    (status) => status === 'running' || status === 'pending',
    () => service,
    () => fs,
  );
  return (root) => list(manager, root);
}

export function panelRowsUnder(
  tasks: readonly PanelTask[],
  root: string,
  world?: PanelWorld,
): PanelRow[] {
  return panelLister(tasks, world)(root);
}

export function panelUnder(
  tasks: readonly PanelTask[],
  root: string,
  world?: PanelWorld,
): string[] {
  return panelRowsUnder(tasks, root, world).map(
    (row) => `${'  '.repeat(row.nestDepth)}${row.taskId}`,
  );
}
