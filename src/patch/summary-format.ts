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

export const SUMMARY_TAG = '<summary>';

export const HEADING_SOURCE = String.raw`^[ \t#*_>•·–-]*(?:\d{1,2}[.)][ \t*_]*)?([a-z][^\n]*)`;

export const HEADING_FLAGS = 'gmu';

export const OPENING_CHARS = 240;

const MARKDOWN_HEADING = /^ {0,3}#{1,6}[ \t]+\S/gmu;
const DECLINE_WORD =
  /\b(?:won['’]t|will not|not going to|can['’]t|cannot|rather than|skip(?:ping)?|declin\w*|refus\w*)\b/iu;
const SUMMARY_WORD = /\b(?:summar\w*|recap|template)\b/iu;
const KEEP_GOING = /\bkeep (?:going|working)\b/iu;

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

export function isSummaryReply(text: string): boolean {
  return text.toLowerCase().includes(SUMMARY_TAG) || isSummary(text);
}

export function summaryBody(stored: string): string {
  const lead = stored.indexOf(`\n\n${PARENT_BRIEF_LEAD}`);
  return lead === -1 ? stored : stored.slice(0, lead);
}

export function markdownHeadings(text: string): number {
  return text.match(MARKDOWN_HEADING)?.length ?? 0;
}

export function declines(text: string): boolean {
  const start = text.trim().slice(0, OPENING_CHARS);
  return (DECLINE_WORD.test(start) && SUMMARY_WORD.test(start)) || KEEP_GOING.test(start);
}

export function isStoredSummary(stored: string): boolean {
  const body = summaryBody(stored);
  if (body.toLowerCase().includes(SUMMARY_TAG)) {
    return true;
  }
  const sectioned =
    summarySections(body) >= MIN_SUMMARY_SECTIONS || markdownHeadings(body) >= MIN_SUMMARY_SECTIONS;
  return sectioned && !declines(body);
}
