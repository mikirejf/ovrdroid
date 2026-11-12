import { fileURLToPath } from 'node:url';

import { plain } from './ansi.ts';
import type { Verdict } from './busy-signal-report.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const END = `(?:${BEL}|${ESC}\\\\)`;
const LINK = new RegExp(
  `${ESC}\\]8;[^;${ESC}${BEL}]*;(?<url>[^${ESC}${BEL}]+)${END}(?<label>[\\s\\S]*?)${ESC}\\]8;[^;${ESC}${BEL}]*;${END}`,
  'gu',
);
const KITTY = new RegExp(`${ESC}_G(?<params>[^;${ESC}]*);[\\s\\S]*?${ESC}\\\\`, 'gu');
const OTHER_IMAGE = new RegExp(`${ESC}\\]1337;(?:File|MultipartFile)=|${ESC}P[0-9;?]*q`, 'u');

export const TOOL_IMAGE_ARMS = ['on', 'off', 'inherited'] as const;
export type ToolImageArm = (typeof TOOL_IMAGE_ARMS)[number];
export const TOOL_IMAGE_CALLS = ['Read', 'Script'] as const;

export interface ToolImagesEvidence {
  arm: ToolImageArm;
  requests: readonly unknown[];
  toolOutput: Readonly<Record<(typeof TOOL_IMAGE_CALLS)[number], string>>;
  output: string;
  fileUrl: string;
}

export function toolImageScript(file: string): string {
  return `image(await tools.Read(${JSON.stringify({ file_path: file })}));`;
}

export function imageDisplayCount(output: string): number {
  return (
    [...output.matchAll(KITTY)].filter((match) =>
      /(?:^|,)a=[Tp](?:,|$)/u.test(match.groups?.['params'] ?? ''),
    ).length + Number(OTHER_IMAGE.test(output))
  );
}

function imageResult(request: unknown, name: string, fileUrl: string): boolean {
  const messages = entriesOf(fieldsOf(request), 'messages');
  const file = fileURLToPath(fileUrl);
  const ids = new Set(
    messages
      .filter((message) => worded(message, 'role') === 'assistant')
      .flatMap((message) => entriesOf(message, 'content'))
      .filter((block) => {
        const input = fieldsOf(block.get('input'));
        return (
          worded(block, 'type') === 'tool_use' &&
          worded(block, 'name') === name &&
          (name === 'Read'
            ? worded(input, 'file_path') === file
            : worded(input, 'script') === toolImageScript(file))
        );
      })
      .map((block) => worded(block, 'id'))
      .filter((id) => id.length > 0),
  );
  return messages.some((message) =>
    entriesOf(message, 'content').some((block) => {
      if (
        worded(block, 'type') !== 'tool_result' ||
        !ids.has(worded(block, 'tool_use_id')) ||
        block.get('is_error') === true
      ) {
        return false;
      }
      return entriesOf(block, 'content').some((part) => {
        const source = fieldsOf(part.get('source'));
        return (
          worded(part, 'type') === 'image' &&
          worded(source, 'type') === 'base64' &&
          worded(source, 'media_type') === 'image/png' &&
          Buffer.from(worded(source, 'data'), 'base64').subarray(0, 8).toString('hex') ===
            '89504e470d0a1a0a'
        );
      });
    }),
  );
}

function armVerdicts(evidence: ToolImagesEvidence): Verdict[] {
  const displays = imageDisplayCount(evidence.output);
  const perTool = TOOL_IMAGE_CALLS.map((name) => imageDisplayCount(evidence.toolOutput[name]));
  const links = [...evidence.output.matchAll(LINK)];
  return [
    ...TOOL_IMAGE_CALLS.map((name) => ({
      pass: evidence.requests.some((request) => imageResult(request, name, evidence.fileUrl)),
      text: `${evidence.arm}: ${name} returned PNG image data to the model under its own tool-use id`,
    })),
    {
      pass:
        evidence.arm === 'on'
          ? displays > 0 && perTool.every((count) => count > 0)
          : displays === 0,
      text: `${evidence.arm}: image displays Read=${perTool[0]}, Script=${perTool[1]}, total=${displays} (${evidence.arm === 'on' ? 'both control paths must display' : 'must not display'}; queries excluded)`,
    },
    {
      pass: links.some(
        (match) =>
          match.groups?.['url'] === evidence.fileUrl &&
          plain(match.groups['label'] ?? '').includes('Screenshot'),
      ),
      text: `${evidence.arm}: Screenshot is an OSC8 link to the encoded file URL`,
    },
  ];
}

export function toolImagesVerdicts(evidence: readonly ToolImagesEvidence[]): Verdict[] {
  return TOOL_IMAGE_ARMS.flatMap((arm) => {
    const found = evidence.filter((item) => item.arm === arm);
    const [item] = found;
    return found.length === 1 && item !== undefined
      ? armVerdicts(item)
      : [{ pass: false, text: `${arm}: expected exactly one isolated session` }];
  });
}
