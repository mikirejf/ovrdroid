import type { Usage } from './anthropic.ts';
import { counted, fieldsOf, worded } from './fields.ts';
import { okFields } from './messages-api.ts';

export interface ResponsesCall {
  endpoint: string;
  headers: Record<string, string>;
  body: object;
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolBlock {
  type: 'tool_use';
  name: string;
}

export type ReplyBlock = TextBlock | ToolBlock;

export interface ResponsesReply {
  usage: Usage;
  content: ReplyBlock[];
  stopReason: string;
}

export function parseResponsesUsage(raw: unknown): Usage | undefined {
  const fields = fieldsOf(raw);
  if (typeof fields.get('input_tokens') !== 'number') {
    return undefined;
  }
  const cacheRead = counted(fieldsOf(fields.get('input_tokens_details')), 'cached_tokens');
  return {
    inputTokens: counted(fields, 'input_tokens') - cacheRead,
    cacheRead,
    cacheWrite: 0,
    write5m: 0,
    write1h: 0,
    outputTokens: counted(fields, 'output_tokens'),
  };
}

function parseBlocks(raw: unknown): ReplyBlock[] {
  const fields = fieldsOf(raw);
  switch (worded(fields, 'type')) {
    case 'message': {
      const content = fields.get('content');
      const parts: unknown[] = Array.isArray(content) ? content : [];
      return parts.flatMap((part): ReplyBlock[] => {
        const partFields = fieldsOf(part);
        return worded(partFields, 'type') === 'output_text'
          ? [{ type: 'text', text: worded(partFields, 'text') }]
          : [];
      });
    }
    case 'function_call': {
      return [{ type: 'tool_use', name: worded(fields, 'name') }];
    }
    default: {
      return [];
    }
  }
}

export function parseResponsesContent(raw: unknown): ReplyBlock[] {
  const items: unknown[] = Array.isArray(raw) ? raw : [];
  return items.flatMap((item) => parseBlocks(item));
}

export async function postResponses(call: ResponsesCall): Promise<ResponsesReply> {
  const response = await fetch(call.endpoint, {
    method: 'POST',
    headers: call.headers,
    body: JSON.stringify(call.body),
  });

  const fields = await okFields(response);
  const usage = parseResponsesUsage(fields.get('usage'));
  if (usage === undefined) {
    throw new Error('the response carried no usage object');
  }
  if (!Array.isArray(fields.get('output'))) {
    throw new TypeError('the response carried no output array');
  }
  return {
    usage,
    content: parseResponsesContent(fields.get('output')),
    stopReason: worded(fields, 'status'),
  };
}
