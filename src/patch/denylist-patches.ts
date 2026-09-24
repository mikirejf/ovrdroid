import type { Patch } from './patches.ts';

const HOME_VARIABLE = String.raw`"\\$\\{?HOME\\}?"`;

const ROOT_OR_HOME = `if(s==="/"||s==="~"||s==="$HOME")c.push(\`[^;&|]{0,100}\\\\s["']?\${s==="$HOME"?${HOME_VARIABLE}:u}["']?[\\\\/.?*]*["']?([\\\\s;&|)\\\`]+|$)\`);`;

const ABSOLUTE_PATH = `else if(s?.startsWith("/"))c.push(\`[^;&|]{0,100}\\\\s\${u}\${l(s)}\`);`;

export const denylistPatches: readonly Patch[] = [
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
