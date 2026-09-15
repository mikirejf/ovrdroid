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
    find: 'kPc=`',
    until: '`.trim().split(`\n`),',
    replace: `kPc=${literal(WORDMARK_ROWS)},`,
  },
  {
    name: 'wordmark-compact-ovrdroid',
    find: 'OPc=[',
    until: '],yzt=[',
    replace: `OPc=${literal(COMPACT_ROWS)},yzt=[`,
  },
  {
    name: 'wordmark-over-accent-style',
    find: 'logo:{color:fe.headerLogo,bold:!0,italic:!1},',
    replace: `logo:{color:fe.headerLogo,bold:!0,italic:!1},"${OVER_STYLE}":{color:fe.highlight,bold:!0,italic:!1},`,
  },
  {
    name: 'wordmark-over-accent-paint',
    find: 'MTm(x,M,F,R,"logo");',
    replace:
      `MTm(x,M,F,R,"logo");` +
      `if(R===kPc)MTm(x,M,F,R.map(($)=>$.slice(0,${OVER_COLUMNS})),"${OVER_STYLE}");` +
      `else Qj(x,M+${COMPACT_ACCENT_ROW},F+${COMPACT_ACCENT_COLUMN},${JSON.stringify(COMPACT_ACCENT)},"${OVER_STYLE}");`,
  },
  {
    name: 'wordmark-width-threshold',
    find: 'ITm=58,wTm=24',
    replace: `ITm=${WORDMARK_WIDTH},wTm=24`,
  },
];
