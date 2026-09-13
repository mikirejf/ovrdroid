import { existsSync } from 'node:fs';

import type { RmCommand } from './rm-command.ts';
import { isForced, isRecursive } from './rm-command.ts';
import type { PathFacts, Zone } from './rm-facts.ts';

export type Decision = { kind: 'pass' } | { kind: 'allow'; reason: string; command: string };

const PASS: Decision = { kind: 'pass' };

const TRASH = '/usr/bin/trash';

const ACTIONS: Record<Zone, { binary: string; reason: string; keepFlags: boolean }> = {
  temp: { binary: 'rm', reason: 'deleting inside the temp directory', keepFlags: true },
  repo: { binary: TRASH, reason: 'moving repository files to the trash', keepFlags: false },
};

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export function decide(parsed: RmCommand, facts: readonly PathFacts[]): Decision {
  const [first] = facts;
  if (first === undefined) {
    return PASS;
  }

  const { zone } = first;
  if (zone === undefined) {
    return PASS;
  }
  if (facts.some((fact) => fact.zone !== zone)) {
    return PASS;
  }
  if (facts.some((fact) => fact.symlink)) {
    return PASS;
  }
  if (!isRecursive(parsed.flags) && facts.some((fact) => fact.directory)) {
    return PASS;
  }
  if (!isForced(parsed.flags) && facts.some((fact) => !fact.exists)) {
    return PASS;
  }

  const present = facts.filter((fact) => fact.exists);
  if (present.length === 0) {
    return PASS;
  }

  const action = ACTIONS[zone];
  if (action.binary === TRASH && !existsSync(TRASH)) {
    return PASS;
  }

  const flags = action.keepFlags ? parsed.flags : [];
  const quoted = present.map((fact) => shellQuote(fact.resolved));

  return {
    kind: 'allow',
    reason: action.reason,
    command: [action.binary, ...flags, ...quoted].join(' '),
  };
}
