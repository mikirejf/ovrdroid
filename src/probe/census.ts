import { KIB, MS_PER_SECOND } from '../cli.ts';
import { parseCpuTime } from './idle.ts';

export const ORPHAN_COMMAND = /node|bun|npm|pnpm|vite|tsc|esbuild|python|mcp/u;
const CONVEX_EXECUTOR = /\.tmp[^/\s]*\/local\.cjs.*--ipc-path/u;
const DROID_NAME = 'droid';
const COMMAND_WIDTH = 110;
const NAME_WIDTH = 36;

export interface ProcessRow {
  pid: number;
  ppid: number;
  cpuMs: number;
  age: string;
  name: string;
}

export interface Family {
  name: string;
  count: number;
  kibs: number[];
  totalKib: number;
  cores: number;
}

export interface Orphan {
  pid: number;
  kib: number;
  age: string;
  command: string;
  convex: boolean;
}

export interface FamilyInput {
  before: readonly ProcessRow[];
  after: readonly ProcessRow[];
  footprints: ReadonlyMap<number, number>;
  windowS: number;
}

export interface OrphanInput {
  rows: readonly ProcessRow[];
  commands: ReadonlyMap<number, string>;
  footprints: ReadonlyMap<number, number>;
}

export function parseProcesses(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const [pid = '', ppid = '', utime = '', stime = '', age = '', ...comm] = line
      .trim()
      .split(/\s+/u);
    if (comm.length === 0 || !Number.isInteger(Number(pid))) {
      continue;
    }
    const path = comm.join(' ');
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      cpuMs: (parseCpuTime(utime) ?? 0) + (parseCpuTime(stime) ?? 0),
      age,
      name: path.split('/').pop() ?? path,
    });
  }
  return rows;
}

export function parseCommands(text: string): Map<number, string> {
  const commands = new Map<number, string>();
  for (const line of text.split('\n')) {
    const [pid = '', ...words] = line.trim().split(/\s+/u);
    if (words.length > 0 && Number.isInteger(Number(pid))) {
      commands.set(Number(pid), words.join(' '));
    }
  }
  return commands;
}

export function buildFamilies(input: FamilyInput): Family[] {
  const earlier = new Map(input.before.map((row) => [row.pid, row]));
  const families = new Map<string, Family>();
  for (const row of input.after) {
    const family = families.get(row.name) ?? {
      name: row.name,
      count: 0,
      kibs: [],
      totalKib: 0,
      cores: 0,
    };
    const kib = input.footprints.get(row.pid) ?? 0;
    const previous = earlier.get(row.pid);
    const spentMs = previous?.name === row.name ? row.cpuMs - previous.cpuMs : 0;
    family.count += 1;
    family.kibs.push(kib);
    family.totalKib += kib;
    family.cores += spentMs / MS_PER_SECOND / input.windowS;
    families.set(row.name, family);
  }
  return [...families.values()];
}

export function medianOf(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export function findOrphans(input: OrphanInput): Orphan[] {
  const orphans: Orphan[] = [];
  for (const row of input.rows) {
    const command = input.commands.get(row.pid) ?? row.name;
    if (row.ppid !== 1 || !ORPHAN_COMMAND.test(command)) {
      continue;
    }
    orphans.push({
      pid: row.pid,
      kib: input.footprints.get(row.pid) ?? 0,
      age: row.age,
      command,
      convex: CONVEX_EXECUTOR.test(command),
    });
  }
  return orphans.toSorted((a, b) => b.kib - a.kib);
}

function megabytes(kib: number): string {
  return `${(kib / KIB).toFixed(0)} MB`;
}

function gigabytes(kib: number): string {
  return `${(kib / KIB / KIB).toFixed(1)} GB`;
}

function totalKib(families: readonly Family[]): number {
  return families.reduce((sum, family) => sum + family.totalKib, 0);
}

function totalCores(families: readonly Family[]): number {
  return families.reduce((sum, family) => sum + family.cores, 0);
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(0)}%`;
}

function familyLine(family: Family): string {
  const name = family.name.slice(0, NAME_WIDTH).padEnd(NAME_WIDTH);
  const count = `x${family.count}`.padStart(5);
  const memory = megabytes(family.totalKib).padStart(9);
  return `${name} ${count} ${memory}  ${family.cores.toFixed(2)} cores`;
}

export function formatMachine(families: readonly Family[], windowS: number): string {
  const processes = families.reduce((sum, family) => sum + family.count, 0);
  return `The machine runs ${processes} processes. Together they hold ${gigabytes(totalKib(families))} of memory and used ${totalCores(families).toFixed(2)} CPU cores over ${windowS} seconds.`;
}

export function formatFamilies(families: readonly Family[], top: number): string {
  const byMemory = families.toSorted((a, b) => b.totalKib - a.totalKib).slice(0, top);
  const byCpu = families.toSorted((a, b) => b.cores - a.cores).slice(0, top);
  return [
    `Top ${top} programs by memory (a program is every process with the same name):`,
    ...byMemory.map((family) => familyLine(family)),
    '',
    `Top ${top} programs by CPU:`,
    ...byCpu.map((family) => familyLine(family)),
  ].join('\n');
}

export function formatDroid(families: readonly Family[]): string {
  const droid = families.find((family) => family.name === DROID_NAME);
  if (droid === undefined) {
    return 'No droid process is running.';
  }
  const memoryShare = percent(droid.totalKib, totalKib(families));
  const cpuShare = percent(droid.cores, totalCores(families));
  return [
    `Droid runs ${droid.count} processes.`,
    `Together they hold ${megabytes(droid.totalKib)}. The middle process holds ${megabytes(medianOf(droid.kibs))}.`,
    `They used ${droid.cores.toFixed(2)} CPU cores.`,
    `That is ${memoryShare} of the machine memory and ${cpuShare} of the machine CPU.`,
  ].join('\n');
}

function orphanLine(orphan: Orphan, cwd: string | undefined): string {
  const place = cwd === undefined ? '' : `  in ${cwd}`;
  const command = orphan.command.slice(0, COMMAND_WIDTH);
  return `${String(orphan.pid).padStart(7)}  ${megabytes(orphan.kib).padStart(8)}  up ${orphan.age.padStart(11)}  ${command}${place}`;
}

export function formatOrphans(
  orphans: readonly Orphan[],
  cwds: ReadonlyMap<number, string>,
  top: number,
): string {
  const convex = orphans.filter((orphan) => orphan.convex);
  const others = orphans.filter((orphan) => !orphan.convex);
  const allKib = orphans.reduce((sum, orphan) => sum + orphan.kib, 0);
  const convexKib = convex.reduce((sum, orphan) => sum + orphan.kib, 0);
  const lines = [
    `${orphans.length} dev processes lost their parent. They hold ${megabytes(allKib)}.`,
    ...others.slice(0, top).map((orphan) => orphanLine(orphan, cwds.get(orphan.pid))),
  ];
  if (convex.length > 0) {
    lines.push(
      '',
      `${convex.length} of these are Convex local backend executors (local.cjs --ipc-path), listed as one group. They hold ${megabytes(convexKib)}.`,
    );
  }
  return lines.join('\n');
}

export function otherOrphansToShow(orphans: readonly Orphan[], top: number): Orphan[] {
  return orphans.filter((orphan) => !orphan.convex).slice(0, top);
}
