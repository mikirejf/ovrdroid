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

const OVER_STYLE = 'logo-over';

function literal(rows: readonly string[]): string {
  return JSON.stringify(rows);
}

export const logoPatches: readonly Patch[] = [
  {
    name: 'wordmark-ovrdroid',
    find: 'T6=`',
    until: '`.trim().split(`\n`),',
    replace: `T6=${literal(WORDMARK_ROWS)},`,
  },
  {
    name: 'wordmark-compact-ovrdroid',
    find: 'R6=[',
    until: '];var i0=',
    replace: `R6=${literal(COMPACT_ROWS)};var i0=`,
  },
  {
    name: 'wordmark-over-accent-style',
    find: 'logo:{color:s.headerLogo,bold:!0,italic:!1},',
    replace: `logo:{color:s.headerLogo,bold:!0,italic:!1},"${OVER_STYLE}":{color:s.highlight,bold:!0,italic:!1},`,
  },
  {
    name: 'wordmark-over-accent-paint',
    find: 'jq(xe,Te,we,le,"logo");',
    replace:
      `jq(xe,Te,we,le,"logo");` +
      `if(le===T6)jq(xe,Te,we,le.map(($)=>$.slice(0,${OVER_COLUMNS})),"${OVER_STYLE}");` +
      `else Gi(xe,Te+${COMPACT_ACCENT_ROW},we+${COMPACT_ACCENT_COLUMN},${JSON.stringify(COMPACT_ACCENT)},"${OVER_STYLE}");`,
  },
  {
    name: 'wordmark-width-threshold',
    find: 'Fq=58,$q=24',
    replace: `Fq=${WORDMARK_WIDTH},$q=24`,
  },
];
