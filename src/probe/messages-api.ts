import { homedir } from 'node:os';
import path from 'node:path';

import type { MessagesRequest, Usage } from './anthropic.ts';
import { parseUsage } from './anthropic.ts';
import { fieldsOf, worded } from './fields.ts';

export interface MessagesCall {
  endpoint: string;
  headers: Record<string, string>;
  body: MessagesRequest;
}

export interface MessagesReply {
  usage: Usage;
  headers: Headers;
}

const CLI_PROXY_API_DIR = path.join(homedir(), '.cli-proxy-api');

export async function readAccessToken(): Promise<string> {
  const glob = new Bun.Glob('claude-*.json');
  const found = await Array.fromAsync(glob.scan({ cwd: CLI_PROXY_API_DIR }));
  const first = found.toSorted().at(0);
  if (first === undefined) {
    throw new Error(`no claude-*.json credential file in ${CLI_PROXY_API_DIR}`);
  }
  const file = path.join(CLI_PROXY_API_DIR, first);
  const token = worded(fieldsOf(await Bun.file(file).json()), 'access_token');
  if (token === '') {
    throw new Error(`${file} carries no access_token`);
  }
  return token;
}

async function bodyFields(response: Response) {
  try {
    return fieldsOf(await response.json());
  } catch {
    return new Map<string, unknown>();
  }
}

export async function postMessages(call: MessagesCall): Promise<MessagesReply> {
  const response = await fetch(call.endpoint, {
    method: 'POST',
    headers: call.headers,
    body: JSON.stringify(call.body),
  });

  const fields = await bodyFields(response);
  if (!response.ok) {
    const detail = worded(fieldsOf(fields.get('error')), 'message');
    const why = detail === '' ? '' : `: ${detail}`;
    throw new Error(`${response.status} ${response.statusText}${why}`);
  }

  const usage = parseUsage(fields.get('usage'));
  if (usage === undefined) {
    throw new Error('the response carried no usage object');
  }
  return { usage, headers: response.headers };
}
