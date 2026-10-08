import type { Patch } from './patches.ts';

export const TOOL_HOOKS_DONE_EVENT = 'ovrdroid:tool-hooks-done';

const REFRESH_LISTENER =
  `process.on(${JSON.stringify(TOOL_HOOKS_DONE_EVENT)},($ODid,$ODwaits)=>{` +
  '$ODwaits.push((async()=>{' +
  'for(let[$ODpath,$ODentry]of[...gc().fileTimestamps])' +
  'if($ODentry.toolCallId===$ODid&&$ODentry.operation!=="read")' +
  'await gc().trackFileOperation($ODpath,$ODid,$ODentry.operation)})())});';

export const hookFormatPatches: readonly Patch[] = [
  {
    name: 'tracker-refresh-after-tool-hooks',
    find: 'function gc(){let t=le(Je);if(t)return t;return E.getInstance()}',
    replace: `function gc(){let t=le(Je);if(t)return t;return E.getInstance()}${REFRESH_LISTENER}`,
  },
  {
    name: 'tool-hooks-done-notice',
    find: 'ie=await _o("PostToolUse",{session_id:q,transcript_path:C,cwd:I(),permission_mode:JR(w),hook_event_name:"PostToolUse",tool_name:d.name,tool_input:d.input,tool_response:z},d.name,{...this.context,updateAction:this.updateAction,sessionId:q,toolCallId:d.id,abortSignal:o.abortController.signal});',
    replace:
      'ie=await _o("PostToolUse",{session_id:q,transcript_path:C,cwd:I(),permission_mode:JR(w),hook_event_name:"PostToolUse",tool_name:d.name,tool_input:d.input,tool_response:z},d.name,{...this.context,updateAction:this.updateAction,sessionId:q,toolCallId:d.id,abortSignal:o.abortController.signal});' +
      `if(ie.length>0){let $ODwaits=[];process.emit(${JSON.stringify(TOOL_HOOKS_DONE_EVENT)},d.id,$ODwaits),await Promise.all($ODwaits)}`,
  },
];
