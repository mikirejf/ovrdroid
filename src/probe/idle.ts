import { megabytes, MS_PER_SECOND } from '../cli.ts';

export interface Sample {
  pid: number;
  atMs: number;
  cpuMs: number;
  rssKib: number;
}

export interface ProcessCost {
  pid: number;
  command: string;
  cpuMsPerMinute: number;
  rssKib: number;
  footprintKib: number;
  rssGrowthKibPerMinute: number;
}

export interface IdleReading {
  windowMs: number;
  processes: readonly ProcessCost[];
  cpuMsPerMinute: number;
  rssKib: number;
  footprintKib: number;
  rssGrowthKibPerMinute: number;
}

export function parseCpuTime(field: string): number | undefined {
  const pattern =
    /^(?:(?<days>\d+)-)?(?:(?<hours>\d+):)?(?<minutes>\d+):(?<seconds>\d+)(?:\.(?<fraction>\d+))?$/u;
  const groups = pattern.exec(field.trim())?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { days = '0', hours = '0', minutes = '0', seconds = '0', fraction = '0' } = groups;
  const whole = ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
  return whole * MS_PER_SECOND + Number(`0.${fraction}`) * MS_PER_SECOND;
}

export function parsePs(text: string, atMs: number): Sample[] {
  const samples: Sample[] = [];

  for (const line of text.split('\n')) {
    const [pid = '', utime = '', stime = '', rss = ''] = line.trim().split(/\s+/u);
    const cpuUser = parseCpuTime(utime);
    const cpuSystem = parseCpuTime(stime);
    const rssKib = Number(rss);
    if (cpuUser === undefined || cpuSystem === undefined || !Number.isInteger(Number(pid))) {
      continue;
    }
    samples.push({ pid: Number(pid), atMs, cpuMs: cpuUser + cpuSystem, rssKib });
  }

  return samples;
}

export function perMinute(delta: number, windowMs: number): number {
  return windowMs === 0 ? 0 : (delta / windowMs) * 60 * MS_PER_SECOND;
}

interface Named {
  pid: number;
  command: string;
  footprintKib: number;
}

function costOf(named: Named, first: Sample, last: Sample): ProcessCost {
  const windowMs = last.atMs - first.atMs;
  return {
    ...named,
    cpuMsPerMinute: perMinute(last.cpuMs - first.cpuMs, windowMs),
    rssKib: last.rssKib,
    rssGrowthKibPerMinute: perMinute(last.rssKib - first.rssKib, windowMs),
  };
}

export interface IdleInputs {
  names?: ReadonlyMap<number, string>;
  footprints?: ReadonlyMap<number, number>;
}

export function readIdle(samples: readonly Sample[], inputs: IdleInputs = {}): IdleReading {
  const byPid = new Map<number, Sample[]>();
  for (const sample of samples) {
    const taken = byPid.get(sample.pid);
    if (taken === undefined) {
      byPid.set(sample.pid, [sample]);
    } else {
      taken.push(sample);
    }
  }

  const processes: ProcessCost[] = [];
  let windowMs = 0;

  for (const [pid, taken] of byPid) {
    const ordered = taken.toSorted((a, b) => a.atMs - b.atMs);
    const first = ordered.at(0);
    const last = ordered.at(-1);
    if (first === undefined || last === undefined || ordered.length < 2) {
      continue;
    }
    windowMs = Math.max(windowMs, last.atMs - first.atMs);
    processes.push(
      costOf(
        {
          pid,
          command: inputs.names?.get(pid) ?? 'unknown',
          footprintKib: inputs.footprints?.get(pid) ?? 0,
        },
        first,
        last,
      ),
    );
  }

  const sum = (pick: (cost: ProcessCost) => number): number =>
    processes.reduce((total, cost) => total + pick(cost), 0);

  return {
    windowMs,
    processes: processes.toSorted((a, b) => b.cpuMsPerMinute - a.cpuMsPerMinute),
    cpuMsPerMinute: sum((cost) => cost.cpuMsPerMinute),
    rssKib: sum((cost) => cost.rssKib),
    footprintKib: sum((cost) => cost.footprintKib),
    rssGrowthKibPerMinute: sum((cost) => cost.rssGrowthKibPerMinute),
  };
}

export function formatIdle(reading: IdleReading, bytes: number): string {
  const seconds = reading.windowMs / MS_PER_SECOND;
  const lines = [
    `over ${seconds.toFixed(1)}s idle, ${reading.processes.length} processes`,
    `  cpu       ${reading.cpuMsPerMinute.toFixed(0)}ms per minute of standing by`,
    `  footprint ${megabytes(reading.footprintKib)} of real memory, which is what caps parallel sessions`,
    `  rss       ${megabytes(reading.rssKib)} resident, inflated by the shared binary each process maps`,
    `  growth    ${megabytes(reading.rssGrowthKibPerMinute)} per minute`,
    `  paint     ${bytes} bytes written to the terminal`,
    '',
    'per process:',
  ];

  for (const cost of reading.processes) {
    lines.push(
      [
        ` ${String(cost.pid).padStart(7)}`,
        `${cost.cpuMsPerMinute.toFixed(0).padStart(6)}ms/min`,
        megabytes(cost.footprintKib).padStart(9),
        `${cost.rssGrowthKibPerMinute >= 0 ? '+' : ''}${megabytes(cost.rssGrowthKibPerMinute)}/min`.padStart(
          12,
        ),
        cost.command,
      ].join('  '),
    );
  }

  return lines.join('\n');
}
