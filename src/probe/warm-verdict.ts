import { whole } from '../cli.ts';
import { kept } from './effort-cache-verdict.ts';
import type { TurnUsage } from './effort-switch-verdict.ts';
import { counted, fieldsOfJson, worded } from './fields.ts';

const CACHE_LABEL = /cache (?:cold(?:: [^\]│]*? changed)?|checking|unchecked|<1m|\d+m)/u;
const LABEL_MINUTES = /^cache (?<minutes>\d+)m$/u;
const FULL_CLOCK = 'cache 44m';

export interface WarmLine {
  at: number;
  ok: boolean;
  cacheRead: number;
  cacheWrite: number;
}

export interface WarmLabels {
  afterLaunch: string | undefined;
  beforeWarm: string | undefined;
  afterWarm: string | undefined;
  afterNext: string | undefined;
}

export interface WarmRun {
  delayMs: number;
  launch: TurnUsage;
  launchSentAt: number;
  childRunning: boolean;
  warm: WarmLine | undefined;
  next: TurnUsage | undefined;
  labels: WarmLabels;
}

export interface LabelSample {
  at: number;
  label: string | undefined;
}

export interface WarmCheck {
  pass: boolean;
  text: string;
}

export function warmLinesOf(body: string, sessionId: string): WarmLine[] {
  return body
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => fieldsOfJson(line))
    .filter((row) => row.get('warm') === true && worded(row, 's') === sessionId)
    .map((row) => ({
      at: counted(row, 't'),
      ok: row.get('ok') === true,
      cacheRead: counted(row, 'cr'),
      cacheWrite: counted(row, 'cw'),
    }));
}

export function labelBefore(samples: readonly LabelSample[], at: number): string | undefined {
  return samples.findLast((sample) => sample.at < at)?.label;
}

export function cacheLabelOf(text: string): string | undefined {
  return CACHE_LABEL.exec(text)?.[0];
}

function minutesOf(label: string | undefined): number | undefined {
  const minutes = label === undefined ? undefined : LABEL_MINUTES.exec(label)?.groups?.['minutes'];
  return minutes === undefined ? undefined : Number(minutes);
}

function shown(label: string | undefined): string {
  return label === undefined ? 'no cache label' : `"${label}"`;
}

function check(pass: boolean, passed: string, failed: string): WarmCheck {
  return { pass, text: pass ? passed : failed };
}

function firedCheck(run: WarmRun): WarmCheck {
  const seconds = Math.round(run.delayMs / 1000);
  const { warm } = run;
  if (warm === undefined) {
    return check(
      false,
      '',
      run.childRunning
        ? `no warm request fired after ${seconds}s idle with a sub-agent running`
        : `the sub-agent finished before the ${seconds}s idle delay was up, so the run did not exercise the warmer`,
    );
  }
  const after = Math.round((warm.at - run.launchSentAt) / 1000);
  if (warm.at - run.launchSentAt < run.delayMs) {
    return check(
      false,
      '',
      `the warm request fired ${after}s after the launch prompt, before the ${seconds}s delay`,
    );
  }
  return check(
    warm.ok,
    `the warm request fired ${after}s after the launch prompt (delay ${seconds}s), with sub-agents running`,
    `the warm request fired ${after}s after the launch prompt but failed or was aborted`,
  );
}

function prefixOf(launch: TurnUsage): number {
  return launch.cacheRead + launch.cacheWrite;
}

function warmReadCheck(run: WarmRun): WarmCheck {
  const prefix = prefixOf(run.launch);
  if (prefix === 0) {
    return check(false, '', 'the launch turn cached nothing, so the run cannot judge the warm');
  }
  if (run.warm === undefined) {
    return check(false, '', 'no warm request, so nothing read the cached prefix');
  }
  return check(
    kept(run.warm, prefix),
    `the warm request read ${whole(run.warm.cacheRead)} of the ${whole(prefix)}-token cached prefix and wrote ${whole(run.warm.cacheWrite)}`,
    `the warm request read only ${whole(run.warm.cacheRead)} of the ${whole(prefix)}-token cached prefix and wrote ${whole(run.warm.cacheWrite)}: it did not match the session's request`,
  );
}

function nextCheck(run: WarmRun): WarmCheck {
  const prefix = prefixOf(run.launch);
  if (run.next === undefined) {
    return check(false, '', 'the turn after the warm was not taken');
  }
  return check(
    prefix > 0 && kept(run.next, prefix),
    `the next turn read ${whole(run.next.cacheRead)} of the ${whole(prefix)}-token prefix`,
    `the next turn read only ${whole(run.next.cacheRead)} of the ${whole(prefix)}-token prefix and wrote ${whole(run.next.cacheWrite)}`,
  );
}

function labelChecks(labels: WarmLabels): WarmCheck[] {
  const before = minutesOf(labels.beforeWarm);
  const launched = minutesOf(labels.afterLaunch);
  const after = minutesOf(labels.afterWarm);
  return [
    check(
      labels.afterLaunch === FULL_CLOCK,
      `right after the launch turn the footer showed "${FULL_CLOCK}"`,
      `right after the launch turn the footer showed ${shown(labels.afterLaunch)}, not "${FULL_CLOCK}"`,
    ),
    check(
      launched !== undefined && before !== undefined && before < launched,
      `just before the warm was due it had counted down to ${shown(labels.beforeWarm)}`,
      `just before the warm was due it showed ${shown(labels.beforeWarm)}, not a countdown below ${shown(labels.afterLaunch)}`,
    ),
    check(
      before !== undefined && after !== undefined && after > before,
      `after the warm it went back up to ${shown(labels.afterWarm)}`,
      `after the warm it showed ${shown(labels.afterWarm)}: the clock did not take the warm`,
    ),
    check(
      labels.afterNext === FULL_CLOCK,
      `after the next turn it showed "${FULL_CLOCK}"`,
      `after the next turn it showed ${shown(labels.afterNext)}, not "${FULL_CLOCK}"`,
    ),
  ];
}

export function warmChecks(run: WarmRun): WarmCheck[] {
  return [firedCheck(run), warmReadCheck(run), nextCheck(run), ...labelChecks(run.labels)];
}

export function warmPassed(checks: readonly WarmCheck[]): boolean {
  return checks.every((entry) => entry.pass);
}

export function describeChecks(checks: readonly WarmCheck[]): string {
  return checks.map((entry) => `${entry.pass ? 'pass' : 'FAIL'}  ${entry.text}`).join('\n');
}
