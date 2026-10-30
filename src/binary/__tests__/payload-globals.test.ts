import { describe, expect, test } from 'bun:test';

import type { App } from '../graph.ts';
import { assertPayloadNamesBound } from '../payload-globals.ts';

function app(...texts: string[]): App {
  const [head, ...rest] = texts.map((text, index) => ({ name: `/$bunfs/root/m${index}.js`, text }));
  if (head === undefined) {
    throw new Error('the test app needs an entry');
  }
  return [head, ...rest];
}

describe('assertPayloadNamesBound', () => {
  test('accepts a name declared and read in one module', () => {
    expect(() => {
      assertPayloadNamesBound(app('function $ODx(){}$ODx();'));
      assertPayloadNamesBound(app('let $ODy=1;f($ODy);'));
      assertPayloadNamesBound(app('var f=(a,$ODs)=>$ODs.id;'));
    }).not.toThrow();
  });

  test('accepts a bare read of a name another module publishes on globalThis', () => {
    expect(() => {
      assertPayloadNamesBound(app('$ODp();', 'globalThis.$ODp=1'));
      assertPayloadNamesBound(app('$ODq.length', '(globalThis.$ODq??=[]).push(1)'));
    }).not.toThrow();
  });

  test('ignores payload names that are not reads of a variable', () => {
    expect(() => {
      assertPayloadNamesBound(
        app(
          'f(a.$ODr,{$ODcap:1},{get $ODhead(){return 1}},class A{static $ODq(){}},"$ODx");let{$ODrow:W}=d;',
        ),
      );
    }).not.toThrow();
  });

  test('rejects a helper declared in one module and called from another', () => {
    expect(() => {
      assertPayloadNamesBound(app('function $ODupdateWrite(){}', '$ODupdateWrite(1);'));
    }).toThrow(
      'patch code reads $ODupdateWrite in /$bunfs/root/m1.js, but that module never declares it',
    );
  });

  test('rejects a bare read that no module publishes', () => {
    expect(() => {
      assertPayloadNamesBound(app('if($ODmissing)f()'));
    }).toThrow('patch code reads $ODmissing in /$bunfs/root/m0.js');
  });
});
