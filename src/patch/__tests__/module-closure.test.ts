import { describe, expect, test } from 'bun:test';

import { closureOf, declarationAround } from './module-closure.ts';

const MODULE = [
  'import{x}from"/$bunfs/root/chunk-a.js";',
  'var unused=1,base=2;',
  'var table=new Map;',
  'for(let k of [1,2])table.set(k,base);',
  'function helper(n){return table.get(n)+x}',
  'class Box{get(){return helper(1)}}',
  'function lonely(){return unused}',
  'export{Box};',
].join('');

describe('the closure of a top-level name', () => {
  test('carries every declaration it reaches and the statements that fill them, in order', () => {
    expect(closureOf(MODULE, ['Box'])).toBe(
      [
        'var base=2;',
        'var table=new Map;',
        'for(let k of [1,2])table.set(k,base);',
        'function helper(n){return table.get(n)+x}',
        'class Box{get(){return helper(1)}}',
      ].join(';\n'),
    );
  });

  test('leaves imports to the caller and drops what nothing reaches', () => {
    const closure = closureOf(MODULE, ['Box']);
    expect(closure).not.toContain('import');
    expect(closure).not.toContain('lonely');
    expect(closure).not.toContain('unused');
  });

  test('fails loud on a name the module does not declare', () => {
    expect(() => closureOf(MODULE, ['missing'])).toThrow('missing is not declared');
  });

  test('names the declaration around a position', () => {
    expect(declarationAround(MODULE, MODULE.indexOf('table.get'))).toBe('helper');
  });
});
