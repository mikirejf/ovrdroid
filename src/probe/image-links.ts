import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ImageLinksEvidence } from './image-links-report.ts';
import { race } from './launch.ts';
import { ENTER, openSession, SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import { streamEvents, stubSettings, TITLE_MARKER } from './stub-model.ts';

export const IMAGE_LINKS_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PASTE_SETTLE_MS = 300;
const QUIET_MS = 1500;
const REPLY_TIMEOUT_MS = 30_000;
const PROMPT = 'Show the screenshot file link.';

function imageReplyServer(file: string) {
  let firstRequest: string | undefined;
  const sent = Promise.withResolvers<boolean>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body = await request.text();
      const title = body.includes(TITLE_MARKER);
      if (!title) {
        firstRequest ??= body;
      }
      const response = new Response(
        streamEvents([title ? 'Stub title' : `[Screenshot](<${file}>)`]).join(''),
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      );
      if (!title) {
        sent.resolve(true);
      }
      return response;
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    request: () => firstRequest,
    sent: sent.promise,
    stop: async () => {
      await server.stop(true);
    },
  };
}

export async function captureImageLinks(binary: string): Promise<ImageLinksEvidence> {
  const dir = realpathSync(mkdtempSync('/tmp/ovrdroid-image-links-'));
  const file = path.join(dir, 'shot one#2.png');
  writeFileSync(file, Buffer.from(IMAGE_LINKS_PNG, 'base64'));
  const server = imageReplyServer(file);
  const settings = path.join(dir, 'settings.json');
  const defaults = stubSettings(server.url);
  for (const model of defaults.customModels) {
    model.noImageSupport = false;
  }
  writeFileSync(settings, JSON.stringify(defaults));
  let output = '';
  try {
    const session = await openSession(path.resolve(binary), {
      cwd: dir,
      env: { FACTORY_RUNTIME_SETTINGS_PATH: settings },
      collect: false,
      onData: (text) => {
        output += text;
      },
    });
    try {
      await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
      session.paste(PROMPT);
      await Bun.sleep(PASTE_SETTLE_MS);
      output = '';
      session.press(ENTER);
      await race(server.sent, REPLY_TIMEOUT_MS, 'Droid never asked the local image-links stub');
      await session.quiet(QUIET_MS, REPLY_TIMEOUT_MS);
      return { request: server.request(), output, fileUrl: pathToFileURL(file).href };
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
