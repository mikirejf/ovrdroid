import { describe, expect, test } from 'bun:test';

import type { App, AppModule } from '../../binary/graph.ts';
import { describeSeenHooks, hookModules, hooksIn, hooksSeenBy } from '../hooks.ts';

function chunk(name: string, text: string): AppModule {
  return { name: `/$bunfs/root/${name}`, text };
}

const REACT = chunk(
  'chunk-react.js',
  'var p={H:null};var f=function(t,e){return p.H.useCallback(t,e)},x=function(t,e){return p.H.useEffect(t,e)},_=function(t){return p.H.useState(t)},q=function(t){return p.H.useRef(t)};export{f,x as X,_,q};',
);

const COMMONJS_REACT = chunk(
  'chunk-cjs-react.js',
  'M.useState=function(h){return we.H.useState(h)},M.useRef=function(h){return we.H.useRef(h)};export{M};',
);

const FOOTER = chunk(
  'chunk-footer.js',
  'import{f as g,X,_ as A}from"/$bunfs/root/chunk-react.js";function Ft(){let[s,S]=A(0);X(()=>{},[])}',
);

const app: App = [chunk('entry.js', 'let a=1'), REACT, COMMONJS_REACT, FOOTER];

describe('hooksIn reads each hook off the wrapper that names it', () => {
  test('every exported wrapper is listed under the name it exports, sorted by hook', () => {
    expect(hooksIn(REACT.text)).toEqual([
      { hook: 'useCallback', exported: 'f' },
      { hook: 'useEffect', exported: 'X' },
      { hook: 'useRef', exported: 'q' },
      { hook: 'useState', exported: '_' },
    ]);
  });

  test('a property assignment like M.useState= is not taken for a wrapper', () => {
    expect(hooksIn(COMMONJS_REACT.text)).toEqual([]);
  });

  test('a wrapper the module does not export is left out, since no chunk can import it', () => {
    expect(hooksIn('var f=function(t){return p.H.useRef(t)};')).toEqual([]);
  });
});

describe('hookModules finds the one module other chunks import hooks from', () => {
  test('only the module with exported wrappers is reported', () => {
    expect(hookModules(app).map((found) => found.module)).toEqual(['chunk-react.js']);
  });
});

describe('hooksSeenBy names each hook as an importing chunk spells it', () => {
  const [source] = hookModules(app);
  if (source === undefined) {
    throw new TypeError('the fixture react chunk was not found');
  }

  test('aliased and plain imports both resolve to the local name', () => {
    expect(hooksSeenBy(FOOTER, source)).toEqual([
      { hook: 'useCallback', local: 'g' },
      { hook: 'useEffect', local: 'X' },
      { hook: 'useRef', local: undefined },
      { hook: 'useState', local: 'A' },
    ]);
  });

  test('a hook the chunk does not import is left off the report', () => {
    const report = describeSeenHooks('chunk-footer.js', hooksSeenBy(FOOTER, source)).join('\n');
    expect(report).toContain('useState');
    expect(report).not.toContain('useRef');
  });

  test('a chunk importing no hook says so rather than printing an empty table', () => {
    const plain = chunk('chunk-plain.js', 'let a=1');
    expect(describeSeenHooks('chunk-plain.js', hooksSeenBy(plain, source))).toEqual([
      'chunk-plain.js imports no React hook directly',
    ]);
  });
});
