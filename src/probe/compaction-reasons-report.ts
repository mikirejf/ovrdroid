import { OPENING_CHARS, readReply } from './compaction-outcome.ts';
import type { Arm } from './compaction-replay-plan.ts';
import { ARMS } from './compaction-replay-plan.ts';
import type { SavedReply } from './compaction-saved.ts';
import { savedName } from './compaction-saved.ts';
import { fieldsOf, worded } from './fields.ts';

const STATED_REASONS = [
  'concealment',
  'own-reasoning',
  'injection',
  'keep-working',
  'status-instead',
] as const;

type StatedReason = (typeof STATED_REASONS)[number];
export type Reason = StatedReason | 'none-stated';

interface Found {
  reason: Reason;
  phrase: string;
  source: 'thinking' | 'text';
  excerpt: string;
}

export interface SourcedReply {
  source: string;
  reply: SavedReply;
}

interface Refusal {
  file: string;
  arm: Arm;
  found: readonly Found[];
}

const NO_PHRASE = '(no phrase)';
const NOTHING_SAID = '(nothing said)';

const EXAMPLES_PER_REASON = 3;
const EXCERPT_AROUND = 60;
const EXCERPT_OPENING = 100;
const GAP = '  ';
const ARM_ORDER: readonly Arm[] = [...ARMS, 'stock-captured'];
const REASON_ORDER: readonly Reason[] = [...STATED_REASONS, 'none-stated'];

const SIGNS: Record<StatedReason, RegExp> = {
  concealment:
    /\basks? me to hide\b|\bhide that\b|\bnot mention\b|\bwithout mentioning\b|\bconceal\w*/iu,
  'own-reasoning':
    /\breproduc\w* (?:the|my|this)(?: own| earlier)* (?:transcript|reasoning|thinking|notes)\b|\binternal notes\b|\btranscript itself\b|\breasoning summary\b|\bmy (?:own |earlier )*reasoning\b/iu,
  injection:
    /\bnot (?:an? )?(?:actual|legitimate|real|genuine) (?:instruction|request)\b|\bembedded (?:summary )?(?:request|instruction)\b|\bjust data\b/iu,
  'keep-working':
    /\bkeep (?:going|working|moving|grinding|reading)\b|\bcontinu(?:e|ing)\b|\bhold(?:ing)? off\b|\bskip(?:ping)? (?:the|that|producing)\b|\bset aside\b|\bleave the summary\b|\bmid-task\b|\bstill (?:in progress|going|running)\b|\b(?:task|work) (?:continues|is still)\b|\binstead of (?:writing|summariz\w+)\b|\brather than writ(?:e|ing)\b/iu,
  'status-instead': /\b(?:brief|short|quick) (?:status|progress)\b|\bstatus (?:update|instead)\b/iu,
};

function squeezed(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function openingOf(text: string): string {
  return text.trim().slice(0, OPENING_CHARS);
}

function around(source: string, at: number, length: number): string {
  const start = Math.max(0, at - EXCERPT_AROUND);
  return squeezed(source.slice(start, at + length + EXCERPT_AROUND));
}

function signIn(reason: StatedReason, where: Found['source'], source: string): Found | undefined {
  const match = SIGNS[reason].exec(source);
  if (match === null) {
    return undefined;
  }
  return {
    reason,
    phrase: squeezed(match[0]),
    source: where,
    excerpt: around(source, match.index, match[0].length),
  };
}

function silent(thinking: string, text: string): Found {
  const quiet = squeezed(thinking);
  return {
    reason: 'none-stated',
    phrase: '',
    source: quiet === '' ? 'text' : 'thinking',
    excerpt:
      quiet === '' ? squeezed(text).slice(0, EXCERPT_OPENING) : quiet.slice(0, EXCERPT_OPENING),
  };
}

export function reasonsOf(thinking: string, text: string): Found[] {
  const opening = openingOf(text);
  const found = STATED_REASONS.flatMap((reason) => {
    const hit = signIn(reason, 'thinking', thinking) ?? signIn(reason, 'text', opening);
    return hit === undefined ? [] : [hit];
  });
  return found.length === 0 ? [silent(thinking, opening)] : found;
}

export function thinkingOf(content: readonly unknown[]): string {
  return content
    .map((block) => fieldsOf(block))
    .filter((fields) => worded(fields, 'type') === 'thinking')
    .map((fields) => worded(fields, 'thinking'))
    .join('\n');
}

function refusalOf({ source, reply }: SourcedReply): Refusal | undefined {
  if (reply.error !== undefined) {
    return undefined;
  }
  const reading = readReply(reply.content);
  if (reading.outcome !== 'refusal') {
    return undefined;
  }
  return {
    file: `${source}/${savedName(reply)}`,
    arm: reply.arm,
    found: reasonsOf(thinkingOf(reply.content), reading.text),
  };
}

function armsOf(replies: readonly SourcedReply[]): Arm[] {
  const seen = new Set(replies.map(({ reply }) => reply.arm));
  return ARM_ORDER.filter((arm) => seen.has(arm));
}

function carries(refusal: Refusal, reason: Reason): boolean {
  return refusal.found.some((found) => found.reason === reason);
}

function armLines(arm: Arm, replies: number, refusals: readonly Refusal[]): string[] {
  const width = Math.max(...REASON_ORDER.map((reason) => reason.length));
  return [
    `${arm}: ${refusals.length} refusals in ${replies} replies`,
    ...REASON_ORDER.map(
      (reason) =>
        `${GAP}${reason.padEnd(width)}  ${refusals.filter((refusal) => carries(refusal, reason)).length}`,
    ),
  ];
}

function exampleLines(reason: Reason, refusals: readonly Refusal[]): string[] {
  const examples = refusals
    .filter((refusal) => carries(refusal, reason))
    .slice(0, EXAMPLES_PER_REASON)
    .flatMap((refusal) =>
      refusal.found
        .filter((found) => found.reason === reason)
        .map((found) => {
          const phrase = found.phrase === '' ? NO_PHRASE : `"${found.phrase}"`;
          const excerpt = found.excerpt === '' ? NOTHING_SAID : found.excerpt;
          return `${GAP}${refusal.file}  ${phrase}  ${found.source}: ${excerpt}`;
        }),
    );
  return examples.length === 0 ? [] : [reason, ...examples];
}

export function reasonsReport(replies: readonly SourcedReply[]): string[] {
  const refusals = replies.flatMap((item) => refusalOf(item) ?? []);
  const sections = [
    ...armsOf(replies).map((arm) =>
      armLines(
        arm,
        replies.filter(({ reply }) => reply.arm === arm).length,
        refusals.filter((refusal) => refusal.arm === arm),
      ),
    ),
    ...REASON_ORDER.map((reason) => exampleLines(reason, refusals)),
  ].filter((section) => section.length > 0);
  const lines: string[] = [];
  for (const section of sections) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(...section);
  }
  return lines;
}
