import type { Patch } from './patches.ts';

const HOME_VARIABLE = String.raw`"\\$\\{?HOME\\}?"`;

const ROOT_OR_HOME = `if(s==="/"||s==="~"||s==="$HOME")c.push(\`[^;&|]{0,100}\\\\s["']?\${s==="$HOME"?${HOME_VARIABLE}:u}["']?[\\\\/.?*]*["']?([\\\\s;&|)\\\`]+|$)\`);`;

const ABSOLUTE_PATH = `else if(s?.startsWith("/"))c.push(\`[^;&|]{0,100}\\\\s\${u}\${l(s)}\`);`;

const FEEDS_A_SHELL =
  'let g=C0(d.trim()),o=Lc(g,!0);return o!==-1&&ne.has(Tl(g[o]).toLowerCase())&&!le(g.slice(o+1))';

const SHELL_HEREDOC_BODIES_RUN = `let g=C0(S);if(g.length>0)C(g,n,v,i,r)}if(D0.length>0&&b_(x,!1).some((d)=>{${FEEDS_A_SHELL}}))for(let d of D0)C(d,n+1,{...t,hasUnprovenArgs:!0},i,r);return}`;

export const denylistPatches: readonly Patch[] = [
  {
    name: 'denylist-command-word-whole-argument',
    find: 'a=/\\w$/.test(e[0])?"\\\\b":"";',
    replace: 'a=/\\w$/.test(e[0])?"(?=[\\\\s;&|)`]|$)":"";',
  },
  {
    name: 'denylist-quoted-heredoc-body-is-text',
    find: 'i??=Rm(e).map(',
    replace: 'i??=Rm(e,{respectHeredocs:!0}).map(',
  },
  {
    name: 'heredoc-keep-body-lines',
    find: 'if(T||S.quoted){',
    replace: 'if(!T)(S.lines??=[]).push(I);if(T||S.quoted){',
  },
  {
    name: 'heredoc-return-bodies',
    find: 'return{outer:f,bodies:i,complete:E&&!h&&!m}}',
    replace:
      'return{outer:f,bodies:i,complete:E&&!h&&!m,heredocs:r.map((b)=>(b.lines??[]).join(`\n`))}}',
  },
  {
    name: 'heredoc-read-bodies',
    find: 'let{outer:x,bodies:u,complete:E}=re(',
    replace: 'let{outer:x,bodies:u,complete:E,heredocs:D0}=re(',
  },
  {
    name: 'heredoc-fed-to-shell-runs',
    find: 'let g=C0(S);if(g.length>0)C(g,n,v,i,r)}return}',
    replace: SHELL_HEREDOC_BODIES_RUN,
  },
  {
    name: 'denylist-root-home-whole-argument',
    find: `if(s==="/")c.push(\`[^;&|.]{0,100}\${u}\`);else if(s==="~")c.push(\`[^;&|]{0,100}\${u}\`);`,
    replace: ROOT_OR_HOME,
  },
  {
    name: 'denylist-absolute-path-whole-argument',
    find: `else if(s?.startsWith("/"))c.push(\`[^;&|.]{0,100}\${u}\${l(s)}\`);`,
    replace: ABSOLUTE_PATH,
  },
];
