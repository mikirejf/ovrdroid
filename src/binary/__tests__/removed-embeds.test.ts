import { describe, expect, test } from 'bun:test';

import { embedStem, REMOVED_EMBEDS, removedNames } from '../removed-embeds.ts';

const BROWSER = '/$bunfs/root/agent-browser-t82a9583.';
const SKILL_ASSET = '/$bunfs/root/SKILL.md-9e33f36r.asset';
const OTHER_SKILL_ASSET = '/$bunfs/root/SKILL.md-s8pa9mds.asset';
const SKILL_TEXT = '/$bunfs/root/SKILL-qjh1tn5d.md';
const RIPGREP = '/$bunfs/root/rg-kc7jt1ak.';

describe('embedStem', () => {
  test('drops the content hash and the bunfs prefix', () => {
    expect(embedStem(BROWSER)).toBe('agent-browser.');
    expect(embedStem(SKILL_ASSET)).toBe('SKILL.md.asset');
    expect(embedStem(RIPGREP)).toBe('rg.');
  });

  test('gives every release of a file the same stem whatever its hash', () => {
    expect(embedStem('/$bunfs/root/agent-browser-zzzzzzzz.')).toBe(embedStem(BROWSER));
  });

  test('keeps a text skill apart from a skill asset of the same file name', () => {
    expect(embedStem(SKILL_TEXT)).toBe('SKILL.md');
    expect(embedStem(SKILL_TEXT)).not.toBe(embedStem(SKILL_ASSET));
  });

  test('leaves a name with no hash alone', () => {
    expect(embedStem('bare.asset')).toBe('bare.asset');
    expect(embedStem('/$bunfs/root/entry.js')).toBe('entry.js');
  });
});

describe('removedNames', () => {
  const names = [BROWSER, SKILL_ASSET, OTHER_SKILL_ASSET, SKILL_TEXT, RIPGREP];

  test('names exactly the records whose stem is listed, as many as the list says', () => {
    const dropped = removedNames(names, { 'agent-browser.': 1, 'SKILL.md.asset': 2 });

    expect([...dropped].toSorted()).toEqual([BROWSER, OTHER_SKILL_ASSET, SKILL_ASSET].toSorted());
  });

  test('names nothing when nothing is listed', () => {
    expect(removedNames(names, {}).size).toBe(0);
  });

  test('refuses a binary that carries more records of a stem than the list names', () => {
    expect(() => removedNames(names, { 'SKILL.md.asset': 1 })).toThrow(
      'SKILL.md.asset (list names 1, binary carries 2)',
    );
  });

  test('refuses a binary that carries fewer records of a stem than the list names', () => {
    expect(() => removedNames(names, { 'agent-browser.': 2 })).toThrow(
      'agent-browser. (list names 2, binary carries 1)',
    );
  });

  test('refuses a binary that lacks a listed stem altogether, and names every stem that drifted', () => {
    expect(() => removedNames(names, { 'gone.asset': 1, 'rg.': 3 })).toThrow(
      'gone.asset (list names 1, binary carries 0), rg. (list names 3, binary carries 1)',
    );
  });
});

describe('REMOVED_EMBEDS', () => {
  test('names the bundled agent-browser binary and its 26 skill files', () => {
    expect(Object.values(REMOVED_EMBEDS).reduce((sum, each) => sum + each, 0)).toBe(27);
    expect(REMOVED_EMBEDS['agent-browser.']).toBe(1);
  });

  test('names nothing else than that binary and file assets', () => {
    const others = Object.keys(REMOVED_EMBEDS).filter((stem) => stem !== 'agent-browser.');

    expect(others.every((stem) => stem.endsWith('.asset'))).toBe(true);
  });
});
