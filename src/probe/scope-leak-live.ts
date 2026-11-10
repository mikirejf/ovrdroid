import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { guard, messageOf, say } from '../cli.ts';
import { LOG_PATH } from './effort-switch-turn.ts';
import type { Fields } from './fields.ts';
import { fieldsOf, fieldsOfJson, numberAt, worded } from './fields.ts';
import { ledgerHooks } from './ledger.ts';
import { send, waitFor } from './rewind.ts';
import { createWaitProject, removeWaitProject } from './scope-leak-project.ts';
import { waitLogReading } from './scope-leak-report.ts';
import { alive, logSince, watchUntil } from './scope-leak.ts';
import { openSettledSession } from './session.ts';
import type { Session } from './session.ts';

export const LIVE_MODEL = 'custom:droidproxy:gpt-6.1-sol';
export const LIVE_PROMPT =
  'Launch four sub-agents in ONE message, all with run_in_background true and subagent_type "worker". Use model "custom:droidproxy:gpt-6.1-sol" for all four; effort "low" for the first two and "medium" for the last two. Give each this task: "In one Script, read notes.txt, grep the project for the word marker, and run ls with Execute, all started together; then reply with one short line saying what you found." After launching, call TaskOutput with block true on the first two. Do not wait on the other two; when both of their completion notices have arrived, reply with exactly LIVE-DONE and nothing else.';
const CAP_MS = 480_000;
const OBSERVE_MS = 30_000;
const UI_EVENTS = new Set(['schedule', 'fire', 'footer-render']);

export interface ScopeGroup {
  event: string;
  frames: string[];
  count: number;
  example: string;
}
export function groupScopeRows(text: string, pid: number) {
  const counts = new Map<string, number>();
  const groups = new Map<string, ScopeGroup>();
  let invalidRows = 0;
  for (const line of text.split('\n').filter(Boolean)) {
    const row = fieldsOfJson(line);
    const event = worded(row, 'event');
    if (event === '') {
      invalidRows += 1;
      continue;
    }
    if (numberAt(row, 'pid') !== pid) {
      continue;
    }
    counts.set(event, (counts.get(event) ?? 0) + 1);
    if (UI_EVENTS.has(event)) {
      const frames = worded(row, 'stack')
        .split('\n')
        .filter((frame) => frame.includes('/$bunfs/'))
        .slice(0, 3);
      const key = JSON.stringify([event, frames]);
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, { event, frames, count: 1, example: line });
      } else {
        group.count += 1;
      }
    }
  }
  return {
    counts: Object.fromEntries(counts),
    groups: [...groups.values()],
    scopedUiRows: [...groups.values()].reduce((total, group) => total + group.count, 0),
    invalidRows,
  };
}
function entries(log: string): string[] {
  return log.split(/(?=^\[\d{4}-\d\d-\d\dT)/mu).filter(Boolean);
}
export function livePidLog(log: string, pid: number): string {
  return entries(log)
    .filter((entry) => entry.includes(`"process.pid":${pid}}`))
    .join('');
}
function contextOf(entry: string): Fields {
  return fieldsOfJson(entry.split(' | Context: ').at(-1)?.trim() ?? '');
}
function sessionOf(context: Fields): string {
  return worded(context, 'sessionId') || worded(fieldsOf(context.get('tags')), 'sessionId');
}
export function liveChildren(log: string, pid: number) {
  const owned = livePidLog(log, pid);
  const rows = entries(owned);
  const main = rows.map((row) => sessionOf(contextOf(row))).find(Boolean) ?? '';
  const children = new Map<string, { sessionId: string; model: string; effort: string }>();
  for (const row of rows.filter((entry) => entry.includes('[LLM] sendMessage'))) {
    const context = contextOf(row);
    const sessionId = sessionOf(context);
    if (sessionId !== '' && sessionId !== main && !children.has(sessionId)) {
      children.set(sessionId, {
        sessionId,
        model: worded(fieldsOf(context.get('tags')), 'modelId') || worded(context, 'modelId'),
        effort: worded(context, 'reasoningEffort'),
      });
    }
  }
  const reading = waitLogReading(log, pid, { main, children: [...children.keys()] });
  const completed = new Set(
    rows
      .filter(
        (row) =>
          row.includes('[Daemon] Agent run complete') && contextOf(row).get('isError') === false,
      )
      .map((row) => sessionOf(contextOf(row))),
  );
  return {
    main,
    children: [...children.values()].map((child) =>
      Object.assign(child, {
        completed: completed.has(child.sessionId),
        teardownMs: reading.teardowns[child.sessionId] ?? 0,
        hostCloseMs: reading.hostCloses[child.sessionId] ?? 0,
      }),
    ),
  };
}
export function liveDone(screen: readonly string[]): boolean {
  return /(?:^|\n)\s*⛬\s+LIVE-DONE\s*(?:\n|$)/u.test(screen.join('\n'));
}
export interface LiveEvidence {
  pid: number;
  launchedAtMs: number;
  liveDoneAtMs: number;
  observedMs: number;
  quitAtMs: number;
  exited: boolean;
  autonomy: string;
  failure: string;
  fatal: string;
  main: string;
  children: ReturnType<typeof liveChildren>['children'];
  diagnostics: ReturnType<typeof groupScopeRows>;
}
export function liveVerdict(evidence: LiveEvidence): string {
  if (evidence.exited) {
    return `crashed: ${evidence.fatal || 'process exited early without logged fatal text'}`;
  }
  const reasons: string[] = [];
  if (evidence.failure !== '') {
    reasons.push(evidence.failure);
  }
  if (evidence.children.length !== 4) {
    reasons.push(`${evidence.children.length}/4 children launched`);
  }
  const completed = evidence.children.filter((child) => child.completed).length;
  if (completed !== 4) {
    reasons.push(`${completed}/4 children completed`);
  }
  if (!evidence.children.every((child) => child.teardownMs > 0 && child.hostCloseMs > 0)) {
    reasons.push('child teardown or attributed host-close evidence missing');
  }
  if (
    evidence.children.some((child) => child.model !== LIVE_MODEL) ||
    ['low', 'medium'].some(
      (effort) => evidence.children.filter((child) => child.effort === effort).length !== 2,
    )
  ) {
    reasons.push('four Sol children with two low and two medium efforts not observed');
  }
  if (evidence.liveDoneAtMs === 0) {
    reasons.push('LIVE-DONE never appeared');
  } else if (evidence.observedMs < OBSERVE_MS) {
    reasons.push(`only ${evidence.observedMs}ms observed after LIVE-DONE`);
  }
  if (evidence.diagnostics.counts['init'] !== 1 || evidence.diagnostics.invalidRows > 0) {
    reasons.push('diagnostic log missing or incomplete');
  }
  if (reasons.length > 0) {
    return `unproven: ${reasons.join('; ')}`;
  }
  return evidence.diagnostics.scopedUiRows === 0
    ? 'survived, no scoped UI work'
    : `survived, ${evidence.diagnostics.scopedUiRows} scoped UI rows`;
}
function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf-8') : '';
}
async function observeLive(
  session: Session,
  deadline: number,
  evidence: LiveEvidence,
): Promise<void> {
  session.paste(LIVE_PROMPT);
  await session.quiet(300, 1000);
  await send(session, '');
  const state = await waitFor(
    'LIVE-DONE never appeared',
    () => {
      if (!alive(session.pid)) {
        return 'exited';
      }
      const screen = session.screen();
      if (evidence.autonomy === 'low' && screen.some((line) => line.includes('Yes, allow'))) {
        session.press('\u000C');
        evidence.autonomy = 'medium';
      }
      if (liveDone(screen)) {
        evidence.liveDoneAtMs = Date.now();
      }
      return evidence.liveDoneAtMs === 0 ? undefined : 'done';
    },
    Math.max(1, deadline - performance.now() - OBSERVE_MS),
  );
  evidence.exited = state === 'exited';
  if (state === 'done') {
    evidence.exited = await watchUntil(
      session.pid,
      Math.max(0, Math.min(OBSERVE_MS, deadline - performance.now())),
    );
    evidence.observedMs = Date.now() - evidence.liveDoneAtMs;
  }
}
export async function scopeLive(binary: string, options: { out: string }): Promise<void> {
  const scopeFile = Bun.env['OD_SCOPE_LOG'];
  if (scopeFile === undefined || scopeFile === '' || existsSync(scopeFile)) {
    throw new Error('scope-live requires a fresh OD_SCOPE_LOG path');
  }
  const out = path.resolve(options.out);
  if (existsSync(out)) {
    throw new Error('scope-live requires a fresh --out directory');
  }
  mkdirSync(out, { recursive: true });
  const project = createWaitProject(
    { cwd: '/tmp', hold: 30, linger: 0, timeout: 480 },
    Date.now().toString(36),
  );
  const deadline = performance.now() + CAP_MS;
  const start = Bun.file(LOG_PATH).size;
  const evidence: LiveEvidence = {
    pid: 0,
    launchedAtMs: Date.now(),
    liveDoneAtMs: 0,
    observedMs: 0,
    quitAtMs: 0,
    exited: false,
    autonomy: 'low',
    failure: '',
    fatal: '',
    main: '',
    children: [],
    diagnostics: groupScopeRows('', 0),
  };
  let session: Session | undefined;
  let terminalTail = '';
  let screen: readonly string[] = [];
  try {
    writeFileSync(path.join(project.dir, 'notes.txt'), 'A marker for the live scope probe.\n');
    writeFileSync(
      project.settingsFile,
      JSON.stringify({
        sessionDefaultSettings: { model: LIVE_MODEL, reasoningEffort: 'low' },
      }),
    );
    mkdirSync(path.dirname(project.droids), { recursive: true });
    writeFileSync(
      path.join(project.dir, '.factory', 'settings.json'),
      JSON.stringify({ hooks: ledgerHooks() }),
    );
    writeFileSync(
      project.flagsFile,
      JSON.stringify({ flags: { shared_process_agents: true }, configs: {} }),
    );
    ({ session } = await openSettledSession(binary, {
      cwd: project.dir,
      args: ['--settings', project.settingsFile, '--auto', 'low'],
      env: {
        FACTORY_RUNTIME_SETTINGS_PATH: project.settingsFile,
        FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: project.flagsFile,
        HERDR_ENV: '1',
        HERDR_BIN_PATH: 'true',
        TERM_PROGRAM: 'herdr',
        OD_SCOPE_LOG: scopeFile,
      },
      screen: true,
      onData: (text) => {
        terminalTail = (terminalTail + text).slice(-65_536);
      },
    }));
    evidence.pid = session.pid;
    await observeLive(session, deadline, evidence);
  } catch (error) {
    evidence.failure = messageOf(error);
    evidence.exited =
      session === undefined
        ? /exited with|Agent runtime scope is disposed/u.test(evidence.failure)
        : !alive(session.pid);
  } finally {
    screen = session?.screen() ?? [terminalTail];
    evidence.quitAtMs = Date.now();
    try {
      await session?.close();
    } catch (error) {
      evidence.failure += `; cleanup: ${messageOf(error)}`;
    }
    const scopeText = readText(scopeFile);
    if (evidence.pid === 0) {
      evidence.pid = numberAt(fieldsOfJson(scopeText.split('\n')[0] ?? ''), 'pid') ?? 0;
    }
    const log = livePidLog(await logSince(start), evidence.pid);
    Object.assign(evidence, liveChildren(log, evidence.pid), {
      diagnostics: groupScopeRows(scopeText, evidence.pid),
    });
    evidence.fatal = entries(log)
      .filter((entry) => /ERROR:|FATAL:|Startup failed|CLI startup failed/u.test(entry))
      .join('\n');
    if (
      evidence.fatal === '' &&
      /Startup failed|Agent runtime scope is disposed/u.test(screen.join('\n'))
    ) {
      evidence.fatal = screen.join('\n');
    }
    writeFileSync(path.join(out, 'screen.txt'), screen.join('\n'));
    writeFileSync(path.join(out, 'process.log'), log);
    writeFileSync(
      path.join(out, 'evidence.json'),
      JSON.stringify({ ...evidence, verdict: liveVerdict(evidence) }, null, 2),
    );
    removeWaitProject(project.dir);
  }
  say(liveVerdict(evidence));
  say(
    JSON.stringify({
      children: evidence.children,
      liveDoneAtMs: evidence.liveDoneAtMs,
      autonomy: evidence.autonomy,
      diagnostics: evidence.diagnostics,
    }),
  );
  if (!liveVerdict(evidence).startsWith('survived,')) {
    process.exitCode = 1;
  }
}
export function registerScopeLiveCommand(program: Command): void {
  program
    .command('scope-live')
    .description(
      'MAKES REAL MODEL CALLS: do real Sol sub-agents leave a disposed scope scheduling UI work?',
    )
    .argument('<binary>')
    .requiredOption(
      '--out <dir>',
      'save the screen, pid-only process log and evidence in a fresh directory',
    )
    .action(guard(scopeLive));
}
