import { InvalidArgumentError } from 'commander';

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function quitOnBrokenPipe(): void {
  process.stdout.on('error', (error: unknown) => {
    if (hasErrorCode(error, 'EPIPE')) {
      process.exit(0);
    }
    fail(messageOf(error));
  });
}

export function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function kilobytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
}

export interface RunOptions {
  runs: number;
}

export function count(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new InvalidArgumentError('expected a whole number of at least 1');
  }
  return Math.floor(parsed);
}

export function choice<T extends string>(allowed: readonly T[]) {
  return (raw: string): T => {
    const found = allowed.find((value) => value === raw);
    if (found === undefined) {
      throw new InvalidArgumentError(`expected one of: ${allowed.join(', ')}`);
    }
    return found;
  };
}

export function guard<T extends unknown[]>(action: (...args: T) => void | Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await action(...args);
    } catch (error) {
      fail(messageOf(error));
    }
  };
}
