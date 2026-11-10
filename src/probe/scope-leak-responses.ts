import { pieces, stubSettings } from './stub-model.ts';
import type { ToolCall } from './stub-model.ts';

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
interface StreamEvent {
  readonly type: string;
  readonly [field: string]: Json;
}
function event(data: StreamEvent): string {
  return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
}
export const RESPONSES_MODEL = 'stub-responses';
export interface ResponsesRequest {
  child: number;
  path: string;
  requestedAtMs: number;
  firstWriteMs: number;
  endedMs: number;
}
export function responsesReleaseDelay(endedMs: number, now: number): number {
  return endedMs === 0 ? Infinity : Math.max(0, endedMs + 3000 - now);
}
export function responsesSettings(url: string) {
  const settings = stubSettings(url, RESPONSES_MODEL);
  return {
    ...settings,
    customModels: settings.customModels.map((model) =>
      Object.assign(model, {
        displayName: 'Stub Responses',
        provider: 'openai',
        baseUrl: `${url}/v1`,
      }),
    ),
  };
}
export function responsesEvents(
  id: string,
  reply: (ToolCall & { customInput?: string }) | readonly string[],
): string[] {
  const deltas = 'name' in reply ? [] : reply;
  const call = 'name' in reply ? reply : undefined;
  const itemId = `${call === undefined ? 'msg' : 'fc'}_${id}`;
  const custom = call?.customInput !== undefined;
  const args = call?.customInput ?? JSON.stringify(call?.input ?? {});
  const inputField = custom ? 'input' : 'arguments';
  const item: Json =
    call === undefined
      ? {
          id: itemId,
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        }
      : {
          id: itemId,
          type: custom ? 'custom_tool_call' : 'function_call',
          call_id: call.id ?? `call_${id}`,
          name: call.name,
          [inputField]: '',
          status: 'in_progress',
        };
  const text = deltas.join('');
  const part = { type: 'output_text', text, annotations: [] };
  const done: Json =
    call === undefined
      ? { ...item, status: 'completed', content: [part] }
      : { ...item, status: 'completed', [inputField]: args };
  const response = {
    id: `resp_${id}`,
    object: 'response',
    created_at: 1,
    model: RESPONSES_MODEL,
    status: 'in_progress',
    output: [],
    error: null,
    incomplete_details: null,
  };
  const at = (type: string, detail: Record<string, Json>): StreamEvent => ({
    type: `response.${type}`,
    item_id: itemId,
    output_index: 0,
    ...detail,
  });
  const events: StreamEvent[] = [
    { type: 'response.created', response },
    { type: 'response.in_progress', response },
    at('output_item.added', { item }),
  ];
  if (call === undefined) {
    events.push(
      at('content_part.added', { content_index: 0, part: { ...part, text: '' } }),
      ...deltas.map((delta) => at('output_text.delta', { content_index: 0, delta })),
      at('output_text.done', { content_index: 0, text }),
      at('content_part.done', { content_index: 0, part }),
    );
  } else {
    events.push(
      ...pieces(args, Math.ceil(args.length / 3)).map((delta) =>
        at(custom ? 'custom_tool_call_input.delta' : 'function_call_arguments.delta', { delta }),
      ),
      at(custom ? 'custom_tool_call_input.done' : 'function_call_arguments.done', {
        [inputField]: args,
      }),
    );
  }
  events.push(
    { type: 'response.output_item.done', output_index: 0, item: done },
    {
      type: 'response.completed',
      response: {
        ...response,
        status: 'completed',
        output: [done],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  );
  return events.map((data, sequence_number) => event({ ...data, sequence_number }));
}
