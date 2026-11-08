import { embedName } from './graph.ts';

export type RemovedEmbeds = Readonly<Record<string, number>>;

const CONTENT_HASH = /-[a-z0-9]{8}(?=\.[^./]*$)/u;

export const REMOVED_EMBEDS = {
  'agent-browser.': 1,
  'SKILL.md.asset': 9,
  'authentication.md.asset': 1,
  'proxy-support.md.asset': 1,
  'commands.md.asset': 1,
  'profiling.md.asset': 1,
  'video-recording.md.asset': 1,
  'streaming.md.asset': 1,
  'trust-boundaries.md.asset': 1,
  'webgpu.md.asset': 1,
  'snapshot-refs.md.asset': 1,
  'session-management.md.asset': 1,
  'capture-workflow.sh.asset': 1,
  'form-automation.sh.asset': 1,
  'authenticated-session.sh.asset': 1,
  'slack-tasks.md.asset': 1,
  'slack-report-template.md.asset': 1,
  'issue-taxonomy.md.asset': 1,
  'dogfood-report-template.md.asset': 1,
} satisfies RemovedEmbeds;

export function embedStem(name: string): string {
  return embedName(name).replace(CONTENT_HASH, '');
}

export function removedNames(names: readonly string[], removed: RemovedEmbeds): Set<string> {
  const dropped = new Set<string>();
  const drift: string[] = [];

  for (const [stem, expected] of Object.entries(removed)) {
    const carried = names.filter((name) => embedStem(name) === stem);
    if (carried.length !== expected) {
      drift.push(`${stem} (list names ${expected}, binary carries ${carried.length})`);
    }
    for (const name of carried) {
      dropped.add(name);
    }
  }

  if (drift.length > 0) {
    throw new Error(
      `the embedded files marked for removal do not match the stock binary: ${drift.join(', ')}`,
    );
  }
  return dropped;
}
