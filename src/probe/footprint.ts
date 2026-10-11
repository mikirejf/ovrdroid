import { dlopen, FFIType, ptr } from 'bun:ffi';

import { KIB } from '../cli.ts';

const RUSAGE_INFO_V4 = 4;
const RUSAGE_BUFFER_BYTES = 512;
const PHYS_FOOTPRINT_OFFSET = 72;

const libSystem =
  process.platform === 'darwin'
    ? dlopen('/usr/lib/libSystem.B.dylib', {
        proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
      })
    : undefined;

export function footprintOf(pid: number): number | undefined {
  if (libSystem === undefined) {
    return undefined;
  }
  const buffer = new BigUint64Array(RUSAGE_BUFFER_BYTES / BigUint64Array.BYTES_PER_ELEMENT);
  const failed = libSystem.symbols.proc_pid_rusage(pid, RUSAGE_INFO_V4, ptr(buffer)) !== 0;
  const bytes = buffer[PHYS_FOOTPRINT_OFFSET / BigUint64Array.BYTES_PER_ELEMENT];
  return failed || bytes === undefined ? undefined : Number(bytes) / KIB;
}

export function footprintsOf(pids: Iterable<number>): Map<number, number> {
  const found = new Map<number, number>();
  for (const pid of pids) {
    const kib = footprintOf(pid);
    if (kib !== undefined) {
      found.set(pid, kib);
    }
  }
  return found;
}
