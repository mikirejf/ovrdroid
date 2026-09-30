import { describe, expect, test } from 'bun:test';

import type { Patch } from '../patches.ts';
import { rebaseAll, rebasePatch } from '../rebase.ts';
import { holePattern, tokenize } from '../tokens.ts';

const TEMPLATE = ['`a', '$', '{B}', 'b`'].join('');
const SAMPLE = `let $m=H?FKT.$n:${TEMPLATE};g({key:1},"ARu",A.ARu,Mathx)`;

function holesIn(text: string): string[] {
  return tokenize(text)
    .filter((token) => token.kind === 'ident')
    .map((token) => token.text);
}

describe('tokenize splits code into holes and everything else', () => {
  test('the tokens put back together are the original text', () => {
    expect(
      tokenize(SAMPLE)
        .map((token) => token.text)
        .join(''),
    ).toBe(SAMPLE);
  });

  test('short names, $ names and template interpolations are holes', () => {
    expect(holesIn(SAMPLE)).toEqual(['$m', 'H', 'FKT', 'B', 'g', 'A']);
  });

  test('names longer than a minified name, dotted names and object keys are never holes', () => {
    expect(holesIn('Mathx.max(a,{key:b,ab:c}).ARu+$ODsaved')).toEqual(['a', 'b', 'c']);
  });

  test('keywords as short as a minified name are never holes', () => {
    expect(holesIn('for(let a of b)if(c in d)new Map')).toEqual(['a', 'b', 'c', 'd']);
  });

  test('a spread name is a hole, unlike a name behind a dot', () => {
    expect(holesIn('[...A,...B.c,{...D}]')).toEqual(['A', 'B', 'D']);
  });

  test('a regex literal stays verbatim so its flags and classes are not holes', () => {
    expect(holesIn('B=/^\\p{RGI_Emoji}$/v;H=new Map')).toEqual(['B', 'H']);
  });

  test('a division is not mistaken for the start of a regex literal', () => {
    expect(holesIn('A=B/C')).toEqual(['A', 'B', 'C']);
  });

  test('a string stays verbatim except for the chunk file it names', () => {
    expect(holesIn('import("/$bunfs/root/chunk-v45yswh1.js");"ARu"')).toEqual(['chunk-v45yswh1']);
  });
});

describe('holePattern matches the same shape under any renaming', () => {
  const anchor = holePattern('catch{B(!1);return}setTimeout(()=>B(!1),150)');

  test('every repeated name becomes a backreference', () => {
    expect(anchor.names).toEqual(['B']);
    expect(anchor.source).toContain('\\1');
  });

  test('a consistent renaming matches', () => {
    expect(
      new RegExp(anchor.source, 'u').test('catch{u(!1);return}setTimeout(()=>u(!1),150)'),
    ).toBe(true);
  });

  test('an inconsistent renaming does not match', () => {
    expect(
      new RegExp(anchor.source, 'u').test('catch{u(!1);return}setTimeout(()=>v(!1),150)'),
    ).toBe(false);
  });
});

describe('rebasePatch follows a patch through renamed identifiers', () => {
  const patch: Patch = {
    name: 'whoami',
    find: 'let X=await ARu(A,H);if(X.resolved&&hO)',
    replace: 'let X=ARu(A,H);H("ARu",A.ARu)',
  };
  const result = rebasePatch(patch, ['x;let q=await EMd(z,Y);if(q.resolved&&VE);y']);

  test('the rename map names every moved identifier', () => {
    expect(result.status).toBe('rebased');
    expect(result.renames).toEqual({ X: 'q', ARu: 'EMd', A: 'z', H: 'Y', hO: 'VE' });
  });

  test('the rebased find is the text that actually sits in the new source', () => {
    expect(result.find).toBe('let q=await EMd(z,Y);if(q.resolved&&VE)');
    expect(result.matches).toBe(1);
  });

  test('the replacement is renamed but strings and property names are left alone', () => {
    expect(result.replace).toBe('let q=EMd(z,Y);Y("ARu",z.ARu)');
  });
});

describe('rebasePatch carries the map from find into until and lookups', () => {
  const patch: Patch = {
    name: 'span',
    find: 'var PV,jh;',
    until: 'jh=x0()',
    lookups: ['function Kz(){return PV'],
    replace: 'var $ODspan=Kz(),PV,jh;',
  };
  const result = rebasePatch(patch, ['function Qa(){return E5}var E5,nF;E5=1;nF=QQ();']);

  test('until is anchored with the names find already pinned down', () => {
    expect(result.status).toBe('rebased');
    expect(result.until).toBe('nF=QQ()');
  });

  test('a lookup is anchored with the names find already pinned down', () => {
    expect(result.lookups).toEqual(['function Qa(){return E5']);
  });

  test('only names the replacement uses join the map from a lookup', () => {
    expect(result.renames).toEqual({ PV: 'E5', jh: 'nF', x0: 'QQ', Kz: 'Qa' });
  });

  test('payload-owned names in the replacement survive untouched', () => {
    expect(result.replace).toBe('var $ODspan=Qa(),E5,nF;');
  });

  test('a lookup that disagrees with a pinned name finds nothing', () => {
    const modules = ['function Qa(){return zz}var E5,nF;E5=1;nF=QQ();'];
    expect(rebasePatch(patch, modules).status).toBe('no-lookup');
  });
});

describe('rebasePatch carries chunk file names like identifiers', () => {
  const patch: Patch = {
    name: 'chunk',
    find: 'let{core:c}=await import("/$bunfs/root/chunk-aaaaaaaa.js");',
    replace: 'let{core:c}=await import("/$bunfs/root/chunk-aaaaaaaa.js");c.warm();',
  };

  test('the replacement names the chunk the release actually ships', () => {
    const result = rebasePatch(patch, [
      'let{core:q}=await import("/$bunfs/root/chunk-b1b2b3b4.js");',
    ]);
    expect(result.status).toBe('rebased');
    expect(result.replace).toBe(
      'let{core:q}=await import("/$bunfs/root/chunk-b1b2b3b4.js");q.warm();',
    );
  });
});

describe('rebasePatch says when it cannot decide', () => {
  const patch: Patch = { name: 'pick', find: 'let A=B(1)', replace: 'let A=B(2)' };

  test('two places of the same shape are ambiguous', () => {
    const result = rebasePatch(patch, ['let x=y(1);let p=q(1);']);
    expect(result.status).toBe('ambiguous');
    expect(result.matches).toBe(2);
    expect(result.find).toBe(patch.find);
  });

  test('no place of that shape is missing', () => {
    const result = rebasePatch(patch, ['nothing of that shape here']);
    expect(result.status).toBe('missing');
    expect(result.matches).toBe(0);
  });

  test('a found head whose tail never follows is called out separately', () => {
    const span: Patch = { name: 'span', find: 'let A=B(1)', until: 'C()', replace: 'x' };
    expect(rebasePatch(span, ['let x=y(1);']).status).toBe('no-tail');
  });

  test('a tail that only exists in a later module does not end the span', () => {
    const span: Patch = { name: 'span', find: ',gV=["a', until: '];var Gq=', replace: 'x' };
    const modules = [',xZ=["a","b"],a="Select"', 'x=1];var ot=250;'];
    expect(rebasePatch(span, modules).status).toBe('no-tail');
  });

  test('the same shape in two modules is ambiguous', () => {
    expect(rebasePatch(patch, ['let x=y(1);', 'let p=q(1);']).status).toBe('ambiguous');
  });

  test('a literal still present exactly once is unchanged', () => {
    const result = rebasePatch(patch, ['zz;let A=B(1);zz']);
    expect(result.status).toBe('unchanged');
    expect(result.renames).toEqual({});
  });
});

describe('rebasePatch holds the replacement to account for every name', () => {
  test('a replacement name nothing captures is unresolved', () => {
    const loose: Patch = { name: 'loose', find: 'A(B)', replace: 'A(B)+ZZ(Em)' };
    const result = rebasePatch(loose, ['Em(VE)']);
    expect(result.status).toBe('unresolved');
    expect(result.unresolved).toEqual(['ZZ', 'Em']);
  });

  test('an unresolved name that is now another name of the release is also a collision', () => {
    const loose: Patch = { name: 'loose', find: 'A(B)', replace: 'A(B)+ZZ(Em)' };
    expect(rebasePatch(loose, ['Em(VE)']).collisions).toEqual(['A', 'Em']);
  });

  test('two captured names landing on one release name collide', () => {
    const swap: Patch = { name: 'swap', find: 'f(a,b)', replace: 'f(b,a)' };
    const result = rebasePatch(swap, ['f(x,x)']);
    expect(result.status).toBe('collides');
    expect(result.collisions).toEqual(['b', 'a']);
  });

  test('names outside the find, until and lookups stay free even when they match stock', () => {
    const stock: Patch = { name: 'stock', find: 'A(B)', replace: 'A(B),C()' };
    expect(rebasePatch(stock, ['A(B),C()']).unresolved).toEqual(['C']);
  });
});

describe('rebaseAll guards the payload prefix', () => {
  test('refuses a source that already uses the prefix', () => {
    const patch: Patch = { name: 'pick', find: 'let A=B(1)', replace: 'let A=B(2)' };
    expect(() => rebaseAll([patch], ['let $ODx=1;let A=B(1)'])).toThrow(
      'reserved for patch payload names',
    );
  });
});
