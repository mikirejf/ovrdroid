import { describe, expect, test } from 'bun:test';

import { resumeCachePatches } from '../resume-cache-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface ToolResultBlock {
  type: string;
  tool_use_id: string;
  is_error?: boolean;
}

type Convert = (stored: { isError?: boolean }) => ToolResultBlock;

const OMIT_FALSE = patchNamed(resumeCachePatches, 'tool-result-omit-false-is-error');

function converterWith(statement: string): Convert {
  return payloadFunction<[], Convert>(
    [],
    `const sq=(t)=>t;return(s)=>{let r={type:"tool_result",tool_use_id:sq("toolu_1")||${statement}return r}`,
  )();
}

const stock = converterWith(OMIT_FALSE.find);
const patched = converterWith(OMIT_FALSE.replace);

describe('tool-result-omit-false-is-error', () => {
  test('stock sends is_error false for a stored success, which a live request never carries', () => {
    expect(stock({ isError: false })).toHaveProperty('is_error', false);
    expect(stock({})).not.toHaveProperty('is_error');
  });

  test('a stored success matches the live request without the key', () => {
    expect(patched({ isError: false })).toEqual(patched({}));
    expect(Object.keys(patched({ isError: false }))).toEqual(['type', 'tool_use_id']);
  });

  test('an error still sends is_error true', () => {
    expect(patched({ isError: true })).toHaveProperty('is_error', true);
  });
});
