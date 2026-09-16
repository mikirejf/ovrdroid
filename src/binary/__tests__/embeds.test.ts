import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { messageOf } from '../../cli.ts';
import { withTempDir } from '../../temp.ts';
import type { StagedEmbed } from '../embeds.ts';
import { assertSameEmbeds, preambleFor, stageEmbeds } from '../embeds.ts';
import { build, chunk, entry, ripgrep, sidecars, skill, skillText } from './binary.ts';

function files(...specifiers: string[]): StagedEmbed[] {
  return specifiers.map((specifier) => ({ specifier, kind: 'file' }));
}

describe('preambleFor', () => {
  test('imports every embedded file as a file asset', () => {
    const preamble = preambleFor(files('rg-kc7jt1ak.', 'SKILL.md-9e33f36r.asset'));

    expect(preamble).toContain('import __od0 from "./assets/rg-kc7jt1ak." with { type: "file" };');
    expect(preamble).toContain(
      'import __od1 from "./assets/SKILL.md-9e33f36r.asset" with { type: "file" };',
    );
  });

  test('imports a text module as text so require returns a string', () => {
    const preamble = preambleFor([{ specifier: '1/SKILL.md', kind: 'text' }]);

    expect(preamble).toContain('import __od0 from "./assets/1/SKILL.md" with { type: "text" };');
  });

  test('escapes a name that would otherwise break the import specifier', () => {
    expect(preambleFor(files('od"d.asset'))).toContain('from "./assets/od\\"d.asset"');
  });

  test('keeps every import referenced so minification cannot drop it', () => {
    expect(preambleFor(files('a', 'b', 'c'))).toContain(
      'globalThis.__odAssets=[__od0,__od1,__od2];',
    );
  });

  test('ends with a newline so it cannot fuse with the source that follows', () => {
    expect(preambleFor(files('a'))).toEndWith('\n');
  });

  test('produces only the keep-alive when nothing is embedded', () => {
    expect(preambleFor([])).toBe('\nglobalThis.__odAssets=[];\n');
  });
});

async function staging(stock: Uint8Array): Promise<string> {
  return await withTempDir('embeds-test', async (dir) => {
    try {
      await stageEmbeds(stock, dir);
      return '';
    } catch (error) {
      return messageOf(error);
    }
  });
}

describe('stageEmbeds', () => {
  test('writes every sidecar under assets and returns its unprefixed name', async () => {
    const stock = build([entry, ...sidecars]);

    await withTempDir('embeds-test', async (dir) => {
      const embeds = await stageEmbeds(stock, dir);

      expect(embeds).toEqual(files('rg-kc7jt1ak.', 'SKILL.md-9e33f36r.asset'));
      expect(await Bun.file(path.join(dir, 'assets', 'rg-kc7jt1ak.')).text()).toBe('RIPGREP-BYTES');
      expect(await Bun.file(path.join(dir, 'assets', 'SKILL.md-9e33f36r.asset')).text()).toBe(
        '# a skill',
      );
    });
  });

  test('leaves the app chunks alone because they are code, not sidecars', async () => {
    const stock = build([entry, chunk('chunk-aaaaaaaa.js', 'let b=2;'), ...sidecars]);

    await withTempDir('embeds-test', async (dir) => {
      const embeds = await stageEmbeds(stock, dir);

      expect(embeds).toEqual(files('rg-kc7jt1ak.', 'SKILL.md-9e33f36r.asset'));
      expect(await Bun.file(path.join(dir, 'assets', 'chunk-aaaaaaaa.js')).exists()).toBe(false);
    });
  });

  test('stages a text module hash-stripped under its own directory', async () => {
    const stock = build([entry, ripgrep, skillText]);

    await withTempDir('embeds-test', async (dir) => {
      const embeds = await stageEmbeds(stock, dir);

      expect(embeds[1]).toEqual({ specifier: '1/SKILL.md', kind: 'text' });
      expect(await Bun.file(path.join(dir, 'assets', '1', 'SKILL.md')).text()).toBe(
        '# a text skill',
      );
    });
  });

  test('keeps two text modules sharing a stem apart', async () => {
    const twin = { ...skillText, name: '/$bunfs/root/SKILL-aaaaaaaa.md', source: '# other' };
    const stock = build([entry, skillText, twin]);

    await withTempDir('embeds-test', async (dir) => {
      const embeds = await stageEmbeds(stock, dir);

      expect(embeds.map((embed) => embed.specifier)).toEqual(['0/SKILL.md', '1/SKILL.md']);
    });
  });

  test('rejects an embedded file whose loader it does not know', async () => {
    const stock = build([entry, { ...ripgrep, loader: 7 }]);

    expect(await staging(stock)).toBe(
      'embedded file /$bunfs/root/rg-kc7jt1ak. uses unknown loader 7',
    );
  });

  test('rejects a text module whose encoding it does not know', async () => {
    const stock = build([entry, { ...skillText, encoding: 0 }]);

    expect(await staging(stock)).toBe(
      'embedded file /$bunfs/root/SKILL-byzgh4q6.md carries unknown text encoding 0',
    );
  });

  test('rejects a binary whose sidecars share a stored name', async () => {
    const stock = build([entry, ripgrep, { ...ripgrep, source: 'OTHER' }]);

    expect(await staging(stock)).toBe(
      'two embedded files share the name /$bunfs/root/rg-kc7jt1ak.',
    );
  });

  test('rejects two distinct names that would stage to the same asset', async () => {
    const bare = { name: 'rg-kc7jt1ak.', source: 'OTHER' };
    const stock = build([entry, ripgrep, bare]);

    expect(await staging(stock)).toBe('two embedded files stage to the same asset: rg-kc7jt1ak.');
  });
});

describe('assertSameEmbeds', () => {
  const stock = build([entry, ...sidecars]);
  const check = (rebuilt: Uint8Array) => {
    assertSameEmbeds(stock, rebuilt);
  };

  test('accepts a rebuild carrying the same embedded files', () => {
    expect(() => {
      check(build([{ ...entry, source: 'let a=2;' }, ...sidecars]));
    }).not.toThrow();
  });

  test('accepts a rebuild whose chunk set changed entirely', () => {
    const split = build([entry, chunk('chunk-aaaaaaaa.js', 'let b=2;'), ...sidecars]);

    expect(() => {
      assertSameEmbeds(split, build([entry, chunk('entry-99999999.js', 'let z=9;'), ...sidecars]));
    }).not.toThrow();
  });

  test('accepts a rebuild whose entry point was renamed', () => {
    expect(() => {
      check(build([{ ...entry, name: '/$bunfs/root/entry.js' }, ...sidecars]));
    }).not.toThrow();
  });

  test('accepts a name that never carried the bunfs prefix', () => {
    const bare = { name: 'bare.asset', source: 'B' };
    expect(() => {
      assertSameEmbeds(build([entry, bare]), build([entry, bare]));
    }).not.toThrow();
  });

  test('accepts a stock binary with no sidecars at all', () => {
    expect(() => {
      assertSameEmbeds(build([entry]), build([entry]));
    }).not.toThrow();
  });

  test('rejects a rebuild that dropped the bunfs prefix the app addresses it by', () => {
    expect(() => {
      check(build([entry, { ...ripgrep, name: 'rg-kc7jt1ak.' }, skill]));
    }).toThrow('missing embedded files: /$bunfs/root/rg-kc7jt1ak.');
  });

  test('names an embedded file the rebuild dropped', () => {
    expect(() => {
      check(build([entry, ripgrep]));
    }).toThrow('missing embedded files: /$bunfs/root/SKILL.md-9e33f36r.asset');
  });

  test('names an embedded file the rebuild added', () => {
    expect(() => {
      check(build([entry, ...sidecars, { name: '/$bunfs/root/stray.asset', source: '?' }]));
    }).toThrow('unexpected embedded files: /$bunfs/root/stray.asset');
  });

  test('reports a missing file before an unexpected one', () => {
    expect(() => {
      check(build([entry, ripgrep, { name: '/$bunfs/root/stray.asset', source: '?' }]));
    }).toThrow('missing embedded files: /$bunfs/root/SKILL.md-9e33f36r.asset');
  });

  test('names an embedded file whose bytes changed, even at the same size', () => {
    expect(() => {
      check(build([entry, { ...ripgrep, source: 'RIPGREP-BYTEZ' }, skill]));
    }).toThrow('embedded files changed content: /$bunfs/root/rg-kc7jt1ak.');
  });

  test('names an embedded file whose size changed', () => {
    expect(() => {
      check(build([entry, { ...ripgrep, source: 'SHORT' }, skill]));
    }).toThrow('embedded files changed content: /$bunfs/root/rg-kc7jt1ak.');
  });

  test('names an embedded file the rebuild re-embedded under another loader', () => {
    const textStock = build([entry, skillText]);

    expect(() => {
      assertSameEmbeds(textStock, build([entry, { ...skillText, loader: 5 }]));
    }).toThrow('embedded files changed loader: /$bunfs/root/SKILL-byzgh4q6.md');
  });

  test('names an embedded file the rebuild re-embedded under another encoding', () => {
    const textStock = build([entry, skillText]);

    expect(() => {
      assertSameEmbeds(textStock, build([entry, { ...skillText, encoding: 2 }]));
    }).toThrow('embedded files changed text encoding: /$bunfs/root/SKILL-byzgh4q6.md');
  });

  test('rejects a rebuild whose sidecars share a name', () => {
    expect(() => {
      check(build([entry, ripgrep, skill, { ...skill, source: 'dupe' }]));
    }).toThrow('two embedded files share the name /$bunfs/root/SKILL.md-9e33f36r.asset');
  });
});
