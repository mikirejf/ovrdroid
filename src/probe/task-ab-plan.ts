import path from 'node:path';

import type { ModelPrice } from './prices.ts';
import { TASK_NAMES } from './task-ab-fixtures.ts';
import type { TaskName } from './task-ab-fixtures.ts';
import type { RunRow } from './task-ab-rows.ts';

export interface Arm {
  label: string;
  binary: string;
}

export interface Job {
  rep: number;
  task: TaskName;
  model: string;
  arm: Arm;
}

export interface Context {
  prices: ReadonlyMap<string, ModelPrice | undefined>;
  seed: number;
  timeoutMs: number;
  append: (row: RunRow) => Promise<void>;
}

export function parseArms(specs: readonly string[]): Arm[] {
  const arms = specs.map((spec) => {
    const split = spec.indexOf('=');
    return split === -1
      ? { label: path.basename(spec), binary: spec }
      : { label: spec.slice(0, split), binary: spec.slice(split + 1) };
  });
  const seen = new Set<string>();
  for (const { label } of arms) {
    if (seen.has(label)) {
      throw new Error(`two binaries are both called "${label}": name them with label=path`);
    }
    seen.add(label);
  }
  return arms;
}

function isTaskName(name: string): name is TaskName {
  return TASK_NAMES.some((known) => known === name);
}

export function parseTasks(names?: readonly string[]): TaskName[] {
  if (names === undefined) {
    return [...TASK_NAMES];
  }
  return names.map((name) => {
    if (!isTaskName(name)) {
      throw new Error(`unknown task "${name}": the tasks are ${TASK_NAMES.join(', ')}`);
    }
    return name;
  });
}

export interface PlanInput {
  arms: readonly Arm[];
  models: readonly string[];
  tasks: readonly TaskName[];
  reps: number;
}

export function planSets({ arms, models, tasks, reps }: PlanInput): Job[][] {
  return Array.from({ length: reps }, (_, at) => at + 1).flatMap((rep) =>
    tasks.map((task, taskAt) =>
      models.flatMap((model, modelAt) =>
        ((rep + taskAt + modelAt) % 2 === 0 ? arms : arms.toReversed()).map((arm) => ({
          rep,
          task,
          model,
          arm,
        })),
      ),
    ),
  );
}
