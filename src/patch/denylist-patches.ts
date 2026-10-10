import type { Patch } from './patches.ts';

const HOME_VARIABLE = String.raw`"\\$\\{?HOME\\}?"`;

const ROOT_OR_HOME = `if(l==="/"||l==="~"||l==="$HOME")c.push(\`[^;&|]{0,100}\\\\s["']?\${l==="$HOME"?${HOME_VARIABLE}:u}["']?[\\\\/.?*]*["']?([\\\\s;&|)\\\`]+|$)\`);`;

const ABSOLUTE_PATH = `else if(l?.startsWith("/"))c.push(\`[^;&|]{0,100}\\\\s\${u}\${r(l)}\`);`;

const HEREDOCS = '$ODheredocs';

const FEEDS_A_SHELL =
  'let g=OT($ODbody.trim()),$ODat=Yc(g,!0);return $ODat!==-1&&ne.has(_0(g[$ODat]).toLowerCase())&&!le(g.slice($ODat+1))';

const SHELL_HEREDOC_BODIES_RUN = `let g=OT(S);if(g.length>0)C(g,n,v,i,r)}if(${HEREDOCS}.length>0&&E_(x,!1).some(($ODbody)=>{${FEEDS_A_SHELL}}))for(let $ODbody of ${HEREDOCS})C($ODbody,n+1,{...t,hasUnprovenArgs:!0},i,r);return}`;

export const COMMAND_WORD_END = '"(?=[\\\\s;&|)`]|$)"';

const SINGLE_TOKEN_BRANCH = ':"";try{if(e.length===1)';

export const denylistPatches: readonly Patch[] = [
  {
    name: 'denylist-command-word-whole-argument',
    find: `?"\\\\b"${SINGLE_TOKEN_BRANCH}`,
    replace: `?${COMMAND_WORD_END}${SINGLE_TOKEN_BRANCH}`,
  },
  {
    name: 'denylist-quoted-heredoc-body-is-text',
    find: 'i??=Pm(e).map(',
    replace: 'i??=Pm(e,{respectHeredocs:!0}).map(',
  },
  {
    name: 'heredoc-keep-body-lines',
    find: 'if(T||S.quoted){',
    lookups: ['T=(S.stripTabs?I.replace(/^\\t+/,""):I)===S.delimiter;'],
    replace: 'if(!T)(S.lines??=[]).push(I);if(T||S.quoted){',
  },
  {
    name: 'heredoc-return-bodies',
    find: 'return{outer:f,bodies:i,complete:E&&!h&&!m}}',
    lookups: ['S=x?r[s]:void 0;'],
    replace:
      'return{outer:f,bodies:i,complete:E&&!h&&!m,heredocs:r.map(($ODdoc)=>($ODdoc.lines??[]).join(`\n`))}}',
  },
  {
    name: 'heredoc-read-bodies',
    find: 'let{outer:x,bodies:u,complete:E}=re(',
    replace: `let{outer:x,bodies:u,complete:E,heredocs:${HEREDOCS}}=re(`,
  },
  {
    name: 'heredoc-fed-to-shell-runs',
    find: 'let g=OT(S);if(g.length>0)C(g,n,v,i,r)}return}',
    lookups: [
      'for(let d of E_(x,!t.respectHeredocs',
      'function Yc(e,n=!1){return N(e,n).commandWordIndex}',
      'if(!t.runtimeOnly&&ne.has(c.toLowerCase())){let x=le(p);',
      'function _0(e){let n=Uq(e);if(n.includes("/"))',
    ],
    replace: SHELL_HEREDOC_BODIES_RUN,
  },
  {
    name: 'denylist-root-home-whole-argument',
    find: `if(l==="/")c.push(\`[^;&|.]{0,100}\${u}\`);else if(l==="~")c.push(\`[^;&|]{0,100}\${u}\`);`,
    replace: ROOT_OR_HOME,
  },
  {
    name: 'denylist-absolute-path-whole-argument',
    find: `else if(l?.startsWith("/"))c.push(\`[^;&|.]{0,100}\${u}\${r(l)}\`);`,
    replace: ABSOLUTE_PATH,
  },
];
