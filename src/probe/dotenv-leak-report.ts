export interface Plant {
  file: string;
  key: string;
  value: string;
}

export type DotenvOutcome = 'leaks' | 'clean' | 'unproven';

export interface DotenvReading {
  outcome: DotenvOutcome;
  leaked: readonly Plant[];
  plants: readonly Plant[];
}

const ASSIGNMENT = /^(?<key>[A-Za-z_]\w*)=(?<value>.*)$/u;

export function plantsFor(token: string): [Plant, Plant] {
  return [
    { file: '.env', key: 'OVRDROID_PROBE_DOTENV', value: `env-${token}` },
    { file: '.env.local', key: 'OVRDROID_PROBE_DOTENV_LOCAL', value: `local-${token}` },
  ];
}

export function dotenvText(plant: Plant): string {
  return `${plant.key}=${plant.value}\n`;
}

export function parseEnvDump(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split('\n')) {
    const groups = ASSIGNMENT.exec(line)?.groups;
    if (groups?.['key'] !== undefined) {
      entries.set(groups['key'], groups['value'] ?? '');
    }
  }
  return entries;
}

export function readDotenvLeak(dump: string | undefined, plants: readonly Plant[]): DotenvReading {
  const entries = parseEnvDump(dump ?? '');
  if (entries.size === 0) {
    return { outcome: 'unproven', leaked: [], plants };
  }
  const leaked = plants.filter((plant) => entries.get(plant.key) === plant.value);
  return { outcome: leaked.length > 0 ? 'leaks' : 'clean', leaked, plants };
}

function joined(words: readonly string[]): string {
  return words.join(' and ');
}

export function describeDotenvLeak({ outcome, leaked, plants }: DotenvReading): string {
  if (outcome === 'unproven') {
    return 'unproven: Droid never started the MCP server, so there is no environment to read';
  }
  if (outcome === 'leaks') {
    return `leaks: the MCP server it started saw ${joined(leaked.map((plant) => `${plant.key} from ${plant.file}`))}`;
  }
  return `no leak: the MCP server it started saw none of ${joined(plants.map((plant) => `${plant.key} from ${plant.file}`))}`;
}
