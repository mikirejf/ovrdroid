import { describe, expect, test } from 'bun:test';

import { proxySessionPatches, SESSION_HEADER } from '../proxy-session-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

const STOCK =
  'D=t.getRetryStrategy(),L=async({customModel:xe,proxy:$e,customHeaders:Fe})=>xe?{...Fe,"User-Agent":t.platform.userAgent()}:await t.platform.createProxyHeaders($e),N';

interface CustomModel {
  provider: string;
}

interface Proxy {
  sessionId?: string;
  assistantMessageId?: string;
}

interface Request {
  customModel?: CustomModel;
  proxy: Proxy;
  customHeaders?: Record<string, string>;
}

type Headers = Record<string, string>;
type BuildHeaders = (request: Request) => Promise<Headers>;

const PROXY_HEADERS = { Authorization: 'factory' } satisfies Headers;

function headersBuilder(): BuildHeaders {
  const { find, replace } = patchNamed(
    proxySessionPatches,
    'anthropic-custom-model-sends-session-id',
  );
  expect(STOCK).toContain(find);
  const source = STOCK.replace(find, () => replace);
  const platform = {
    userAgent: () => 'factory-cli/1.6.0',
    createProxyHeaders: async () => await Promise.resolve(PROXY_HEADERS),
  };
  return payloadFunction<[{ platform: typeof platform }, () => null], BuildHeaders>(
    ['t', 'getRetry'],
    `let ${source.replace('t.getRetryStrategy()', 'getRetry()')};return L;`,
  )({ platform }, () => null);
}

const build = headersBuilder();
const PROXY = { sessionId: 'session-1', assistantMessageId: 'message-1' };

describeStrayNames(proxySessionPatches);

describe('Droid sends its session id to an Anthropic custom model', () => {
  test('an Anthropic custom model gets the session id beside its own headers', async () => {
    expect(
      await build({
        customModel: { provider: 'anthropic' },
        proxy: PROXY,
        customHeaders: { 'X-Extra': 'kept' },
      }),
    ).toEqual({
      [SESSION_HEADER]: 'session-1',
      'X-Extra': 'kept',
      'User-Agent': 'factory-cli/1.6.0',
    });
  });

  test('a session id set in extraHeaders beats the one Droid adds', async () => {
    const headers = await build({
      customModel: { provider: 'anthropic' },
      proxy: PROXY,
      customHeaders: { [SESSION_HEADER]: 'pinned' },
    });
    expect(headers[SESSION_HEADER]).toBe('pinned');
  });

  test('other custom model providers get no session id', async () => {
    for (const provider of ['openai', 'generic-chat-completion-api']) {
      // oxlint-disable-next-line no-await-in-loop
      const headers = await build({ customModel: { provider }, proxy: PROXY });
      expect(Object.keys(headers)).toEqual(['User-Agent']);
    }
  });

  test('a request without a session id gets no header', async () => {
    const headers = await build({ customModel: { provider: 'anthropic' }, proxy: {} });
    expect(Object.keys(headers)).toEqual(['User-Agent']);
  });

  test('Factory-hosted models keep the proxy headers Droid builds', async () => {
    expect(await build({ proxy: PROXY })).toEqual(PROXY_HEADERS);
  });
});
