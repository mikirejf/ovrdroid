import type { Patch } from './patches.ts';

const WORDMARK_ROWS: readonly string[] = [
  ' █████   ██   ██  ███████  ██████    ███████   █████   ██  ██████  ',
  '██   ██  ██   ██  ██   ██  ██    ██  ██   ██  ██   ██  ██  ██    ██',
  '██   ██  ██   ██  ██   ██  ██    ██  ██   ██  ██   ██  ██  ██    ██',
  '██   ██  ██   ██  ███████  ██    ██  ███████  ██   ██  ██  ██    ██',
  '██   ██   █████   ██  ██   ██    ██  ██  ██   ██   ██  ██  ██    ██',
  '██   ██    ███    ██   ██  ██    ██  ██   ██  ██   ██  ██  ██    ██',
  ' █████      █     ██   ██  ██████    ██   ██   █████   ██  ██████  ',
];

const COMPACT_LEAD = '║  ';

const COMPACT_ACCENT = 'O V R';

const COMPACT_MIDDLE = `${COMPACT_LEAD}${COMPACT_ACCENT} D R O I D  ║`;

const COMPACT_RULE = '═'.repeat(COMPACT_MIDDLE.length - 2);

const COMPACT_ROWS: readonly string[] = [`╔${COMPACT_RULE}╗`, COMPACT_MIDDLE, `╚${COMPACT_RULE}╝`];

const COMPACT_ACCENT_ROW = COMPACT_ROWS.indexOf(COMPACT_MIDDLE);

const COMPACT_ACCENT_COLUMN = COMPACT_LEAD.length;

const WORDMARK_WIDTH = 76;

const ACCENT_LETTERS = 3;

function columnsThrough(rows: readonly string[], letters: number): number {
  const filled = (column: number): boolean => rows.some((row) => row[column] === '█');
  let seen = 0;
  let inLetter = false;
  for (let column = 0; column < (rows[0]?.length ?? 0); column += 1) {
    if (filled(column)) {
      if (!inLetter) {
        inLetter = true;
        seen += 1;
      }
    } else if (inLetter) {
      inLetter = false;
      if (seen === letters) {
        return column;
      }
    }
  }
  return rows[0]?.length ?? 0;
}

const OVER_COLUMNS = columnsThrough(WORDMARK_ROWS, ACCENT_LETTERS);

function literal(rows: readonly string[]): string {
  return JSON.stringify(rows);
}

export const logoPatches: readonly Patch[] = [
  {
    name: 'wordmark-ovrdroid',
    find: ',vZ=D.trim().split(`\n`),',
    replace: `,vZ=${literal(WORDMARK_ROWS)},`,
  },
  {
    name: 'wordmark-compact-ovrdroid',
    find: ',xZ=["\\u2554',
    until: '],a="Select Factory Router',
    replace: `,xZ=${literal(COMPACT_ROWS)},a="Select Factory Router`,
  },
  {
    name: 'wordmark-over-accent-paint',
    find: 'nt(f,0,w,g,i);',
    lookups: ['g=!m&&S>=Xe?vZ:xZ', '{color:o.headerLogo,bold:!0}', 'b(f,L,v(I),I,c),L++}'],
    replace:
      `nt(f,0,w,g,i);let $ODstyle={color:o.highlight,bold:!0};` +
      `if(g===vZ)nt(f,0,w,g.map(($ODrow)=>$ODrow.slice(0,${OVER_COLUMNS})),$ODstyle);` +
      `else b(f,${COMPACT_ACCENT_ROW},w+${COMPACT_ACCENT_COLUMN},${JSON.stringify(COMPACT_ACCENT)},$ODstyle);`,
  },
  {
    name: 'wordmark-width-threshold',
    find: 'Xe=58,Ke=24',
    replace: `Xe=${WORDMARK_WIDTH},Ke=24`,
  },
];
