import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

import { race } from './launch.ts';
import { ENTER, openSession, SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import { streamEvents, stubSettings, TITLE_MARKER, toolEvents } from './stub-model.ts';
import type { ToolCall } from './stub-model.ts';
import { TOOL_IMAGE_ARMS, TOOL_IMAGE_CALLS, toolImageScript } from './tool-images-report.ts';
import type { ToolImageArm, ToolImagesEvidence } from './tool-images-report.ts';

const ESC = String.fromCodePoint(0x1b);
const PROBE_REPLIES: readonly (readonly [string, string])[] = [
  [`${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\`, `${ESC}_Gi=31;OK${ESC}\\`],
  [`${ESC}_Ga=q,i=32,e=T,U=1${ESC}\\`, `${ESC}_Gi=32,U=1;OK${ESC}\\`],
  [`${ESC}[16t`, `${ESC}[6;16;8t`],
  [`${ESC}[>0q`, `${ESC}P>|kitty(0.40.0)${ESC}\\`],
];
const TIMEOUT_MS = 30_000;
const PASTE_MS = 300;
const QUIET_MS = 1500;
const IMAGE_SIZE = 64;

function pngChunk(name: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(name, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

export function toolImagePng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(IMAGE_SIZE);
  header.writeUInt32BE(IMAGE_SIZE, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = IMAGE_SIZE * 3 + 1;
  const pixels = Buffer.alloc(IMAGE_SIZE * stride);
  for (let row = 0; row < IMAGE_SIZE; row++) {
    for (let col = 0; col < IMAGE_SIZE; col++) {
      const offset = row * stride + col * 3 + 1;
      pixels[offset] = row < col ? 240 : 20;
      pixels[offset + 1] = 80;
      pixels[offset + 2] = row < col ? 20 : 240;
    }
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function imageToolServer(calls: readonly ToolCall[], file: string) {
  const requests: unknown[] = [];
  const replies = calls.map(() => Promise.withResolvers<boolean>());
  let nextResponse = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body = await request.text();
      const title = body.includes(TITLE_MARKER);
      let events = streamEvents(['Stub title']);
      if (!title) {
        requests.push(JSON.parse(body));
        const turn = Math.floor(nextResponse / 2);
        const call = calls[turn];
        if (nextResponse % 2 === 0 && call !== undefined) {
          events = toolEvents(call);
        } else {
          events = streamEvents([`[Screenshot](<${file}>)`]);
          replies[turn]?.resolve(true);
        }
        nextResponse += 1;
      }
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    replies: replies.map(async (reply) => await reply.promise),
    stop: async () => {
      await server.stop(true);
    },
  };
}

export function toolImageSettings(url: string, arm: ToolImageArm) {
  const defaults = stubSettings(url, 'claude-haiku-5-5-tool-images');
  return {
    ...defaults,
    customModels: defaults.customModels.map((model) =>
      Object.assign(model, { baseModelId: 'claude-haiku-5-5', noImageSupport: false }),
    ),
    toolResultDisplay: 'stacked',
    ...(arm !== 'inherited' && { inlineImages: arm === 'on' }),
  };
}

async function captureArm(binary: string, arm: ToolImageArm): Promise<ToolImagesEvidence> {
  const dir = realpathSync(mkdtempSync('/tmp/ovrdroid-tool-images-'));
  const file = path.join(dir, 'shot one#2.png');
  writeFileSync(file, toolImagePng());
  const token = randomUUID();
  const callIds = { Read: `toolu_read_${token}`, Script: `toolu_script_${token}` };
  let output = '';
  const toolOutput = { Read: '', Script: '' };
  const server = imageToolServer(
    [
      { name: 'Read', id: callIds.Read, input: { file_path: file } },
      {
        name: 'Script',
        id: callIds.Script,
        input: { script: toolImageScript(file) },
      },
    ],
    file,
  );
  const settingsFile = path.join(dir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify(toolImageSettings(server.url, arm)));
  const flagsFile = path.join(dir, 'feature-flags.json');
  writeFileSync(flagsFile, JSON.stringify({ flags: { cli_inline_images: true }, configs: {} }));
  try {
    const session = await openSession(binary, {
      cwd: dir,
      env: {
        FACTORY_RUNTIME_SETTINGS_PATH: settingsFile,
        FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: flagsFile,
        FACTORY_DISABLE_SETTINGS_PERSISTENCE: 'true',
        FORCE_COLOR: '3',
        TMUX: '',
        ZELLIJ: '',
        STY: '',
      },
      probeReplies: PROBE_REPLIES,
      screen: true,
      collect: false,
      onData: (text) => {
        output += text;
      },
    });
    try {
      await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
      if (!session.screen().join('\n').includes('Stub Stream')) {
        throw new Error(`${arm}: local stub model is not visible; refusing to submit a prompt`);
      }
      output = '';
      for (const [index, name] of TOOL_IMAGE_CALLS.entries()) {
        const reply = server.replies[index];
        if (reply === undefined) {
          throw new Error(`no stub reply planned for ${name}`);
        }
        const boundary = output.length;
        session.paste(`Inspect the screenshot with ${name}, then give its file link.`);
        // oxlint-disable-next-line no-await-in-loop
        await Bun.sleep(PASTE_MS);
        session.press(ENTER);
        // oxlint-disable-next-line no-await-in-loop
        await race(reply, TIMEOUT_MS, `${arm}: Droid did not finish the local ${name} image turn`);
        // oxlint-disable-next-line no-await-in-loop
        await session.quiet(QUIET_MS, TIMEOUT_MS);
        toolOutput[name] = output.slice(boundary);
      }
      return {
        arm,
        requests: server.requests,
        toolOutput,
        output,
        fileUrl: pathToFileURL(file).href,
      };
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function captureToolImages(binary: string): Promise<ToolImagesEvidence[]> {
  const evidence: ToolImagesEvidence[] = [];
  for (const arm of TOOL_IMAGE_ARMS) {
    // oxlint-disable-next-line no-await-in-loop
    evidence.push(await captureArm(path.resolve(binary), arm));
  }
  return evidence;
}
