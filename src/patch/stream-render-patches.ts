import type { Patch } from './patches.ts';

export const MARKDOWN_MEMO_ENTRIES = 4;

export const BLANK_CELL = '{type:"char",value:" ",fullWidth:!1,styles:[]}';

export const streamRenderPatches: readonly Patch[] = [
  {
    name: 'markdown-parse-memo',
    find: 'function M0(f){let{completedOffsets:y,',
    replace: `function M0(f){let $ODmemo=M0.$ODmemo??=[];for(let $ODhit of $ODmemo)if($ODhit.input===f)return $ODhit.result;let $ODresult=$ODparse(f);if($ODmemo.push({input:f,result:$ODresult})>${MARKDOWN_MEMO_ENTRIES})$ODmemo.shift();return $ODresult}function $ODparse(f){let{completedOffsets:y,`,
  },
  {
    name: 'ink-blank-cell-shared',
    find: `get(){let e=[];for(let u=0;u<this.height;u++){let s=[];for(let C=0;C<this.width;C++)s.push(${BLANK_CELL})`,
    replace: `get(){let e=[],$ODblank=${BLANK_CELL};for(let u=0;u<this.height;u++){let s=[];for(let C=0;C<this.width;C++)s.push($ODblank)`,
  },
];
