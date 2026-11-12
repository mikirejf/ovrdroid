import { IMAGE_LINK_DIRECTIVE, STOCK_IMAGE_DIRECTIVE } from '../patch/file-link-patches.ts';
import { plain } from './ansi.ts';
import type { Verdict } from './busy-signal-report.ts';

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const TERMINATOR = `(?:${BEL}|${ESC}\\\\)`;
const LINK = new RegExp(
  `${ESC}\\]8;[^;${ESC}${BEL}]*;(?<url>[^${ESC}${BEL}]+)${TERMINATOR}(?<label>[\\s\\S]*?)${ESC}\\]8;[^;${ESC}${BEL}]*;${TERMINATOR}`,
  'gu',
);
const KITTY = new RegExp(`${ESC}_G(?<params>[^;]*);[\\s\\S]*?${ESC}\\\\`, 'gu');
const OTHER_IMAGE = new RegExp(`${ESC}\\]1337;(?:File|MultipartFile)=|${ESC}P[0-9;?]*q`, 'u');

export interface ImageLinksEvidence {
  request: string | undefined;
  output: string;
  fileUrl: string;
}

function blockText(block: unknown): string {
  return typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'text' &&
    'text' in block &&
    typeof block.text === 'string'
    ? block.text
    : '';
}

function systemPrompt(request: string | undefined): string {
  if (request === undefined) {
    return '';
  }
  const body: unknown = JSON.parse(request);
  if (typeof body !== 'object' || body === null || !('system' in body)) {
    return '';
  }
  const { system } = body;
  if (typeof system === 'string') {
    return system;
  }
  return Array.isArray(system) ? system.map((block) => blockText(block)).join('\n') : '';
}

function hasImageDisplay(output: string): boolean {
  return (
    OTHER_IMAGE.test(output) ||
    [...output.matchAll(KITTY)].some(
      (match) => !/(?:^|,)a=q(?:,|$)/u.test(match.groups?.['params'] ?? ''),
    )
  );
}

export function imageLinksVerdicts(evidence: ImageLinksEvidence): Verdict[] {
  const prompt = systemPrompt(evidence.request);
  const links = [...evidence.output.matchAll(LINK)];
  const targetLinks = links.filter((match) => match.groups?.['url'] === evidence.fileUrl);
  return [
    {
      pass: evidence.request !== undefined,
      text: 'Droid sent a request to the local stub',
    },
    {
      pass: prompt.includes(IMAGE_LINK_DIRECTIVE),
      text: 'the actual system prompt contains the chat-only screenshot and generated-image link rule',
    },
    {
      pass: evidence.request !== undefined && !prompt.includes(STOCK_IMAGE_DIRECTIVE),
      text: 'the actual system prompt omits the stock image-embedding directive',
    },
    {
      pass: targetLinks.length > 0,
      text: `the reply emits an OSC8 link to ${evidence.fileUrl}`,
    },
    {
      pass: targetLinks.some((match) =>
        plain(match.groups?.['label'] ?? '').includes('Screenshot'),
      ),
      text: 'the file link displays its Screenshot label',
    },
    {
      pass: !hasImageDisplay(evidence.output),
      text: 'the reply emits no Kitty, iTerm2 or Sixel image display (graphics queries do not count)',
    },
  ];
}
