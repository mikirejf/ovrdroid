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

const OPENAI = 'openai';
const ENV_REFERENCE = /\$\{(?<name>[A-Z_a-z]\w*)\}/gu;

export function expandEnv(value: string, env: Record<string, string | undefined>): string {
  return value.replaceAll(ENV_REFERENCE, (_reference, name: string) => {
    const found = env[name];
    if (found === undefined) {
      throw new Error(`${FACTORY_SETTINGS} names \${${name}}, which the environment does not set`);
    }
    return found;
  });
}

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

interface CustomModel {
  model: string;
  apiKey: string;
  baseUrl: string;
}

async function readCustomModel(
  droidId: string,
  provider: string,
  api: string,
): Promise<CustomModel> {
  const entries = entriesOf(await settingsFields(), 'customModels');
  const entry = entries.find((fields) => worded(fields, 'id') === droidId);
  if (entry === undefined) {
    throw new Error(`${droidId} is not a customModels entry in ${FACTORY_SETTINGS}`);
  }

  const found = worded(entry, 'provider');
  if (found !== provider) {
    throw new Error(`${droidId} is a ${found} model; this probe speaks the ${api} API only`);
  }

  const model = worded(entry, 'model');
  const apiKey = worded(entry, 'apiKey');
  if (model === '' || apiKey === '') {
    throw new Error(`${droidId} has no model or apiKey in ${FACTORY_SETTINGS}`);
  }

  return { model, apiKey: expandEnv(apiKey, Bun.env), baseUrl: worded(entry, 'baseUrl') };
}

async function readProxyCredentials(droidId: string): Promise<ProxyCredentials> {
  const { model, apiKey, baseUrl } = await readCustomModel(droidId, ANTHROPIC, 'Anthropic');
  return {
    route: 'proxy',
    model,
    endpoint: endpointOf(baseUrl),
    headers: apiKeyHeaders(apiKey),
    leadText: undefined,
  };
}

export interface ResponsesCredentials {
  model: string;
  endpoint: string;
  headers: RequestHeaders;
}

export async function readResponsesCredentials(droidId: string): Promise<ResponsesCredentials> {
  const { model, apiKey, baseUrl } = await readCustomModel(droidId, OPENAI, 'OpenAI Responses');
  return {
    model,
    endpoint: `${baseUrl.replace(/\/+$/u, '')}/responses`,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  };
}

export async function readCredentials(model: string, direct: boolean): Promise<Credentials> {
  return direct ? await readDirectCredentials(model) : await readProxyCredentials(model);
}
