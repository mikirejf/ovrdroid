import { fieldsOf, fieldsOfJson, worded } from './fields.ts';
import type { Outcome } from './scope-leak-report.ts';

export const FLAG_PRINCIPAL = { userId: 'scope-flag-user', orgId: 'scope-flag-org' };
export const FLAG_ARM_DELAY_MS = 65_000;
export const DEFAULT_FLAG_TIMEOUT_S = 150;
export const FLAG_RELEASE_DELAY_MS = 3000;
export const FLAG_OBSERVE_MS = 16_000;
export function flagCacheFixture(nowMs: number) {
  return {
    ...FLAG_PRINCIPAL,
    flags: { shared_process_agents: true, droids_view: false },
    configs: {
      provider_routing: {
        version: 1,
        defaults: {},
        models: {},
        blockedProviders: {},
        fetchedAt: new Date(nowMs - 600_000).toISOString(),
      },
    },
  };
}
export function flagReply(changed: boolean) {
  return {
    flags: { shared_process_agents: true, droids_view: changed },
    configs: {},
  };
}
export interface FlagEvidence {
  firstFlagMs: number;
  armedMs: number;
  flagRequests: readonly { atMs: number; status: number }[];
  child: string;
  childStartedMs: number;
  teardownMs: number;
  hostClosedMs: number;
  requestMs: number;
  releasedMs: number;
  responseChanged: boolean;
  aborted: boolean;
  observedMs: number;
  exited: boolean;
  fatalMs: number;
  fatal: string;
  failure: string;
}
function flagArmingCoverage(evidence: FlagEvidence): string[] {
  const reasons: string[] = [];
  if (evidence.firstFlagMs === 0 || evidence.armedMs < evidence.firstFlagMs + FLAG_ARM_DELAY_MS) {
    reasons.push('flags not armed 65s after first request');
  }
  if (evidence.flagRequests.length === 0) {
    reasons.push('flag request statuses missing');
  } else if (
    evidence.flagRequests.some((row) => row.status === 200 && row.atMs < evidence.armedMs)
  ) {
    reasons.push('successful flag reply before arming');
  }
  if (evidence.requestMs > 0 && (evidence.armedMs === 0 || evidence.requestMs < evidence.armedMs)) {
    reasons.push('held flag request before arming');
  }
  return reasons;
}
export function flagCoverage(evidence: FlagEvidence): string[] {
  const reasons = flagArmingCoverage(evidence);
  if (evidence.failure !== '') {
    reasons.push(evidence.failure);
  }
  if (evidence.child === '' || evidence.childStartedMs === 0) {
    reasons.push('child start missing');
  }
  if (evidence.requestMs === 0) {
    reasons.push('flag request never reached stub');
  } else if (
    evidence.requestMs < evidence.childStartedMs ||
    evidence.teardownMs === 0 ||
    evidence.requestMs >= evidence.teardownMs
  ) {
    reasons.push('flag request not within child lifetime');
  }
  if (
    evidence.hostClosedMs === 0 ||
    evidence.teardownMs === 0 ||
    evidence.releasedMs <
      Math.max(evidence.teardownMs, evidence.hostClosedMs) + FLAG_RELEASE_DELAY_MS
  ) {
    reasons.push('changed response not released 3s after teardown and host close');
  }
  if (!evidence.responseChanged || evidence.aborted) {
    reasons.push('changed response not delivered');
  }
  if (evidence.exited) {
    if (
      !evidence.fatal.includes('Agent runtime scope is disposed') ||
      evidence.fatalMs < evidence.releasedMs
    ) {
      reasons.push('exit without post-release scope fatal');
    }
  } else if (evidence.observedMs < FLAG_OBSERVE_MS) {
    reasons.push('less than 16s observed after release');
  }
  return reasons;
}
export function flagOutcome(evidence: FlagEvidence): Outcome {
  if (flagCoverage(evidence).length > 0) {
    return 'unproven';
  }
  return evidence.exited ? 'crashed' : 'survived';
}
export function flagLifecycle(log: string, pid: number) {
  const rows = log
    .split(/(?=^\[\d{4}-\d\d-\d\dT)/mu)
    .filter((row) => row.includes(`"process.pid":${pid}}`))
    .map((text) => {
      const context = fieldsOfJson(text.split(' | Context: ')[1] ?? '');
      return {
        text,
        atMs: Date.parse(text.slice(1, 25)),
        session: worded(context, 'sessionId') || worded(fieldsOf(context.get('tags')), 'sessionId'),
      };
    });
  const starts = rows.filter((row) => row.text.includes('[Daemon] Starting agent run'));
  const main = starts[0]?.session ?? '';
  const child = starts.find((row) => row.session !== main);
  const childStart =
    rows.find(
      (row) =>
        row.session === child?.session &&
        row.text.includes('[Daemon] Droid InitializeSession method called'),
    ) ?? child;
  const fatal = rows.find(
    (row) =>
      row.text.includes('CLI startup failed') &&
      row.text.includes('Agent runtime scope is disposed'),
  );
  return {
    main,
    child: child?.session ?? '',
    childStartedMs: childStart?.atMs ?? 0,
    fatal: fatal?.text ?? '',
    fatalMs: fatal?.atMs ?? 0,
  };
}
