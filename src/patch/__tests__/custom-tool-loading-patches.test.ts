import { describe, expect, test } from 'bun:test';

import { customToolLoadingPatches } from '../custom-tool-loading-patches.ts';
import { payloadFunction } from './payload.ts';

interface Model {
  supportsMidConversationToolChanges?: boolean;
}

interface Turn {
  customModel?: object;
  forcedToolName?: string;
  config?: Model;
  apiProvider?: string;
}

interface Tool {
  name: string;
  defer_loading?: boolean;
  eager_input_streaming?: boolean;
}

interface Sent {
  body: { tools: Tool[]; messages: unknown[] };
  betas: string[];
}

type Send = (turn: Turn) => Sent;

const MID_CONVERSATION_BETA = 'mid-conversation-tool-changes-2026-07-01';

const STOCK_SEND =
  'function send({customModel:X,forcedToolName:he,config:We,apiProvider:o}){' +
  'let wn=!X&&he===void 0&&_t&&We?.supportsMidConversationToolChanges?uF({catalogTools:_t.tools,messages:tr}):void 0;' +
  'let gr=wn!==void 0&&_Pe(o,We),ht=yt!==void 0&&We?.supportsMidConversationEffortChanges===!0&&o==="anthropic",' +
  'An=gr?wn.tools:Lt,Zo=gr?wn.messages:tr,Rt=!X&&An.length>0,Co=Rt&&o==="anthropic",' +
  'ct={tools:Lt,messages:tr},it={...ct,...!X?{tools:Co?bR(An):An,messages:Zo}:{}};' +
  `return{body:it,betas:gr?["${MID_CONVERSATION_BETA}"]:[]}}`;

const BINDINGS = `
const Lt=[{name:"Read"},{name:"ListAutomationTemplates"}];
const tr=[{role:"user",content:"load it"}];
const yt=void 0;
const _t={tools:[{name:"Read"},{name:"ListAutomationTemplates"}]};
const uF=({catalogTools,messages})=>({
  tools:catalogTools.map((tool)=>tool.name==="Read"?tool:{...tool,defer_loading:!0}),
  messages:[...messages,{role:"user",content:[{type:"tool_reference",tool_name:"ListAutomationTemplates"}]}],
});
const _Pe=(provider,model)=>model?.supportsMidConversationToolChanges===!0&&["anthropic","bedrock_anthropic","azure_anthropic","openai","azure_openai","bedrock_openai"].includes(provider);
const bR=(tools)=>tools.map((tool)=>({...tool,eager_input_streaming:!0}));
`;

function buildSend(source: string): Send {
  return payloadFunction<[], Send>([], `${BINDINGS}${source};return send`)();
}

function patchedSource(): string {
  let source = STOCK_SEND;
  for (const patch of customToolLoadingPatches) {
    expect(source.split(patch.find).length).toBe(2);
    source = source.replace(patch.find, patch.replace);
  }
  return source;
}

const stock = buildSend(STOCK_SEND);
const patched = buildSend(patchedSource());

const CUSTOM = { model: 'claude-haiku-5-5', baseUrl: 'http://localhost:8317' };
const SUPPORTING: Model = { supportsMidConversationToolChanges: true };

describe('a custom Claude model whose registry entry supports mid-conversation tool changes', () => {
  test('stock sends the loaded tool in the tools array, which rewrites the cached prefix', () => {
    const sent = stock({ customModel: CUSTOM, config: SUPPORTING });
    expect(sent.body.tools).toEqual([{ name: 'Read' }, { name: 'ListAutomationTemplates' }]);
    expect(sent.betas).toEqual([]);
  });

  test('patched marks it deferred and loads it by reference in the messages', () => {
    const sent = patched({ customModel: CUSTOM, config: SUPPORTING });
    expect(sent.body.tools).toEqual([
      { name: 'Read' },
      { name: 'ListAutomationTemplates', defer_loading: true },
    ]);
    expect(sent.body.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_reference', tool_name: 'ListAutomationTemplates' }],
    });
  });

  test('patched sends the beta header the deferred tools need', () => {
    expect(patched({ customModel: CUSTOM, config: SUPPORTING }).betas).toEqual([
      MID_CONVERSATION_BETA,
    ]);
  });

  test('patched leaves the tools without the fine-grained streaming flag, as stock sends custom models', () => {
    const sent = patched({ customModel: CUSTOM, config: SUPPORTING });
    expect(sent.body.tools.some((tool) => tool.eager_input_streaming !== undefined)).toBe(false);
  });
});

describe('everything else is sent as before', () => {
  test.each<[string, Turn]>([
    ['a custom model without registry support', { customModel: CUSTOM, config: {} }],
    ['a custom model with no registry entry', { customModel: CUSTOM }],
    ['a forced tool call', { customModel: CUSTOM, config: SUPPORTING, forcedToolName: 'Read' }],
    ['a Factory model on Anthropic', { config: SUPPORTING, apiProvider: 'anthropic' }],
    ['a Factory model on Bedrock', { config: SUPPORTING, apiProvider: 'bedrock_anthropic' }],
    ['a Factory model without support', { config: {}, apiProvider: 'anthropic' }],
  ])('%s', (_, turn) => {
    expect(patched(turn)).toEqual(stock(turn));
  });
});
