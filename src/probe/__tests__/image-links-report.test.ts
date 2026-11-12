import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';

import { IMAGE_LINK_DIRECTIVE, STOCK_IMAGE_DIRECTIVE } from '../../patch/file-link-patches.ts';
import { anyFailed } from '../busy-signal-report.ts';
import type { ImageLinksEvidence } from '../image-links-report.ts';
import { imageLinksVerdicts } from '../image-links-report.ts';
import { IMAGE_LINKS_PNG } from '../image-links.ts';

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const FILE_URL = 'file:///tmp/image-links/shot%20one%232.png';

function link(url = FILE_URL, label = 'Screenshot', end = BEL): string {
  return `${ESC}]8;;${url}${end}${label}${ESC}]8;;${end}`;
}

const PASSING: ImageLinksEvidence = {
  request: JSON.stringify({ system: [{ type: 'text', text: IMAGE_LINK_DIRECTIVE }] }),
  output: link(),
  fileUrl: FILE_URL,
};

function failures(evidence: ImageLinksEvidence): string[] {
  return imageLinksVerdicts(evidence)
    .filter((verdict) => !verdict.pass)
    .map((verdict) => verdict.text);
}

describe('imageLinksVerdicts', () => {
  test('the screenshot fixture is a PNG with intact chunk checksums', () => {
    const png = Buffer.from(IMAGE_LINKS_PNG, 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    for (let offset = 8; offset < png.length;) {
      const end = offset + 8 + png.readUInt32BE(offset);
      expect(Bun.hash.crc32(png.subarray(offset + 4, end))).toBe(png.readUInt32BE(end));
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
        expect(inflateSync(png.subarray(offset + 8, end))).toHaveLength(3);
      }
      offset = end + 4;
    }
  });

  test('the real prompt and encoded OSC8 link pass', () => {
    expect(anyFailed(imageLinksVerdicts(PASSING))).toBe(false);
  });

  test('OSC8 string terminators and styled labels pass', () => {
    expect(
      failures({ ...PASSING, output: link(FILE_URL, `${ESC}[1mScreenshot${ESC}[0m`, `${ESC}\\`) }),
    ).toEqual([]);
  });

  test('the original embedding instruction fails even if the new rule is also present', () => {
    const request = JSON.stringify({ system: IMAGE_LINK_DIRECTIVE + STOCK_IMAGE_DIRECTIVE });
    expect(failures({ ...PASSING, request })).toEqual([
      'the actual system prompt omits the stock image-embedding directive',
    ]);
  });

  test('stock lacks the new rule and retains the old one', () => {
    const request = JSON.stringify({ system: STOCK_IMAGE_DIRECTIVE });
    expect(failures({ ...PASSING, request })).toHaveLength(2);
  });

  test('a user echo of the new rule is not evidence of a system prompt change', () => {
    const request = JSON.stringify({ messages: [{ role: 'user', content: IMAGE_LINK_DIRECTIVE }] });
    expect(failures({ ...PASSING, request })).toContain(
      'the actual system prompt contains the chat-only screenshot and generated-image link rule',
    );
  });

  test('no request fails rather than passing on absence', () => {
    expect(failures({ ...PASSING, request: undefined })).toHaveLength(3);
  });

  test.each([
    '',
    link('file:///tmp/image-links/shot one#2.png'),
    link('https://example.com/shot.png'),
  ])('missing or wrong target %p fails', (output) => {
    expect(failures({ ...PASSING, output })).toHaveLength(2);
  });

  test('the label must be displayed inside the right hyperlink', () => {
    expect(failures({ ...PASSING, output: `Screenshot ${link(FILE_URL, '')}` })).toEqual([
      'the file link displays its Screenshot label',
    ]);
  });

  test.each([
    `${ESC}_Ga=T,f=100;AAAA${ESC}\\`,
    `${ESC}_Gf=100;AAAA${ESC}\\`,
    `${ESC}_Ga=p,i=1;${ESC}\\`,
    `${ESC}]1337;File=inline=1:AAAA${BEL}`,
    `${ESC}]1337;MultipartFile=inline=1${BEL}`,
    `${ESC}P0;1qAAAA${ESC}\\`,
  ])('image display %p fails even with a good link', (image) => {
    expect(failures({ ...PASSING, output: PASSING.output + image })).toEqual([
      'the reply emits no Kitty, iTerm2 or Sixel image display (graphics queries do not count)',
    ]);
  });

  test('graphics capability queries are not image displays', () => {
    const query = `${ESC}_Gi=31,a=q,s=1,v=1;AAAA${ESC}\\${ESC}P$qm${ESC}\\`;
    expect(failures({ ...PASSING, output: PASSING.output + query })).toEqual([]);
  });
});
