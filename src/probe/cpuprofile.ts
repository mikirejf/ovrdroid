import { readdirSync } from 'node:fs';
import path from 'node:path';

export interface ProfileNode {
  id: number;
  callFrame: { functionName?: string; url?: string; lineNumber?: number };
  children?: number[];
}

export interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}

export interface SelfTime {
  micros: number;
  rawMicros: number;
  samples: number;
  inflation: number;
  stack: string[];
}

export interface SelfTimeReport {
  chargedMicros: number;
  rawMicros: number;
  sampleCount: number;
  periodMicros: number;
  entries: SelfTime[];
}

export interface ProfileFile {
  profile: CpuProfile;
  name: string;
  written: number;
}

const FRAMEWORK = /react-reconciler|scheduler|processTicks|tracing\/enums/u;
const MAX_DEPTH = 64;

function isProfile(value: unknown): value is CpuProfile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'nodes' in value &&
    Array.isArray(value.nodes) &&
    'samples' in value &&
    Array.isArray(value.samples) &&
    'timeDeltas' in value &&
    Array.isArray(value.timeDeltas) &&
    'startTime' in value &&
    typeof value.startTime === 'number' &&
    'endTime' in value &&
    typeof value.endTime === 'number'
  );
}

export async function readProfile(dir: string, pid: number): Promise<ProfileFile> {
  const written = readdirSync(dir).filter((entry) => entry.endsWith('.cpuprofile'));
  const name = written.find((entry) => entry.includes(`.${pid}.`));
  if (name === undefined) {
    throw new Error(
      `no .cpuprofile for pid ${pid} in ${dir}; found ${written.length === 0 ? 'nothing' : written.join(', ')}`,
    );
  }
  const parsed: unknown = await Bun.file(path.join(dir, name)).json();
  if (!isProfile(parsed)) {
    throw new TypeError(`${name}: nodes, samples, timeDeltas, startTime or endTime missing`);
  }
  return { profile: parsed, name, written: written.length };
}

function frameOf(node: ProfileNode): string {
  const { functionName, url, lineNumber } = node.callFrame;
  const name = functionName === undefined || functionName === '' ? '(anonymous)' : functionName;
  return `${name}@${url ?? ''}:${(lineNumber ?? -1) + 1}`;
}

interface Tree {
  byId: Map<number, ProfileNode>;
  parents: Map<number, number>;
}

function stackOf(start: number, tree: Tree): string[] {
  const stack: string[] = [];
  let current = tree.byId.get(start);

  for (let depth = 0; current !== undefined && depth < MAX_DEPTH; depth += 1) {
    const frame = frameOf(current);
    if (!FRAMEWORK.test(frame)) {
      stack.push(frame);
    }
    const parent = tree.parents.get(current.id);
    current = parent === undefined ? undefined : tree.byId.get(parent);
  }

  return stack;
}

interface Charge {
  rawMicros: number;
  samples: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export interface SampleWindow {
  fromMicros?: number;
  untilMicros?: number;
}

export function selfTimes(
  profile: CpuProfile,
  count: number,
  window: SampleWindow = {},
): SelfTimeReport {
  const tree: Tree = { byId: new Map(), parents: new Map() };

  for (const node of profile.nodes) {
    tree.byId.set(node.id, node);
    for (const child of node.children ?? []) {
      tree.parents.set(child, node.id);
    }
  }

  const charges = new Map<number, Charge>();
  const included: number[] = [];
  let elapsed = 0;

  for (const [index, id] of profile.samples.entries()) {
    const micros = profile.timeDeltas[index] ?? 0;
    elapsed += micros;
    if (window.untilMicros !== undefined && elapsed > window.untilMicros) {
      break;
    }
    if (window.fromMicros !== undefined && elapsed < window.fromMicros) {
      continue;
    }
    const charge = charges.get(id) ?? { rawMicros: 0, samples: 0 };
    charge.rawMicros += micros;
    charge.samples += 1;
    charges.set(id, charge);
    included.push(micros);
  }

  const periodMicros = median(included);
  const sampleCount = included.length;

  const entries = [...charges.entries()]
    .map(([id, charge]) => ({
      id,
      micros: charge.samples * periodMicros,
      rawMicros: charge.rawMicros,
      samples: charge.samples,
    }))
    .toSorted((a, b) => b.micros - a.micros)
    .slice(0, count)
    .map(({ id, micros, rawMicros, samples }) => ({
      micros,
      rawMicros,
      samples,
      inflation: micros === 0 ? 0 : rawMicros / micros,
      stack: stackOf(id, tree),
    }));

  return {
    chargedMicros: sampleCount * periodMicros,
    rawMicros: included.reduce((sum, value) => sum + value, 0),
    sampleCount,
    periodMicros,
    entries,
  };
}
