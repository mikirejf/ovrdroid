import { InvalidArgumentError } from 'commander';

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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

export function guard<T extends unknown[]>(action: (...args: T) => void | Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await action(...args);
    } catch (error) {
      fail(messageOf(error));
    }
  };
}
