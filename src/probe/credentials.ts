import { FACTORY_SETTINGS } from '../paths.ts';
import type { RequestHeaders } from './anthropic.ts';
import { apiKeyHeaders, CLAUDE_CODE_SYSTEM, CLAUDE_ENDPOINT, oauthHeaders } from './anthropic.ts';
import { entriesOf, worded } from './fields.ts';
import { readAccessToken } from './messages-api.ts';
import { ANTHROPIC } from './prices.ts';
import { settingsFields } from './settings.ts';

interface DirectCredentials {
  route: 'direct';
  model: string;
  endpoint: string;
  headers: RequestHeaders;
  leadText: string;
}

interface ProxyCredentials {
  route: 'proxy';
  model: string;
  endpoint: string;
  headers: RequestHeaders;
  leadText: undefined;
}

export type Credentials = DirectCredentials | ProxyCredentials;

function endpointOf(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '').replace(/\/v1$/u, '')}/v1/messages`;
}

async function readDirectCredentials(model: string): Promise<DirectCredentials> {
  return {
    route: 'direct',
    model,
    endpoint: CLAUDE_ENDPOINT,
    headers: oauthHeaders(await readAccessToken()),
    leadText: CLAUDE_CODE_SYSTEM,
  };
}

async function readProxyCredentials(droidId: string): Promise<ProxyCredentials> {
  const entries = entriesOf(await settingsFields(), 'customModels');
  const entry = entries.find((fields) => worded(fields, 'id') === droidId);
  if (entry === undefined) {
    throw new Error(`${droidId} is not a customModels entry in ${FACTORY_SETTINGS}`);
  }

  const provider = worded(entry, 'provider');
  if (provider !== ANTHROPIC) {
    throw new Error(`${droidId} is a ${provider} model; this probe speaks the Anthropic API only`);
  }

  const model = worded(entry, 'model');
  const apiKey = worded(entry, 'apiKey');
  if (model === '' || apiKey === '') {
    throw new Error(`${droidId} has no model or apiKey in ${FACTORY_SETTINGS}`);
  }

  return {
    route: 'proxy',
    model,
    endpoint: endpointOf(worded(entry, 'baseUrl')),
    headers: apiKeyHeaders(apiKey),
    leadText: undefined,
  };
}

export async function readCredentials(model: string, direct: boolean): Promise<Credentials> {
  return direct ? await readDirectCredentials(model) : await readProxyCredentials(model);
}
