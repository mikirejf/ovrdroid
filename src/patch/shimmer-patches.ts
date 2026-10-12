import type { Patch } from './patches.ts';

export const shimmerPatches: readonly Patch[] = [
  {
    name: 'ink-colorize-shared',
    find: 'function a({color:r,backgroundColor:l,dimColor:f=!1,',
    lookups: ['if(f)H=ck.dim(H);if(H=ls(H,r,"foreground"),'],
    replace:
      'globalThis.$ODcolorize=($ODtext,$ODcolor)=>ls($ODtext,$ODcolor,"foreground");' +
      'function a({color:r,backgroundColor:l,dimColor:f=!1,',
  },
  {
    name: 'shimmer-one-string',
    find: 'function p_({text:f,baseColor:w}){return jZ(f,w).map(({char:C,color:S},A)=>t(a,{color:S,children:C},A))}',
    replace:
      'function p_({text:f,baseColor:w}){let $ODline="";' +
      'for(let{char:$ODchar,color:$ODcolor}of jZ(f,w))$ODline+=globalThis.$ODcolorize($ODchar,$ODcolor);' +
      'return $ODline}',
  },
];
