import { describe, expect, test } from 'bun:test';

import { proxySessionPatches, SESSION_HEADER } from '../proxy-session-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

const STOCK =
  'O=async({customModel:Ee,proxy:Ve,customHeaders:Ne})=>{if(!Ee)return await t.platform.createProxyHeaders(Ve);return{...Ne,"User-Agent":t.platform.userAgent(),...gU({customModel:Ee,sessionId:Ve.sessionId,customHeaders:Ne})}}';

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
type OpenCodeHeaders = (args: {
  customModel: CustomModel;
  sessionId?: string;
  customHeaders?: Headers;
}) => Headers;

const PROXY_HEADERS = { Authorization: 'factory' } satisfies Headers;
const USER_AGENT = 'factory-cli/1.17.0';

function headersBuilder(openCodeHeaders: OpenCodeHeaders = () => ({})): BuildHeaders {
  const { find, replace } = patchNamed(
    proxySessionPatches,
    'anthropic-custom-model-sends-session-id',
  );
  expect(STOCK).toContain(find);
  const source = STOCK.replace(find, () => replace);
  const platform = {
    userAgent: () => USER_AGENT,
    createProxyHeaders: async () => await Promise.resolve(PROXY_HEADERS),
  };
  return payloadFunction<[{ platform: typeof platform }, OpenCodeHeaders], BuildHeaders>(
    ['t', 'gU'],
    `const ${source};return O;`,
  )({ platform }, openCodeHeaders);
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
      'User-Agent': USER_AGENT,
    });
  });

  test('the stock OpenCode helper still receives its inputs and adds its header', async () => {
    const customModel = { provider: 'anthropic', baseUrl: 'https://opencode.ai/zen' };
    const customHeaders = { 'X-Extra': 'kept', 'User-Agent': 'custom' };
    const buildOpenCode = headersBuilder((args) => {
      expect(args).toEqual({ customModel, sessionId: PROXY.sessionId, customHeaders });
      return { 'x-opencode-session': PROXY.sessionId };
    });
    expect(await buildOpenCode({ customModel, proxy: PROXY, customHeaders })).toEqual({
      [SESSION_HEADER]: 'session-1',
      'X-Extra': 'kept',
      'User-Agent': USER_AGENT,
      'x-opencode-session': 'session-1',
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

  test.each(['openai', 'generic-chat-completion-api'])(
    '%s custom models get no session id',
    async (provider) => {
      const headers = await build({ customModel: { provider }, proxy: PROXY });
      expect(Object.keys(headers)).toEqual(['User-Agent']);
    },
  );

  test('a request without a session id gets no header', async () => {
    const headers = await build({ customModel: { provider: 'anthropic' }, proxy: {} });
    expect(Object.keys(headers)).toEqual(['User-Agent']);
  });

  test('Factory-hosted models keep the proxy headers Droid builds', async () => {
    expect(await build({ proxy: PROXY })).toEqual(PROXY_HEADERS);
  });
});
