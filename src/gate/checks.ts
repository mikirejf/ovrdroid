import { PROBE_MODEL } from '../probe/launch.ts';
import type { Lane, Phase } from './schedule.ts';

export interface Check {
  name: string;
  command: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export interface GateInputs {
  target: string;
  stock: string;
  droidVersion: string;
  scratchHome: string;
  bodiesBuild: string;
}

const AB_RUNS = '24';

const GATE_MODEL = PROBE_MODEL;

const LIVE_LANES_AT_ONCE = 4;

export type GatePhase = Phase<Check>;

function probe(name: string, ...args: readonly string[]): Check {
  return { name, command: ['bun', 'run', 'probe', name, ...args] };
}

function alone(check: Check): Lane<Check> {
  return { items: [check] };
}

function serial(name: string, checks: readonly Check[]): GatePhase {
  return { name, lanesAtOnce: 1, lanes: checks.map((check) => alone(check)) };
}

export function gateChecks(inputs: GateInputs): GatePhase[] {
  const { target, stock, droidVersion, scratchHome, bodiesBuild } = inputs;

  const bodies: Lane<Check> = {
    items: [
      {
        name: 'bodies-build',
        command: [
          'bun',
          'run',
          'probe',
          'build',
          '--target',
          stock,
          '--bodies',
          '--out',
          bodiesBuild,
        ],
      },
      probe('tool-surface', bodiesBuild),
      probe('effort-switch', bodiesBuild, '--model', GATE_MODEL, '--yes'),
    ],
  };

  const live: Lane<Check>[] = [
    alone(probe('digest-run', target)),
    alone(probe('warm', target, '--yes')),
    alone(probe('cachekey', target)),
    bodies,
    alone(probe('effort-clear', target)),
    alone(probe('rewind', target)),
    alone(probe('notice', target)),
    alone(probe('mcp-children', target)),
    alone(probe('compaction-fallback', target)),
  ];

  return [
    serial('static', [
      { name: 'verify', command: ['bun', 'run', 'verify'] },
      { name: 'builds', command: ['bun', 'run', 'probe', 'builds', '--version', droidVersion] },
      { name: 'test', command: ['bun', 'test'], env: { HOME: scratchHome } },
    ]),
    { name: 'live', lanesAtOnce: LIVE_LANES_AT_ONCE, lanes: live },
    serial('timing', [
      probe('effort', target),
      probe('ab', '-r', AB_RUNS, stock, target),
      probe('typing-start', '-r', '10', stock, target),
      probe('keys', '-r', '12', stock, target),
      probe('resume', stock, target),
      probe('stream', '-r', '10', stock, target),
    ]),
  ];
}
