import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { messageOf } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import type { LedgerSession } from './ledger.ts';
import {
  LEDGER_VARIABLE,
  mayDelete,
  missingHookMessage,
  newestSqliteLibrary,
  readLedger,
  registration,
  sessionFiles,
  sessionFolderName,
} from './ledger.ts';

const FACTORY = path.join(homedir(), '.factory');
const FACTORY_BIN = path.join(FACTORY, 'bin');
const SESSION_INDEX = path.join(FACTORY, 'cache', 'session-index', 'index.db');
const BUSY_TIMEOUT_MS = 5000;
const EXIT_GRACE_MS = 10_000;
const INTERRUPTED_EXIT_CODE = 130;
export const START_HOOK_BOUND_MS = 5000;
const START_HOOK_POLL_MS = 50;

type Child = Bun.Subprocess;

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function exitsWithin(child: Child, ms: number): Promise<boolean> {
  const cancel = new AbortController();
  const deadline = async (): Promise<boolean> => {
    try {
      await delay(ms, undefined, { signal: cancel.signal });
    } catch {
      return false;
    }
    return false;
  };
  const exit = async (): Promise<boolean> => {
    await child.exited;
    return true;
  };
  try {
    return await Promise.race([exit(), deadline()]);
  } finally {
    cancel.abort();
  }
}

async function stopChild(child: Child, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill(signal);
  if (!(await exitsWithin(child, EXIT_GRACE_MS))) {
    child.kill('SIGKILL');
    await child.exited;
  }
}

function exitOf(child: Child): string | undefined {
  if (child.exitCode !== null) {
    return `code ${child.exitCode}`;
  }
  return child.signalCode === null ? undefined : `signal ${child.signalCode}`;
}

function bornMs(file: string): number | undefined {
  try {
    return statSync(file).birthtimeMs;
  } catch {
    return undefined;
  }
}

function findDroidSqlite(): string | undefined {
  const entries = existsSync(FACTORY_BIN)
    ? readdirSync(FACTORY_BIN).map((name) => ({
        name,
        mtimeMs: statSync(path.join(FACTORY_BIN, name)).mtimeMs,
      }))
    : [];
  const library = newestSqliteLibrary(entries);
  return library === undefined ? undefined : path.join(FACTORY_BIN, library);
}

let sqlitePinned: boolean | undefined;

function pinSqlite(): boolean {
  if (sqlitePinned !== undefined) {
    return sqlitePinned;
  }
  if (process.platform !== 'darwin') {
    sqlitePinned = true;
    return sqlitePinned;
  }
  const library = findDroidSqlite();
  if (library !== undefined) {
    Database.setCustomSQLite(library);
  }
  sqlitePinned = library !== undefined;
  return sqlitePinned;
}

function deleteIndexRows(ids: readonly string[]): void {
  if (ids.length === 0 || !existsSync(SESSION_INDEX)) {
    return;
  }
  if (!pinSqlite()) {
    warn(
      `${SESSION_INDEX}: Droid's own SQLite library is not in ${FACTORY_BIN}, so the index rows of ${ids.join(', ')} stay until Droid prunes them`,
    );
    return;
  }
  const db = new Database(SESSION_INDEX, { readwrite: true, create: false });
  try {
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const ingest = db.prepare('DELETE FROM session_ingest WHERE session_id = ?');
    const row = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    db.transaction(() => {
      for (const id of ids) {
        ingest.run(id);
        row.run(id);
      }
    })();
  } finally {
    db.close();
  }
}

function deleteSessions(sessions: readonly LedgerSession[], launchedAtMs: number): void {
  const deleted: string[] = [];
  for (const session of sessions) {
    if (mayDelete(bornMs(session.transcript), launchedAtMs)) {
      for (const file of sessionFiles(session)) {
        rmSync(file, { force: true });
      }
      deleted.push(session.id);
    } else {
      warn(`kept session ${session.id}: its transcript existed before this probe launched Droid`);
    }
  }
  deleteIndexRows(deleted);
}

const live = new Set<Ledger>();
let interrupted = false;
const interruptExit = Promise.withResolvers<never>();

async function releaseAllAndExit(): Promise<void> {
  const results = await Promise.allSettled(
    [...live].map(async (ledger) => {
      await ledger.cleanup();
    }),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      warn(messageOf(result.reason));
    }
  }
  process.exit(INTERRUPTED_EXIT_CODE);
}

function onInterrupt(): void {
  if (interrupted) {
    warn('still cleaning up: waiting for Droid to exit so its sessions can be deleted');
    return;
  }
  interrupted = true;
  warn('interrupted: stopping Droid and deleting the sessions it created');
  void releaseAllAndExit();
}

function stopListening(): void {
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
}

export class Ledger {
  readonly env: Record<string, string>;
  private readonly dir: string;
  private readonly cwd: string;
  private readonly startBoundMs: number;
  private readonly launchedAtMs = Date.now();
  private child: Child | undefined;
  private expectedAt: number | undefined;
  private released: Promise<void> | undefined;

  constructor(cwd: string = process.cwd(), startBoundMs: number = START_HOOK_BOUND_MS) {
    if (interrupted) {
      throw new Error('interrupted: not starting another Droid');
    }
    this.cwd = cwd;
    this.startBoundMs = startBoundMs;
    this.dir = makeTempDir('sessions');
    this.env = { [LEDGER_VARIABLE]: this.dir };
    if (live.size === 0) {
      process.on('SIGINT', onInterrupt);
      process.on('SIGTERM', onInterrupt);
    }
    live.add(this);
  }

  adopt(child: Child): void {
    this.child = child;
  }

  expectSession(): void {
    this.expectedAt ??= performance.now();
  }

  async confirmSession(): Promise<void> {
    this.expectSession();
    if (!(await this.waitForRecord())) {
      throw this.missingRecord(this.child === undefined ? undefined : exitOf(this.child));
    }
  }

  async release(signal: NodeJS.Signals = 'SIGINT'): Promise<void> {
    await Promise.allSettled([this.cleanup(signal)]);
    if (interrupted) {
      await interruptExit.promise;
    }
    await this.cleanup(signal);
  }

  async cleanup(signal: NodeJS.Signals = 'SIGINT'): Promise<void> {
    this.released ??= this.sweep(signal);
    await this.released;
  }

  private async waitForRecord(): Promise<boolean> {
    const { expectedAt } = this;
    if (expectedAt === undefined) {
      return true;
    }
    for (;;) {
      const ended = this.child !== undefined && exitOf(this.child) !== undefined;
      const waitedMs = ended ? this.startBoundMs : performance.now() - expectedAt;
      const verdict = registration(this.records(), { waitedMs, boundMs: this.startBoundMs });
      if (verdict !== 'waiting') {
        return verdict === 'registered';
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(START_HOOK_POLL_MS);
    }
  }

  private missingRecord(endedBeforeStop: string | undefined): Error {
    const folder = path.join(FACTORY_SESSIONS, sessionFolderName(realpathSync(this.cwd)));
    const exitNote =
      endedBeforeStop === undefined ? '' : `\nDroid had already exited with ${endedBeforeStop}.`;
    return new Error(`${missingHookMessage(folder, this.startBoundMs)}${exitNote}`);
  }

  private async sweep(signal: NodeJS.Signals): Promise<void> {
    let missing: Error | undefined;
    try {
      await this.waitForRecord();
      const endedBeforeStop = this.child === undefined ? undefined : exitOf(this.child);
      if (this.child !== undefined) {
        await stopChild(this.child, signal);
      }
      const records = this.records();
      deleteSessions(readLedger(records, FACTORY_SESSIONS), this.launchedAtMs);
      const finalBound = { waitedMs: this.startBoundMs, boundMs: this.startBoundMs };
      if (this.expectedAt !== undefined && registration(records, finalBound) !== 'registered') {
        missing = this.missingRecord(endedBeforeStop);
      }
    } finally {
      rmSync(this.dir, { recursive: true, force: true });
      live.delete(this);
      if (live.size === 0 && !interrupted) {
        stopListening();
      }
    }
    if (missing !== undefined) {
      throw missing;
    }
  }

  private records(): string[] {
    return readdirSync(this.dir).map((name) => readFileSync(path.join(this.dir, name), 'utf-8'));
  }
}
