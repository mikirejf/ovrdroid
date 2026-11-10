import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { messageOf } from '../cli.ts';
import { LIVE_LOG } from './logs-report.ts';
import { send } from './rewind.ts';
import { startFlagStub } from './scope-leak-flag-stub.ts';
import {
  FLAG_RELEASE_DELAY_MS,
  FLAG_OBSERVE_MS,
  flagCacheFixture,
  flagCoverage,
  flagLifecycle,
  flagOutcome,
} from './scope-leak-flags.ts';
import type { FlagEvidence } from './scope-leak-flags.ts';
import { groupScopeRows } from './scope-leak-live.ts';
import { LAUNCH_WORD, logEvents, waitLogReading } from './scope-leak-report.ts';
import type { ScopeLeakRun } from './scope-leak-report.ts';
import { alive, childDroidText, DROID_TYPE, leakSettings } from './scope-leak.ts';
import type { ScopeLeakOptions } from './scope-leak.ts';
import { openSettledSession } from './session.ts';
import type { Session } from './session.ts';

function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf-8') : '';
}
async function observeFlags(
  session: Session,
  stub: ReturnType<typeof startFlagStub>,
  { logFile, evidence, deadline }: { logFile: string; evidence: FlagEvidence; deadline: number },
) {
  while (alive(session.pid) && Date.now() < deadline) {
    const processLog = readText(logFile);
    const lifecycle = flagLifecycle(processLog, session.pid);
    Object.assign(evidence, lifecycle);
    const reading = waitLogReading(processLog, session.pid, {
      main: lifecycle.main,
      children: lifecycle.child === '' ? [] : [lifecycle.child],
    });
    evidence.teardownMs = reading.teardowns[lifecycle.child] ?? 0;
    evidence.hostClosedMs = reading.hostCloses[lifecycle.child] ?? 0;
    if (evidence.teardownMs > 0 && stub.timing.releasedMs === 0) {
      const releaseAt =
        Math.max(evidence.teardownMs, evidence.hostClosedMs) + FLAG_RELEASE_DELAY_MS + 1000;
      if (Date.now() >= releaseAt) {
        stub.release();
      }
    }
    if (
      stub.timing.releasedMs > 0 &&
      evidence.hostClosedMs > 0 &&
      Date.now() - stub.timing.releasedMs >= FLAG_OBSERVE_MS
    ) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(50);
  }
  evidence.exited = !alive(session.pid);
  if (stub.timing.releasedMs === 0) {
    evidence.failure = 'bounded run ended before changed flags could be released';
  }
}
export async function runFlagRefresh(
  binary: string,
  options: ScopeLeakOptions,
): Promise<ScopeLeakRun> {
  if (options.waitReports === true) {
    throw new Error('--flag-refresh uses the one-child scenario, not --wait-reports');
  }
  const run = Date.now().toString(36);
  const dir = mkdtempSync(path.join(realpathSync(options.cwd), 'ovrdroid-scope-flags-'));
  const home = path.join(dir, 'home');
  const factory = path.join(home, '.factory');
  const cache = path.join(factory, 'cache', 'feature-flags.json');
  const logFile = path.join(factory, 'logs', LIVE_LOG);
  const out = path.resolve(options.out ?? 'work/scope/flags', run);
  let session: Session | undefined;
  const stub = startFlagStub(run);
  const evidence: FlagEvidence = {
    firstFlagMs: 0,
    armedMs: 0,
    flagRequests: [],
    child: '',
    childStartedMs: 0,
    teardownMs: 0,
    hostClosedMs: 0,
    requestMs: 0,
    releasedMs: 0,
    responseChanged: false,
    aborted: false,
    observedMs: 0,
    exited: false,
    fatalMs: 0,
    fatal: '',
    failure: '',
  };
  let result: ScopeLeakRun;
  let terminal = '';
  let screen: string[] = [];
  let processLog = '';
  const deadline = Date.now() + Math.min(options.timeout * 1000, 240_000);
  try {
    mkdirSync(path.dirname(cache), { recursive: true });
    const fixture = flagCacheFixture(Date.now());
    writeFileSync(cache, JSON.stringify(fixture));
    writeFileSync(path.join(dir, 'cache-seed.json'), JSON.stringify(fixture));
    const settings = path.join(dir, 'settings.json');
    writeFileSync(settings, JSON.stringify(leakSettings(stub.url)));
    const orgSettings = path.join(dir, 'org-settings.json');
    writeFileSync(orgSettings, '{}');
    writeFileSync(
      path.join(factory, 'settings.json'),
      JSON.stringify({ trustedFolders: { [dir]: true } }),
    );
    const droids = path.join(dir, '.factory', 'droids');
    mkdirSync(droids, { recursive: true });
    writeFileSync(path.join(droids, `${DROID_TYPE}.md`), childDroidText());
    ({ session } = await openSettledSession(binary, {
      cwd: dir,
      args: ['--settings', settings, '--auto', 'high'],
      env: {
        FACTORY_RUNTIME_SETTINGS_PATH: settings,
        FACTORY_ORG_MANAGED_SETTINGS_LOCAL_PATH: orgSettings,
        FACTORY_LOG_FILE: logFile,
        FACTORY_HOME_OVERRIDE: home,
        FACTORY_API_BASE_URL: stub.url,
        FACTORY_API_BASE_URL_EU: stub.url,
        FACTORY_API_KEY: 'fk-scope-flag-local-stub',
      },
      screen: true,
      onData: (text) => {
        terminal = (terminal + text).slice(-65_536);
      },
    }));
    await send(session, `${LAUNCH_WORD} kept`);
    await observeFlags(session, stub, { logFile, evidence, deadline });
  } catch (error) {
    evidence.failure = messageOf(error);
    evidence.exited = session !== undefined && !alive(session.pid);
  } finally {
    const pid = session?.pid ?? 0;
    screen = session?.screen() ?? [];
    processLog = readText(logFile);
    Object.assign(evidence, flagLifecycle(processLog, pid), stub.timing);
    evidence.flagRequests = stub.requests
      .filter((row) => row.pathname === '/api/feature-flags')
      .map(({ atMs, status }) => ({ atMs, status }));
    const reading = waitLogReading(processLog, pid, {
      main: flagLifecycle(processLog, pid).main,
      children: evidence.child === '' ? [] : [evidence.child],
    });
    evidence.teardownMs = reading.teardowns[evidence.child] ?? 0;
    evidence.hostClosedMs = reading.hostCloses[evidence.child] ?? 0;
    evidence.observedMs = evidence.releasedMs === 0 ? 0 : Date.now() - evidence.releasedMs;
    if (evidence.fatal === '' && terminal.includes('Agent runtime scope is disposed')) {
      evidence.fatal = terminal;
    }
    result = {
      binary,
      exited: evidence.exited,
      events: logEvents(processLog, pid),
      flagRefresh: evidence,
    };
    mkdirSync(out, { recursive: true });
    const scopeFile = Bun.env['OD_SCOPE_LOG'];
    const diagnostics = groupScopeRows(scopeFile === undefined ? '' : readText(scopeFile), pid);
    for (const [name, text] of Object.entries({
      'process.log': processLog,
      'screen.txt': screen.join('\n'),
      'terminal.txt': terminal,
      'requests.json': JSON.stringify(stub.requests, null, 2),
      'cache-seed.json': readText(path.join(dir, 'cache-seed.json')),
      'cache-final.json': readText(cache),
      'evidence.json': JSON.stringify(
        {
          pid,
          home,
          cache,
          url: stub.url,
          ...evidence,
          coverage: flagCoverage(evidence),
          outcome: flagOutcome(evidence),
          diagnostics,
        },
        null,
        2,
      ),
    })) {
      writeFileSync(path.join(out, name), text);
    }
    try {
      await session?.close();
    } finally {
      await stub.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return result;
}
