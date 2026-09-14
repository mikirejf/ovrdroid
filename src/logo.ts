import type { Patch } from './patches.ts';

const WORDMARK_ROWS: readonly string[] = [
  ' █████   ██   ██  ███████  ███████  ██████    ███████   █████   ██  ██████  ',
  '██   ██  ██   ██  ██       ██   ██  ██    ██  ██   ██  ██   ██  ██  ██    ██',
  '██   ██  ██   ██  ██       ██   ██  ██    ██  ██   ██  ██   ██  ██  ██    ██',
  '██   ██  ██   ██  █████    ███████  ██    ██  ███████  ██   ██  ██  ██    ██',
  '██   ██   █████   ██       ██  ██   ██    ██  ██  ██   ██   ██  ██  ██    ██',
  '██   ██    ███    ██       ██   ██  ██    ██  ██   ██  ██   ██  ██  ██    ██',
  ' █████      █     ███████  ██   ██  ██████    ██   ██   █████   ██  ██████  ',
];

const COMPACT_LEAD = '║  ';

const COMPACT_ACCENT = 'O V E R';

const COMPACT_MIDDLE = `${COMPACT_LEAD}${COMPACT_ACCENT} D R O I D  ║`;

const COMPACT_ROWS: readonly string[] = [
  '╔═════════════════════╗',
  COMPACT_MIDDLE,
  '╚═════════════════════╝',
];

const COMPACT_ACCENT_ROW = COMPACT_ROWS.indexOf(COMPACT_MIDDLE);

const COMPACT_ACCENT_COLUMN = COMPACT_LEAD.length;

const WORDMARK_WIDTH = 76;

const OVER_COLUMNS = 36;

const OVER_STYLE = 'logo-over';

function literal(rows: readonly string[]): string {
  return JSON.stringify(rows);
}

export const logoPatches: readonly Patch[] = [
  {
    name: 'wordmark-overdroid',
    find: 'kRi=`',
    until: '`.trim().split(`\n`),',
    replace: `kRi=${literal(WORDMARK_ROWS)},`,
  },
  {
    name: 'wordmark-compact-overdroid',
    find: 'JRi=[',
    until: '],ZaR=[',
    replace: `JRi=${literal(COMPACT_ROWS)},ZaR=[`,
  },
  {
    name: 'wordmark-over-accent-style',
    find: 'logo:{color:DT.headerLogo,bold:!0,italic:!1},',
    replace: `logo:{color:DT.headerLogo,bold:!0,italic:!1},"${OVER_STYLE}":{color:DT.highlight,bold:!0,italic:!1},`,
  },
  {
    name: 'wordmark-over-accent-paint',
    find: 'njC(K,S,e,O,"logo");',
    replace:
      `njC(K,S,e,O,"logo");` +
      `if(O===kRi)njC(K,S,e,O.map(($)=>$.slice(0,${OVER_COLUMNS})),"${OVER_STYLE}");` +
      `else kV(K,S+${COMPACT_ACCENT_ROW},e+${COMPACT_ACCENT_COLUMN},${JSON.stringify(COMPACT_ACCENT)},"${OVER_STYLE}");`,
  },
  {
    name: 'wordmark-width-threshold',
    find: 'dYC=58,aYC=24',
    replace: `dYC=${WORDMARK_WIDTH},aYC=24`,
  },
];
