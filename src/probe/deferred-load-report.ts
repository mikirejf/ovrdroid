import type { Json, JsonObject, Pairing } from './bodies.ts';
import { describePairing, isList, isRecord, pairBodies } from './bodies.ts';
import type { ToolCall } from './stub-model.ts';
import type { WarmCheck } from './warm-verdict.ts';

export const DEFERRED_TOOL = 'GenerateDroid';
export const SEARCH_TOOL = 'ToolSearch';
export const LIST_TOOL = 'LS';
export const MID_CONVERSATION_BETA = 'mid-conversation-tool-changes';
const DEFER_FLAG = 'defer_loading';
const TURN_REQUESTS = 3;

export interface RecordedRequest {
  body: JsonObject;
  beta: string;
}

export type Offer = 'none' | 'full' | 'deferred';

export interface DeferredLoadVerdict {
  checks: WarmCheck[];
  summary: string;
}

function listAt(node: JsonObject, key: string): readonly Json[] {
  const value = node[key];
  return isList(value) ? value : [];
}

function blocksOf(body: JsonObject): JsonObject[] {
  return listAt(body, 'messages')
    .filter((message) => isRecord(message))
    .flatMap((message) => listAt(message, 'content'))
    .filter((block) => isRecord(block));
}

function toolResults(body: JsonObject): JsonObject[] {
  return blocksOf(body).filter((block) => block['type'] === 'tool_result');
}

export function answerFor(body: JsonObject, tool: string, cwd: string): ToolCall | undefined {
  const done = toolResults(body).length;
  if (done === 0) {
    return { id: 'toolu_deferred_search', name: SEARCH_TOOL, input: { query: `select:${tool}` } };
  }
  if (done === 1) {
    return { id: 'toolu_deferred_list', name: LIST_TOOL, input: { directory_path: cwd } };
  }
  return undefined;
}

export function offerOf(body: JsonObject, tool: string): Offer {
  const entry = listAt(body, 'tools').find((item) => isRecord(item) && item['name'] === tool);
  if (!isRecord(entry)) {
    return 'none';
  }
  return entry[DEFER_FLAG] === true ? 'deferred' : 'full';
}

function referencesTool(body: JsonObject, tool: string): boolean {
  return toolResults(body)
    .flatMap((result) => listAt(result, 'content'))
    .some(
      (part) => isRecord(part) && part['type'] === 'tool_reference' && part['tool_name'] === tool,
    );
}

// Deferred tools are not part of the cached prefix: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching
export function cachedView(body: JsonObject): JsonObject {
  if (!('tools' in body)) {
    return body;
  }
  const tools = listAt(body, 'tools').filter(
    (item) => !isRecord(item) || item[DEFER_FLAG] !== true,
  );
  return { ...body, tools };
}

function check(pass: boolean, passed: string, failed: string): WarmCheck {
  return { pass, text: pass ? passed : failed };
}

function turnCheck(main: readonly RecordedRequest[]): WarmCheck {
  return check(
    main.length >= TURN_REQUESTS,
    `the stub turn ran: ${main.length} requests offered ${SEARCH_TOOL} (load, ${LIST_TOOL} call, reply)`,
    `only ${main.length} of ${TURN_REQUESTS} requests reached the stub, so the turn never got past the load`,
  );
}

function beforeCheck(first: RecordedRequest | undefined, tool: string): WarmCheck {
  const offer = first === undefined ? 'none' : offerOf(first.body, tool);
  return check(
    first !== undefined && offer === 'none',
    `${tool} was not among the first request's tools, so it is still deferred before ${SEARCH_TOOL}`,
    first === undefined
      ? `no request reached the stub, so nothing was loaded`
      : `${tool} was already among the first request's tools (sent ${offer}), so nothing loaded mid-session`,
  );
}

function loadedCheck(later: readonly RecordedRequest[], tool: string): WarmCheck {
  const missing = later.findIndex((request) => offerOf(request.body, tool) === 'none');
  const offers = [...new Set(later.map((request) => offerOf(request.body, tool)))].join(' and ');
  return check(
    later.length > 0 && missing === -1,
    `${SEARCH_TOOL} loaded ${tool}: every later request sends it (${offers})`,
    later.length === 0
      ? `no request came after ${SEARCH_TOOL}, so the load was never sent`
      : `request ${missing + 2} does not send ${tool} after ${SEARCH_TOOL} loaded it`,
  );
}

function visibleCheck(later: readonly RecordedRequest[], tool: string): WarmCheck {
  const deferred = later
    .map((request, index) => ({ request, number: index + 2 }))
    .filter(({ request }) => offerOf(request.body, tool) === 'deferred');
  if (deferred.length === 0) {
    return check(
      true,
      `${tool} is sent in full, so the model sees it without a tool_reference`,
      '',
    );
  }
  const unseen = deferred.find(({ request }) => !referencesTool(request.body, tool));
  const unflagged = deferred.find(({ request }) => !request.beta.includes(MID_CONVERSATION_BETA));
  let failed = '';
  if (unseen !== undefined) {
    failed = `request ${unseen.number} sends ${tool} deferred but no tool_reference to it, so the model cannot see it`;
  } else if (unflagged !== undefined) {
    failed = `request ${unflagged.number} sends ${tool} deferred without the ${MID_CONVERSATION_BETA} beta (anthropic-beta: ${unflagged.request.beta || 'none'})`;
  }
  return check(
    failed === '',
    `${tool} is sent deferred, with a tool_reference in the messages and the ${MID_CONVERSATION_BETA} beta`,
    failed,
  );
}

function pairingsOf(main: readonly RecordedRequest[]): Pairing[] {
  return pairBodies(
    main.map((request, index) => ({
      t: index,
      sessionId: 'stub',
      assistantMessageId: '',
      route: 'anthropic',
      body: cachedView(request.body),
    })),
  );
}

function extensionCheck(pairing: Pairing): WarmCheck {
  const [head = '', ...detail] = describePairing(pairing);
  const text = [head, ...detail.map((line) => `      ${line.trim()}`)].join('\n');
  return { pass: pairing.divergence === undefined, text };
}

function summaryOf(
  tool: string,
  setup: readonly WarmCheck[],
  pairings: readonly Pairing[],
): string {
  if (setup.some((entry) => !entry.pass)) {
    return `The run did not load ${tool} mid-session the way a model would see it, so it says nothing about the prompt cache.`;
  }
  const broken = pairings.find((pairing) => pairing.divergence !== undefined);
  if (broken !== undefined) {
    return `Loading ${tool} mid-session made ${broken.newName} stop extending ${broken.oldName} at ${broken.divergence?.label ?? 'the prompt'}, so the load rewrites the prompt cache from there.`;
  }
  return `Loading ${tool} mid-session kept every request an extension of the one before it, so the prompt cache survives the load.`;
}

export function deferredLoadVerdict(
  requests: readonly RecordedRequest[],
  tool: string,
): DeferredLoadVerdict {
  const main = requests.filter((request) => offerOf(request.body, SEARCH_TOOL) !== 'none');
  const later = main.slice(1);
  const setup = [
    turnCheck(main),
    beforeCheck(main[0], tool),
    loadedCheck(later, tool),
    visibleCheck(later, tool),
  ];
  const pairings = pairingsOf(main);
  return {
    checks: [...setup, ...pairings.map((pairing) => extensionCheck(pairing))],
    summary: summaryOf(tool, setup, pairings),
  };
}
