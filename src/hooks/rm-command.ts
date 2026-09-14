import path from 'node:path';

export interface RmCommand {
  paths: readonly string[];
  flags: readonly string[];
}

const UNSAFE = /[$`*?[\]<>&|;(){}!~\\'"#\n\r\t]/u;
const SHORT_CLUSTER = /^-[rRfdv]+$/u;
const LONG_FLAGS = new Set(['--recursive', '--force', '--verbose', '--dir']);

function climbs(token: string): boolean {
  return token.split(path.sep).includes('..');
}

function shortLetters(flags: readonly string[]): string {
  return flags.filter((flag) => !flag.startsWith('--')).join('');
}

export function isRecursive(flags: readonly string[]): boolean {
  return flags.includes('--recursive') || /r/iu.test(shortLetters(flags));
}

export function isForced(flags: readonly string[]): boolean {
  return flags.includes('--force') || shortLetters(flags).includes('f');
}

export function parseRm(command: string): RmCommand | undefined {
  if (UNSAFE.test(command)) {
    return undefined;
  }

  const tokens = command.trim().split(/ +/u);
  if (tokens[0] !== 'rm') {
    return undefined;
  }

  const rest = tokens.slice(1);
  const flags = rest.filter((token) => token.startsWith('-'));
  const paths = rest.filter((token) => !token.startsWith('-'));
  if (paths.length === 0 || paths.some((token) => climbs(token))) {
    return undefined;
  }

  if (!flags.every((flag) => LONG_FLAGS.has(flag) || SHORT_CLUSTER.test(flag))) {
    return undefined;
  }

  return { paths, flags };
}
