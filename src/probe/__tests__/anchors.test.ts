import { describe, expect, test } from 'bun:test';

import type { Patch } from '../../patch/patches.ts';
import { holePattern, rebasePatch, tokenize } from '../anchors.ts';

const TEMPLATE = ['`a', '$', '{B}', 'b`'].join('');
const SAMPLE = `let $m=H?FKT.$n:${TEMPLATE};g({key:1},"ARu",A.ARu)`;

describe('tokenize splits code into holes and everything else', () => {
  test('the tokens put back together are the original text', () => {
    expect(
      tokenize(SAMPLE)
        .map((token) => token.text)
        .join(''),
    ).toBe(SAMPLE);
  });

  test('names behind a dot, object keys and $ names are never holes', () => {
    const holes = tokenize(SAMPLE)
      .filter((token) => token.kind === 'ident')
      .map((token) => token.text);
    expect(holes).toEqual(['H', 'FKT', 'g', 'A']);
  });

  test('a spread name is a hole, unlike a name behind a dot', () => {
    const holes = tokenize('[...A,...B.c,{...D}]')
      .filter((token) => token.kind === 'ident')
      .map((token) => token.text);
    expect(holes).toEqual(['A', 'B', 'D']);
  });

  test('a regex literal stays verbatim so its flags and classes are not holes', () => {
    const holes = tokenize('B=/^\\p{RGI_Emoji}$/v;H=new Map')
      .filter((token) => token.kind === 'ident')
      .map((token) => token.text);
    expect(holes).toEqual(['B', 'H']);
  });

  test('a division is not mistaken for the start of a regex literal', () => {
    const holes = tokenize('A=B/C')
      .filter((token) => token.kind === 'ident')
      .map((token) => token.text);
    expect(holes).toEqual(['A', 'B', 'C']);
  });

  test('a string or template literal stays one verbatim chunk', () => {
    const chunks = tokenize(SAMPLE).map((token) => token.text);
    expect(chunks.some((chunk) => chunk.includes(TEMPLATE))).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('"ARu"'))).toBe(true);
  });
});

describe('holePattern matches the same shape under any renaming', () => {
  const anchor = holePattern('catch{B(!1);return}setTimeout(()=>B(!1),150)');
  const pattern = new RegExp(anchor.source, 'gu');

  test('every repeated name becomes a backreference', () => {
    expect(anchor.names).toEqual(['B']);
    expect(anchor.source).toContain('\\1');
  });

  test('a consistent renaming matches', () => {
    expect(pattern.test('catch{u(!1);return}setTimeout(()=>u(!1),150)')).toBe(true);
  });

  test('an inconsistent renaming does not match', () => {
    expect(
      new RegExp(anchor.source, 'gu').test('catch{u(!1);return}setTimeout(()=>v(!1),150)'),
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

describe('rebasePatch carries the map from find into until', () => {
  const patch: Patch = {
    name: 'span',
    find: 'var PV,jht;',
    until: 'jht=x0()',
    replace: 'var $S,PV,jht;',
  };
  const result = rebasePatch(patch, ['var E5,nFi;E5=1;nFi=QQ();']);

  test('until is anchored with the names find already pinned down', () => {
    expect(result.status).toBe('rebased');
    expect(result.until).toBe('nFi=QQ()');
  });

  test('names first seen in until join the rename map', () => {
    expect(result.renames).toEqual({ PV: 'E5', jht: 'nFi', x0: 'QQ' });
  });

  test('$ names in the replacement survive untouched', () => {
    expect(result.replace).toBe('var $S,E5,nFi;');
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

  test('a literal tail that only exists in a later module is not unchanged', () => {
    const span: Patch = { name: 'span', find: ',gV=["a', until: '];var Gq=', replace: 'x' };
    const modules = [',gV=["a","b"],a="Select"', 'x=1];var Gq=250;'];
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

describe('rebasePatch flags the names it could not rename', () => {
  const patch: Patch = { name: 'loose', find: 'A(B)', replace: 'A(B)+ZZ(EMd)' };
  const result = rebasePatch(patch, ['EMd(VE)']);

  test('replacement names absent from find are unresolved', () => {
    expect(result.unresolved).toEqual(['ZZ', 'EMd']);
  });

  test('an unresolved name that is now someone else new name is a collision', () => {
    expect(result.collisions).toEqual(['EMd']);
  });
});
