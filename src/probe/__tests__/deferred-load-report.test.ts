import { describe, expect, test } from 'bun:test';

import type { JsonObject } from '../bodies.ts';
import type { RecordedRequest } from '../deferred-load-report.ts';
import {
  answerFor,
  cachedView,
  deferredLoadVerdict,
  MID_CONVERSATION_BETA,
  offerOf,
} from '../deferred-load-report.ts';

const TOOL = 'Loaded';
const BETA = `${MID_CONVERSATION_BETA}-2026-07-01`;
const CORE = [{ name: 'ToolSearch' }, { name: 'LS' }];
const PLACEHOLDER = { name: 'DeferredToolPlaceholder', defer_loading: true };
const USER = { role: 'user', content: [{ type: 'text', text: 'go' }] };
const SEARCH = { role: 'assistant', content: [{ type: 'tool_use', id: 's', name: 'ToolSearch' }] };
const LIST = { role: 'assistant', content: [{ type: 'tool_use', id: 'l', name: 'LS' }] };
const LISTED = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'l', content: 'a' }] };

function found(content: JsonObject['content']): JsonObject {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's', content }] };
}

const REFERENCE = found([{ type: 'tool_reference', tool_name: TOOL }]);
const LOADED_TEXT = found(`Loaded 1 tool(s): ${TOOL}`);

function request(
  tools: readonly JsonObject[],
  messages: readonly JsonObject[],
  beta = '',
): RecordedRequest {
  return { body: { tools, system: 'sys', messages }, beta };
}

const DEFERRED = { name: TOOL, defer_loading: true };

const PATCHED = [
  request([...CORE, PLACEHOLDER], [USER], BETA),
  request([...CORE, DEFERRED], [USER, SEARCH, REFERENCE], BETA),
  request([...CORE, DEFERRED], [USER, SEARCH, REFERENCE, LIST, LISTED], BETA),
];

const STOCK = [
  request(CORE, [USER]),
  request([...CORE, { name: TOOL }], [USER, SEARCH, LOADED_TEXT]),
  request([...CORE, { name: TOOL }], [USER, SEARCH, LOADED_TEXT, LIST, LISTED]),
];

function failures(requests: readonly RecordedRequest[]): string[] {
  return deferredLoadVerdict(requests, TOOL)
    .checks.filter((entry) => !entry.pass)
    .map((entry) => entry.text);
}

describe('the stub turn', () => {
  test('loads the tool first, then lists the folder, then replies', () => {
    expect(answerFor({ messages: [USER] }, TOOL, '/w')).toMatchObject({
      name: 'ToolSearch',
      input: { query: `select:${TOOL}` },
    });
    expect(answerFor({ messages: [USER, SEARCH, LOADED_TEXT] }, TOOL, '/w')).toMatchObject({
      name: 'LS',
      input: { directory_path: '/w' },
    });
    expect(answerFor({ messages: [USER, SEARCH, LOADED_TEXT, LIST, LISTED] }, TOOL, '/w')).toBe(
      undefined,
    );
  });
});

describe('how a request offers the tool', () => {
  test('tells a deferred tool from one sent in full or not at all', () => {
    expect(offerOf(PATCHED[1]?.body ?? {}, TOOL)).toBe('deferred');
    expect(offerOf(STOCK[1]?.body ?? {}, TOOL)).toBe('full');
    expect(offerOf(STOCK[0]?.body ?? {}, TOOL)).toBe('none');
  });

  test('leaves deferred tools out of the cached prompt', () => {
    expect(cachedView(PATCHED[1]?.body ?? {})['tools']).toEqual(CORE);
  });
});

describe('the verdict', () => {
  test('passes when the tool swaps in deferred and every request extends the one before', () => {
    const verdict = deferredLoadVerdict(PATCHED, TOOL);
    expect(failures(PATCHED)).toEqual([]);
    expect(verdict.summary).toContain('the prompt cache survives the load');
  });

  test('fails at the tools array when the loaded tool is appended in full', () => {
    const verdict = deferredLoadVerdict(STOCK, TOOL);
    const failed = failures(STOCK);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toStartWith('request 2 changed tools');
    expect(verdict.summary).toBe(
      'Loading Loaded mid-session made request 2 stop extending request 1 at tools, so the load rewrites the prompt cache from there.',
    );
  });

  test('fails when the tool was offered from the first request, since nothing loaded', () => {
    const always = [request([...CORE, { name: TOOL }], [USER]), ...STOCK.slice(1)];
    expect(failures(always)).toEqual([
      `${TOOL} was already among the first request's tools (sent full), so nothing loaded mid-session`,
    ]);
    expect(deferredLoadVerdict(always, TOOL).summary).toContain(
      'says nothing about the prompt cache',
    );
  });

  test('fails when ToolSearch never loaded the tool', () => {
    const never = [
      request(CORE, [USER]),
      request(CORE, [USER, SEARCH, LOADED_TEXT]),
      request(CORE, [USER, SEARCH, LOADED_TEXT, LIST, LISTED]),
    ];
    expect(failures(never)).toEqual([`request 2 does not send ${TOOL} after ToolSearch loaded it`]);
  });

  test('fails when the tool is deferred but the model is never shown a tool_reference', () => {
    const hidden = [
      request([...CORE, PLACEHOLDER], [USER], BETA),
      request([...CORE, DEFERRED], [USER, SEARCH, LOADED_TEXT], BETA),
      request([...CORE, DEFERRED], [USER, SEARCH, LOADED_TEXT, LIST, LISTED], BETA),
    ];
    expect(failures(hidden)).toEqual([
      `request 2 sends ${TOOL} deferred but no tool_reference to it, so the model cannot see it`,
    ]);
  });

  test('fails when a deferred tool goes out without the beta', () => {
    const unflagged = PATCHED.map((entry) => ({ ...entry, beta: '' }));
    expect(failures(unflagged)).toEqual([
      `request 2 sends ${TOOL} deferred without the ${MID_CONVERSATION_BETA} beta (anthropic-beta: none)`,
    ]);
  });

  test('fails when the turn stopped before the reply', () => {
    expect(failures(PATCHED.slice(0, 1))).toEqual([
      'only 1 of 3 requests reached the stub, so the turn never got past the load',
      'no request came after ToolSearch, so the load was never sent',
    ]);
  });

  test('ignores requests that do not offer ToolSearch, such as a title request', () => {
    const titled = [request([], [USER]), ...PATCHED];
    expect(failures(titled)).toEqual([]);
  });
});
