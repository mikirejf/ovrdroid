export const SUMMARY_SECTIONS = [
  'chronological play-by-play',
  'primary request and intent',
  'approach',
  'key technical work',
  'questions and clarifications',
  'files and code sections',
  'error resolution',
  'pending tasks',
  'current work',
  'next steps',
] as const;

export const MIN_SUMMARY_SECTIONS = 3;

export const HEADING_SOURCE = String.raw`^[ \t#*_>•·–-]*(?:\d{1,2}[.)][ \t*_]*)?([a-z][^\n]*)`;

export const HEADING_FLAGS = 'gmu';

export const PARENT_BRIEF_LEAD = 'The task your parent gave you, word for word:';

export const PARENT_NOTE = 'Your parent reads only your final reply. It never saw this summary.';

export function summarySections(text: string): number {
  const found = new Set<string>();
  for (const [, heading = ''] of text
    .toLowerCase()
    .matchAll(new RegExp(HEADING_SOURCE, HEADING_FLAGS))) {
    for (const section of SUMMARY_SECTIONS) {
      if (heading.startsWith(section)) {
        found.add(section);
      }
    }
  }
  return found.size;
}

export function isSummary(text: string): boolean {
  return summarySections(text) >= MIN_SUMMARY_SECTIONS;
}

export function summaryBody(stored: string): string {
  const lead = stored.indexOf(`\n\n${PARENT_BRIEF_LEAD}`);
  return lead === -1 ? stored : stored.slice(0, lead);
}
