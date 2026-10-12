import type { Patch } from './patches.ts';

export const PERSONAL_FOLDER_CHECK =
  'function $ODpersonal($ODfile){let $ODdir=a.dirname($ODfile);return Ite().some(($ODname)=>a.join(a.resolve(L()),$ODname)===$ODdir)}';

const PERSONAL_LOOKUPS = [
  'import*as r from"fs";import*as a from"path"',
  'function Ite(){return[D(),...y]}',
  'm=a.resolve(t??L()),E=zC(),',
];

export const guidelineSymlinkPatches: readonly Patch[] = [
  {
    name: 'guideline-follow-personal-symlink-sync',
    find: 'function F(e,t){try{if(!r.lstatSync(e).isFile())return;let n=r.realpathSync(e);return N(n,t)?n:void 0}catch(n){l(n,"inspect guideline candidate");return}}',
    lookups: PERSONAL_LOOKUPS,
    replace: `${PERSONAL_FOLDER_CHECK}function F(e,t){try{if($ODpersonal(e)){if(!r.statSync(e).isFile())return;return r.realpathSync(e)}if(!r.lstatSync(e).isFile())return;let n=r.realpathSync(e);return N(n,t)?n:void 0}catch(n){l(n,"inspect guideline candidate");return}}`,
  },
  {
    name: 'guideline-follow-personal-symlink-read',
    find: 'async function T(e,t){try{if(!(await r.promises.lstat(t)).isDirectory())return;if(!(await r.promises.lstat(e)).isFile())return;let n=await r.promises.realpath(t),s=await r.promises.realpath(e);return N(s,n)?s:void 0}catch(n){l(n,"canonicalize guideline path");return}}',
    replace:
      'async function T(e,t){try{if(!(await r.promises.lstat(t)).isDirectory())return;let $ODown=$ODpersonal(e);if(!(await r.promises[$ODown?"stat":"lstat"](e)).isFile())return;let n=await r.promises.realpath(t),s=await r.promises.realpath(e);return $ODown||N(s,n)?s:void 0}catch(n){l(n,"canonicalize guideline path");return}}',
  },
];
