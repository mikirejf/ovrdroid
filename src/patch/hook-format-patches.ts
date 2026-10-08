import type { Patch } from './patches.ts';

export const TOOL_HOOKS_START_EVENT = 'ovrdroid:tool-hooks-start';
export const TOOL_HOOKS_DONE_EVENT = 'ovrdroid:tool-hooks-done';
export const SNAPSHOT_BYTE_CAP = 256 * 1024;
export const NOTE_LINE_CAP = 40;

const INTRO_HEAD = JSON.stringify('A PostToolUse hook changed ');
const INTRO_TAIL = JSON.stringify(
  ' after this write. Droid recorded the new contents, so you can edit it without reading it again. Edit from these lines, not from what you wrote:',
);
const NOTE_INTRO = `${INTRO_HEAD}+$ODpath+${INTRO_TAIL}`;

export const HOOK_DIFF_NOTE =
  'function $ODnote($ODpath,$ODbefore,$ODafter){' +
  'if($ODbefore===$ODafter)return"";' +
  'let $ODold=$ODbefore.split("\\n"),$ODnew=$ODafter.split("\\n"),$ODhead=0,$ODtail=0;' +
  'while($ODhead<$ODold.length&&$ODhead<$ODnew.length&&$ODold[$ODhead]===$ODnew[$ODhead])$ODhead++;' +
  'while($ODtail<$ODold.length-$ODhead&&$ODtail<$ODnew.length-$ODhead&&$ODold[$ODold.length-1-$ODtail]===$ODnew[$ODnew.length-1-$ODtail])$ODtail++;' +
  'let $ODgone=$ODold.slice($ODhead,$ODold.length-$ODtail),$ODcame=$ODnew.slice($ODhead,$ODnew.length-$ODtail),' +
  '$ODspan=($ODcount)=>$ODcount===0?"no lines after line "+$ODhead:$ODcount===1?"line "+($ODhead+1):"lines "+($ODhead+1)+"-"+($ODhead+$ODcount),' +
  '$ODbody=[...$ODgone.map(($ODline)=>"-"+$ODline),...$ODcame.map(($ODline)=>"+"+$ODline)],' +
  `$ODout=[${NOTE_INTRO},"@@ "+$ODspan($ODcame.length)+" now (were "+$ODspan($ODgone.length)+") @@",...$ODbody.slice(0,${NOTE_LINE_CAP})];` +
  `if($ODbody.length>${NOTE_LINE_CAP})$ODout.push("\u2026 "+($ODbody.length-${NOTE_LINE_CAP})+" more changed lines not shown; read lines "+($ODhead+1)+"-"+($ODhead+Math.max($ODcame.length,1))+" before editing there.");` +
  'return $ODout.join("\\n")}';

const SNAPSHOT_LISTENER =
  `process.on(${JSON.stringify(TOOL_HOOKS_START_EVENT)},($ODid,$ODsnaps)=>{` +
  'for(let[$ODpath,$ODentry]of[...gc().fileTimestamps])' +
  'if($ODentry.toolCallId===$ODid&&$ODentry.operation!=="read")' +
  '$ODsnaps.push((async()=>{try{' +
  'let $ODstat=await de.stat($ODpath),$ODfresh=$ODstat.mtime.getTime()===$ODentry.mtime.getTime(),$ODtext=null;' +
  `if($ODfresh&&$ODstat.size<=${SNAPSHOT_BYTE_CAP}){try{$ODtext=await de.readFile($ODpath,"utf8")}catch{}}` +
  'return{path:$ODpath,operation:$ODentry.operation,fresh:$ODfresh,text:$ODtext}' +
  '}catch{return null}})())});';

const REFRESH_LISTENER =
  `process.on(${JSON.stringify(TOOL_HOOKS_DONE_EVENT)},($ODid,$ODsnaps,$ODwaits)=>{` +
  '$ODwaits.push(Promise.all($ODsnaps.map(async($ODsnap)=>{' +
  'if($ODsnap===null||!$ODsnap.fresh)return"";' +
  'await gc().trackFileOperation($ODsnap.path,$ODid,$ODsnap.operation);' +
  'if($ODsnap.text===null)return"";' +
  'try{return $ODnote($ODsnap.path,$ODsnap.text,await de.readFile($ODsnap.path,"utf8"))}catch{return""}' +
  '})))});';

const TRACKER_PAYLOAD = HOOK_DIFF_NOTE + SNAPSHOT_LISTENER + REFRESH_LISTENER;

const HOOKS_CALL =
  'ie=await _o("PostToolUse",{session_id:q,transcript_path:C,cwd:I(),permission_mode:JR(w),hook_event_name:"PostToolUse",tool_name:d.name,tool_input:d.input,tool_response:z},d.name,{...this.context,updateAction:this.updateAction,sessionId:q,toolCallId:d.id,abortSignal:o.abortController.signal});';

const TAKE_SNAPSHOT =
  '$ODsnap=await(async()=>{let $ODwaits=[];' +
  `process.emit(${JSON.stringify(TOOL_HOOKS_START_EVENT)},d.id,$ODwaits);` +
  'return Promise.all($ODwaits)})(),';

const FOLD_NOTES =
  'if(ie.length>0){let $ODwaits=[];' +
  `process.emit(${JSON.stringify(TOOL_HOOKS_DONE_EVENT)},d.id,$ODsnap,$ODwaits);` +
  'let $ODnotes=(await Promise.all($ODwaits)).flat().filter(Boolean);' +
  'if($ODnotes.length>0){let $ODtext=$ODnotes.join("\\n\\n"),$ODparsed;' +
  'try{$ODparsed=JSON.parse(z)}catch{}' +
  'if($ODparsed===null||typeof $ODparsed!=="object"||Array.isArray($ODparsed))z+="\\n\\n"+$ODtext;' +
  'else{let $ODhost=Array.isArray($ODparsed.files)&&$ODparsed.files.length>0?$ODparsed.files[0]:$ODparsed;' +
  '$ODhost.systemReminder=$ODhost.systemReminder?$ODhost.systemReminder+"\\n\\n"+$ODtext:$ODtext;' +
  'z=JSON.stringify($ODparsed)}}}';

export const hookFormatPatches: readonly Patch[] = [
  {
    name: 'tracker-refresh-after-tool-hooks',
    find: 'function gc(){let t=le(Je);if(t)return t;return E.getInstance()}',
    lookups: ['await de.stat(r);this.fileTimestamps.set('],
    replace: `function gc(){let t=le(Je);if(t)return t;return E.getInstance()}${TRACKER_PAYLOAD}`,
  },
  {
    name: 'tool-hooks-done-notice',
    find: HOOKS_CALL,
    replace: TAKE_SNAPSHOT + HOOKS_CALL + FOLD_NOTES,
  },
];
