import type { Patch } from './patches.ts';

const HOME_VARIABLE = String.raw`"\\$\\{?HOME\\}?"`;

const ROOT_OR_HOME = `if(l==="/"||l==="~"||l==="$HOME")c.push(\`[^;&|]{0,100}\\\\s["']?\${l==="$HOME"?${HOME_VARIABLE}:u}["']?[\\\\/.?*]*["']?([\\\\s;&|)\\\`]+|$)\`);`;

const ABSOLUTE_PATH = `else if(l?.startsWith("/"))c.push(\`[^;&|]{0,100}\\\\s\${u}\${r(l)}\`);`;

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
    find: 'return null;let t=Z_(e),o=t.invocations.map(',
    replace: 'return null;let t=Z_(e,{respectHeredocs:!0}),o=t.invocations.map(',
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
