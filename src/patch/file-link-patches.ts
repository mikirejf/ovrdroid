import type { Patch } from './patches.ts';

const SANITIZER_HEAD =
  'function Wd(r){if(typeof r!=="string")return null;let e=p(r).trim();if(!e)return null;';

const FILE_PATH_TO_URL =
  'if(!e.includes("://")&&e[0]!=="#"){' +
  'let $ODpath=require("path").resolve(' +
  '(e.startsWith("~/")?require("os").homedir()+e.slice(1):e).replace(/(:\\d+){1,2}$/,""));' +
  'if(require("fs").existsSync($ODpath))return require("url").pathToFileURL($ODpath).href}';

export const fileLinkPatches: readonly Patch[] = [
  {
    name: 'markdown-file-links',
    find: SANITIZER_HEAD,
    replace: SANITIZER_HEAD + FILE_PATH_TO_URL,
  },
];
