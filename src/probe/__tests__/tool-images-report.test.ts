import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';

import { anyFailed } from '../busy-signal-report.ts';
import {
  imageDisplayCount,
  TOOL_IMAGE_ARMS,
  toolImageScript,
  toolImagesVerdicts,
} from '../tool-images-report.ts';
import type { ToolImagesEvidence } from '../tool-images-report.ts';
import { toolImagePng, toolImageSettings } from '../tool-images.ts';

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const FILE_URL = 'file:///tmp/tool-images/shot%20one%232.png';
const FILE = '/tmp/tool-images/shot one#2.png';
const LINK = `${ESC}]8;;${FILE_URL}${BEL}Screenshot${ESC}]8;;${BEL}`;
const DISPLAY = `${ESC}_Ga=T,U=1,f=32,s=64,v=64;AAAA${ESC}\\`;
const QUERY = `${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\`;
const IMAGE = {
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: toolImagePng().toString('base64') },
};

type ResultContent = string | readonly (typeof IMAGE | { type: string; text: string })[];

function request(id: string, content: ResultContent = [IMAGE], isError = false) {
  const name = id.endsWith('script') ? 'Script' : 'Read';
  return {
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id,
            name,
            input: name === 'Read' ? { file_path: FILE } : { script: toolImageScript(FILE) },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }],
      },
    ],
  };
}

function passing(): ToolImagesEvidence[] {
  return TOOL_IMAGE_ARMS.map((arm) => ({
    arm,
    toolOutput: { Read: arm === 'on' ? DISPLAY : '', Script: arm === 'on' ? DISPLAY : '' },
    requests: [
      request(`${arm}-read`),
      request(`${arm}-script`, [{ type: 'text', text: 'Script completed' }, IMAGE]),
    ],
    output: QUERY + LINK + (arm === 'on' ? DISPLAY + DISPLAY : ''),
    fileUrl: FILE_URL,
  }));
}

function failing(evidence: readonly ToolImagesEvidence[]): string[] {
  return toolImagesVerdicts(evidence)
    .filter((verdict) => !verdict.pass)
    .map((verdict) => verdict.text);
}

function change(
  arm: ToolImagesEvidence['arm'],
  edits: Partial<ToolImagesEvidence>,
): ToolImagesEvidence[] {
  return passing().map((item) => (item.arm === arm ? Object.assign(item, edits) : item));
}

describe('toolImagesVerdicts', () => {
  test('all three arms preserve image inspection and links, with graphics only in the control', () => {
    expect(anyFailed(toolImagesVerdicts(passing()))).toBe(false);
  });

  test('no graphics in the on control fails rather than passing vacuously on queries', () => {
    expect(
      failing(change('on', { output: QUERY + LINK, toolOutput: { Read: QUERY, Script: '' } })),
    ).toEqual([
      'on: image displays Read=0, Script=0, total=0 (both control paths must display; queries excluded)',
    ]);
  });

  test.each(['off', 'inherited'] as const)(
    '%s graphics fail even though image inspection succeeds',
    (arm) => {
      expect(failing(change(arm, { output: LINK + DISPLAY }))).toHaveLength(1);
    },
  );

  test.each(['Read', 'Script'] as const)(
    'a missing %s image result fails independently',
    (tool) => {
      const other = tool === 'Read' ? 'script' : 'read';
      expect(failing(change('off', { requests: [request(`off-${other}`)] }))).toEqual([
        `off: ${tool} returned PNG image data to the model under its own tool-use id`,
      ]);
    },
  );

  test.each([
    'image read successfully',
    [{ type: 'text', text: JSON.stringify(IMAGE) }],
    [{ type: 'image', source: { ...IMAGE.source, data: '' } }],
    [{ type: 'image', source: { ...IMAGE.source, data: 'not PNG image data' } }],
    [{ type: 'image', source: { ...IMAGE.source, type: 'url' } }],
  ])('text or absent image data is not an image result: %p', (content) => {
    expect(
      failing(
        change('off', {
          requests: [request('off-read', content), request('off-script')],
        }),
      ),
    ).toHaveLength(1);
  });

  test('an error and another call id cannot substitute for a successful Read image', () => {
    expect(
      failing(
        change('off', {
          requests: [
            request('off-read', [IMAGE], true),
            {
              messages: [
                {
                  role: 'user',
                  content: [{ type: 'tool_result', tool_use_id: 'wrong-id', content: [IMAGE] }],
                },
              ],
            },
            request('off-script'),
          ],
        }),
      ),
    ).toHaveLength(1);
  });

  test('normalized runtime ids are correlated with their actual assistant calls, not fixture ids', () => {
    expect(
      failing(
        change('off', {
          requests: [request('call_normalized_read'), request('call_normalized_script')],
        }),
      ),
    ).toEqual([]);
  });

  test('a control with only one rendered tool path fails', () => {
    expect(failing(change('on', { toolOutput: { Read: DISPLAY, Script: '' } }))).toHaveLength(1);
  });

  test.each([
    '',
    LINK.replace(FILE_URL, 'file:///tmp/tool-images/shot one#2.png'),
    LINK.replace('Screenshot', 'Other'),
    `[Screenshot](<${FILE_URL}>)`,
  ])('a missing encoded OSC8 target or label fails: %p', (output) => {
    expect(failing(change('off', { output }))).toEqual([
      'off: Screenshot is an OSC8 link to the encoded file URL',
    ]);
  });

  test('OSC8 string terminators and ANSI labels are accepted', () => {
    expect(
      failing(
        change('off', {
          output: LINK.replaceAll(BEL, `${ESC}\\`).replace(
            'Screenshot',
            `${ESC}[1mScreenshot${ESC}[0m`,
          ),
        }),
      ),
    ).toEqual([]);
  });

  test('omitting or duplicating an arm fails', () => {
    expect(failing(passing().filter((arm) => arm.arm !== 'on'))).toHaveLength(1);
    expect(failing([...passing(), ...passing()])).toHaveLength(3);
  });

  test('non-image terminal queries do not count, actual protocols do', () => {
    expect(imageDisplayCount(`${QUERY}${ESC}P$qm${ESC}\\`)).toBe(0);
    expect(imageDisplayCount(`${ESC}_Ga=t,f=32;AAAA${ESC}\\`)).toBe(0);
    for (const display of [
      DISPLAY,
      `${ESC}_Ga=p,i=42;${ESC}\\`,
      `${ESC}]1337;File=inline=1:AAAA${BEL}`,
      `${ESC}P0;1qAAAA${ESC}\\`,
    ]) {
      expect(imageDisplayCount(display)).toBe(1);
    }
  });

  test('the PNG is large enough for real terminal placement and has valid checksums and pixels', () => {
    const png = toolImagePng();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(64);
    expect(png.readUInt32BE(20)).toBe(64);
    for (let offset = 8; offset < png.length;) {
      const end = offset + 8 + png.readUInt32BE(offset);
      expect(Bun.hash.crc32(png.subarray(offset + 4, end))).toBe(png.readUInt32BE(end));
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
        expect(inflateSync(png.subarray(offset + 8, end))).toHaveLength(64 * (64 * 3 + 1));
      }
      offset = end + 4;
    }
  });

  test.each([...TOOL_IMAGE_ARMS])(
    '%s fixture uses root general settings, a local model and intact cleanup hooks',
    (arm) => {
      const settings = toolImageSettings('http://127.0.0.1:1234', arm);
      expect(settings).not.toHaveProperty('general');
      if (arm === 'inherited') {
        expect(settings).not.toHaveProperty('inlineImages');
      } else {
        expect(settings.inlineImages).toBe(arm === 'on');
      }
      expect(settings.customModels).toMatchObject([
        {
          baseUrl: 'http://127.0.0.1:1234',
          baseModelId: 'claude-haiku-5-5',
          noImageSupport: false,
        },
      ]);
      expect(Object.keys(settings.hooks)).toEqual(['SessionStart', 'SessionEnd']);
    },
  );
});
