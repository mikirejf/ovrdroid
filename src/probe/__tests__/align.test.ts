import { describe, expect, test } from 'bun:test';

import {
  alignTokens,
  classHeaderIn,
  describePiece,
  methodIn,
  readPiece,
  translate,
} from '../align.ts';

const FIXTURE =
  'async callTool(t,r){let p=this.servers[t];try{return await p.client.callTool({name:r},fo)}catch(A){if(It(A))this.notify(t);throw A}}';

describe('alignTokens', () => {
  test('a pure rename is the same code', () => {
    const renamed = FIXTURE.replaceAll('fo', 'Rs').replaceAll('It', 'Qo').replaceAll('A', 'N');
    const alignment = alignTokens(FIXTURE, renamed);

    expect(alignment.hunks).toEqual([]);
    expect(alignment.renames.get('Qo')).toBe('It');
  });

  test('an inserted guard is one change, shown in fixture names', () => {
    const bundle =
      'async callTool(i,u){let p=this.servers[i];if(this.shuttingDown)throw Error(i);try{return await p.client.callTool({name:u},Rs)}catch(N){if(Qo(N))this.notify(i);throw N}}';
    const { hunks, renames } = alignTokens(FIXTURE, bundle);

    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.fixture).toBe('');
    expect(hunks[0]?.bundle).toContain('if(this.shuttingDown)throw Error(t)');
    expect(renames.get('Qo')).toBe('It');
  });

  test('two changes far apart are reported apart, with the code between them matched', () => {
    const fixture = 'async run(t){let s=It(t);s.go(t);s.stop(t);return s}';
    const bundle =
      'async run(i){if(this.down)return;let s=Qo(i);s.go(i);s.stop(i);if(this.down)throw i;return s}';
    const { hunks } = alignTokens(fixture, bundle);

    const bundles = hunks.map((hunk) => hunk.bundle);
    expect(bundles).toHaveLength(2);
    expect(bundles[0]).toContain('if(this.down)return');
    expect(bundles[1]).toContain('if(this.down)throw t');
  });

  test('a name the fixture uses for two bindings is a change', () => {
    expect(alignTokens('async run(t,r){t(r)}', 'async run(t,t){t(t)}').hunks).not.toEqual([]);
  });
});

describe('alignTokens around a wrapped call', () => {
  test('the old call keeps its name when other uses show which new name it took', () => {
    const { renames, hunks } = alignTokens(
      'async check(t){let s=It(t);if(It(s))return It(t);return t}',
      'async check(i){let s=ch(Qo(i));if(Qo(s))return Qo(i);return i}',
    );

    expect(renames.get('Qo')).toBe('It');
    expect(renames.has('ch')).toBe(false);
    expect(hunks.map((hunk) => hunk.bundle)).toEqual(['ch(', ')']);
  });

  test('a tie leaves both candidates unmapped rather than guess', () => {
    const { renames } = alignTokens('run(It);stop(It)', 'run(ch);stop(Qo)');

    expect(renames.has('ch')).toBe(false);
    expect(renames.has('Qo')).toBe(false);
  });
});

describe('translate', () => {
  test('lists names nothing mapped, split by whether the fixture already uses them', () => {
    const translation = translate(
      'async check(t){return It(t)}',
      'async check(i){return ch(Qo(i),t)}',
      new Map([
        ['i', 't'],
        ['Qo', 'It'],
      ]),
    );

    expect(translation.text).toBe('async check(t){return ch(It(t),t)}');
    expect(translation.added).toEqual(['ch']);
    expect(translation.reused).toEqual(['t']);
  });
});

describe('methodIn', () => {
  test('cuts one method, past braces inside strings, templates and default arguments', () => {
    const module = `class Ft{async a(t,o={}){let s="}",l=\`\${t}}\`;if(t){return s}}async b(){}}`;

    expect(methodIn(module, 'a')).toBe(`async a(t,o={}){let s="}",l=\`\${t}}\`;if(t){return s}}`);
    expect(methodIn(module, 'missing')).toBeUndefined();
  });
});

describe('classHeaderIn', () => {
  test('cuts from the class keyword through the constructor that precedes the member', () => {
    const module =
      'var x=1;class Ft{servers=G();constructor({logger:s}){this.logger=s}async retryServer(t){}}';

    expect(classHeaderIn(module, 'async retryServer(')).toBe(
      'class Ft{servers=G();constructor({logger:s}){this.logger=s}',
    );
  });
});

describe('describePiece', () => {
  test('a changed piece shows both sides, the new names, and the text to paste', () => {
    const fixture = 'async check(t){let s=It(t);if(It(s))return It(t);return t}';
    const lines = describePiece(
      'check',
      readPiece(fixture, 'async check(i){let s=ch(Qo(i));if(Qo(s))return Qo(i);return i}'),
    );

    expect(lines[0]).toStartWith('check: changed upstream');
    expect(lines.join('\n')).toContain('new names ch:');
    expect(lines.at(-1)).toBe(
      `  ${JSON.stringify('async check(t){let s=ch(It(t));if(It(s))return It(t);return t}')}`,
    );
  });

  test('an unchanged or vanished piece is one line', () => {
    const fixture = 'async check(t){return It(t)}';

    expect(describePiece('check', readPiece(fixture, 'async check(i){return Qo(i)}'))).toEqual([
      'check: same code, names aside',
    ]);
    expect(describePiece('check', readPiece(fixture))).toEqual([
      'check: not in the bundle any more, renamed or removed upstream',
    ]);
  });
});
