import { describe, expect, test } from 'bun:test';

import type { AppModule } from '../../binary/graph.ts';
import { checkReadable } from '../readable-check.ts';
import { describeProblems, describeReadable, makeReadable } from '../readable.ts';

function source(name: string, text: string): AppModule {
  return { name, text };
}

const ROOT = '/$bunfs/root';

const REACT = source(
  'react.js',
  'var p={H:null};var g=function(t){return p.H.useState(t)},m=function(t,e){return p.H.useMemo(t,e)};export{g,m as M};',
);

const RUNTIME = source(
  'jsx.js',
  'var E=Symbol.for("react.transitional.element");function J(e,t,n){var r=null;if(n!==void 0&&(r=""+n),"key" in t){n={};for(var o in t)o!=="key"&&(n[o]=t[o])}else n=t;return{$$typeof:E,type:e,key:r,ref:void 0,props:n}}var F=Symbol.for("react.fragment");export{J as q,J as r,F as Fr};',
);

function codeOf(modules: readonly AppModule[], name: string): string {
  const code = makeReadable(modules).modules.get(name);
  if (code === undefined) {
    throw new Error(`no output named ${name}`);
  }
  return code;
}

describe('hooks imported under short names get their React names back', () => {
  const consumer = source(
    'app.js',
    `import{g as A,M as B}from"${ROOT}/react.js";function F(a){let[b,c]=A(0);let d=B(()=>b,[b]);return[b,c,d,a]}export{F};`,
  );

  test('the wrapper imports become useState and useMemo, at every use', () => {
    const code = codeOf([REACT, consumer], 'app.jsx');
    expect(code).toContain('import{g as useState,M as useMemo}from"./react.jsx"');
    expect(code).toContain('useState(0)');
    expect(code).toContain('useMemo(()=>b,[b])');
  });

  test('an inner binding that shares the hook short name is left alone', () => {
    const shadowing = source(
      'shadow.js',
      `import{g}from"${ROOT}/react.js";function useF(){let[a]=g(0);return a}function G(g){return g+1}export{useF,G};`,
    );
    const result = makeReadable([REACT, shadowing]);
    const code = result.modules.get('shadow.jsx') ?? '';
    expect(code).toContain('function useF(){let[a]=useState(0);return a;}');
    expect(code).toContain('function G(g){return g+1;}');
    expect(result.renames.get('shadow.jsx')).toEqual([
      { from: 'g', to: 'useState', category: 'react-hook' },
    ]);
  });

  test('a shorthand property and an export of the renamed binding keep their meaning', () => {
    const shorthand = source('short.js', `import{g}from"${ROOT}/react.js";let o={g};export{g,o};`);
    const code = codeOf([REACT, shorthand], 'short.jsx');
    expect(code).toContain('let o={g:useState}');
    expect(code).toContain('export{useState as g,o}');
  });
});

describe('jsx runtime calls become JSX', () => {
  const component = source(
    'view.js',
    `import{q as t,r as s}from"${ROOT}/jsx.js";function a(e){return t("b",{children:e.x})}function u(){return t("i",{})}function App(){return t(a,{x:1,children:t(u,{})})}function List(){return s("ul",{children:[t(u,{}),"text"]})}export{App,List};`,
  );

  test('element types, props and children come back, and the components get capital names', () => {
    const code = codeOf([RUNTIME, component], 'view.jsx');
    expect(code).toContain('function A(e){return<b>{e.x}</b>;}');
    expect(code).toContain('function U(){return<i/>;}');
    expect(code).toContain('function App(){return<A x={1}><U/></A>;}');
    expect(code).toContain('<ul><U/>text</ul>');
  });

  test('the runtime imports are named jsx and jsxs', () => {
    const result = makeReadable([RUNTIME, component]);
    expect(
      result.renames.get('view.jsx')?.filter((rename) => rename.category === 'jsx-runtime'),
    ).toEqual([
      { from: 't', to: 'jsx', category: 'jsx-runtime' },
      { from: 's', to: 'jsxs', category: 'jsx-runtime' },
    ]);
    expect(result.jsx).toMatchObject({ calls: 6, converted: 6 });
  });

  test('a call that cannot be written as JSX is kept and counted with its reason', () => {
    const dynamic = source(
      'dyn.js',
      `import{q as t}from"${ROOT}/jsx.js";function f(a){return t(a.b[0],{})}export{f};`,
    );
    const result = makeReadable([RUNTIME, dynamic]);
    expect(result.modules.get('dyn.jsx')).toContain('jsx(a.b[0],{})');
    expect(result.jsx.leftover.get('dynamic type')).toBe(1);
  });
});

describe('names that need a decision', () => {
  test('a displayName names the component it is set on', () => {
    const spinner = source(
      'spin.js',
      `import{q as t}from"${ROOT}/jsx.js";function x(){return t("i",{})}x.displayName="Spinner";export{x as spin};`,
    );
    const result = makeReadable([RUNTIME, spinner]);
    expect(result.modules.get('spin.jsx')).toContain('function Spinner(){return<i/>;}');
    expect(result.modules.get('spin.jsx')).toContain('export{Spinner as spin}');
  });

  test('a custom hook gets use once, and one already named use… is kept', () => {
    const hooks = source(
      'hooks.js',
      `import{g as G}from"${ROOT}/react.js";import{q as t}from"${ROOT}/jsx.js";function Hk(){return G(0)}function Hk2(){return Hk()}function useAlready(){return G(1)}function Comp(){let x=Hk2();let y=useAlready();return t("i",{children:x+y})}export{Comp};`,
    );
    const result = makeReadable([REACT, RUNTIME, hooks]);
    const code = result.modules.get('hooks.jsx') ?? '';
    expect(code).toContain('function useHk(){return useState(0);}');
    expect(code).toContain('function useHk2(){return useHk();}');
    expect(code).toContain('function useAlready(){');
    expect(code).not.toContain('useUseAlready');
    expect(result.restored.get('custom-hook')).toBe(2);
  });

  test('a custom hook whose local starts with an underscore or dollar gets useH', () => {
    const hooks = source(
      'under.js',
      `import{g as G}from"${ROOT}/react.js";function _n(){return G(0)}function $m(){return _n()}export{$m as m};`,
    );
    const code = codeOf([REACT, hooks], 'under.jsx');
    expect(code).toContain('function useH_n(){return useState(0);}');
    expect(code).toContain('function useH$m(){return useH_n();}');
  });

  test('a capitalised name that is already taken gets a numeric suffix', () => {
    const clash = source(
      'clash.js',
      `import{q as t}from"${ROOT}/jsx.js";function eZ(){return t("i",{})}function EZ(){return t(eZ,{})}function App(){return t(EZ,{})}export{App};`,
    );
    const code = codeOf([RUNTIME, clash], 'clash.jsx');
    expect(code).toContain('function EZ_2(){return<i/>;}');
    expect(code).toContain('function EZ(){return<EZ_2/>;}');
  });

  test('a hook name that is already taken gets a numeric suffix', () => {
    const clash = source(
      'hookclash.js',
      `import{g as G}from"${ROOT}/react.js";function gM(){return G(0)}function useGM(){return 1}function App(){return[gM(),useGM()]}export{App};`,
    );
    const code = codeOf([REACT, clash], 'hookclash.jsx');
    expect(code).toContain('function useGM_2(){return useState(0);}');
  });

  test('a component local that starts with an underscore or dollar gets a C prefix', () => {
    const odd = source(
      'odd.js',
      `import{q as t}from"${ROOT}/jsx.js";function _n(){return t("i",{})}function $a(){return t("b",{})}function App(){return t("div",{children:[t(_n,{}),t($a,{})]})}export{App};`,
    );
    const code = codeOf([RUNTIME, odd], 'odd.jsx');
    expect(code).toContain('function C_n(){return<i/>;}');
    expect(code).toContain('function C$a(){return<b/>;}');
    expect(code).toContain('<C_n/>');
    expect(code).toContain('<C$a/>');
  });
});

describe('every component and hook name passes the React Compiler rules', () => {
  const COMPONENT = /^[A-Z]/u;
  const HOOK = /^use[A-Z0-9]/u;
  const hooks = source(
    'hooks.js',
    `import{g as G}from"${ROOT}/react.js";import{q as t}from"${ROOT}/jsx.js";function Hk(){return G(0)}function _h(){return Hk()}function eZ(){return t("i",{})}function EZ(){return t(eZ,{})}function _n(){return t("i",{})}function $a(){return t("b",{})}function x(){return t("u",{})}x.displayName="_Shown";function Comp(){let a=Hk();let b=_h();return t("i",{children:[a,b,t(EZ,{}),t(_n,{}),t($a,{}),t(x,{})]})}export{Comp};`,
  );

  test('the renames of the fixtures match the compiler regexes', () => {
    const result = makeReadable([REACT, RUNTIME, hooks]);
    const renames = [...result.renames.values()].flat();
    const named = renames.filter(
      (rename) =>
        rename.category === 'component' ||
        rename.category === 'custom-hook' ||
        rename.category === 'display-name',
    );
    expect(named.map((rename) => rename.category)).toContain('custom-hook');
    expect(named.map((rename) => rename.category)).toContain('component');
    expect(named.map((rename) => rename.category)).toContain('display-name');
    for (const rename of named) {
      const rule = rename.category === 'custom-hook' ? HOOK : COMPONENT;
      expect(rename.to).toMatch(rule);
    }
  });
});

describe('the self-check compares what a module exposes', () => {
  const original = `import{g}from"${ROOT}/react.js";let a=g(0);export{a as h};console.log(a)`;
  const known = new Set(['react.js']);

  test('an output that only renamed locals passes', () => {
    const output =
      'import{g as useState}from"./react.jsx";let a=useState(0);export{a as h};console.log(a)';
    expect(checkReadable(original, output, known)).toEqual([]);
  });

  test('a changed export, import or global is named', () => {
    const output =
      'import{x}from"./react.jsx";let a=x(0);export{a as other};console.log(a);missing()';
    const problems = checkReadable(original, output, known);
    expect(problems.some((problem) => problem.startsWith('exports differ'))).toBe(true);
    expect(problems.some((problem) => problem.startsWith('imports differ'))).toBe(true);
    expect(problems.some((problem) => problem.startsWith('unresolved globals differ'))).toBe(true);
  });

  test('an output that does not parse as JSX is reported, not thrown', () => {
    expect(checkReadable(original, 'let = <', known)[0]).toContain('does not parse');
  });

  test('every output of the synthetic modules passes it', () => {
    const modules = [
      REACT,
      RUNTIME,
      source(
        'app.js',
        `import{g as A}from"${ROOT}/react.js";import{q as t}from"${ROOT}/jsx.js";function F(){return t("i",{children:A(0)})}export{F};`,
      ),
    ];
    const known2 = new Set(modules.map((module) => module.name));
    const result = makeReadable(modules);
    for (const module of modules) {
      const output = result.modules.get(module.name.replace('.js', '.jsx')) ?? '';
      expect(checkReadable(module.text, output, known2)).toEqual([]);
    }
  });
});

describe('a module that cannot be read', () => {
  test('is reported by name and written out as it was, while the others carry on', () => {
    const broken = source('broken.js', 'let = <<<');
    const result = makeReadable([REACT, broken]);
    expect(result.failures.map((failure) => failure.module)).toEqual(['broken.js']);
    expect(result.failures[0]?.what).toContain('parse');
    expect(result.modules.get('broken.jsx')).toBe('let = <<<');
    expect(result.modules.get('react.jsx')).toContain('p.H.useState');
  });
});

describe('the summary says what happened', () => {
  test('restored names are listed by category and the JSX conversion is counted', () => {
    const result = makeReadable([
      REACT,
      source('app.js', `import{g}from"${ROOT}/react.js";export{g as h};`),
    ]);
    expect(describeReadable(result, '/out').join('\n')).toContain('react-hook');
  });

  test('problems name the module and say how many more are hidden', () => {
    const failures = Array.from({ length: 22 }, (_, index) => ({
      module: `m${index}.js`,
      what: 'broke',
    }));
    const lines = describeProblems(failures, 40);
    expect(lines[0]).toContain('22 problems across 40 modules');
    expect(lines).toContain('  m0.js: broke');
    expect(lines.at(-1)).toBe('  … and 2 more');
  });
});
