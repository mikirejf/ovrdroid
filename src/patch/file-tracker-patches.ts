import type { Patch } from './patches.ts';

export const TOOL_CALL_START_EVENT = 'ovrdroid:tool-call-start';
export const TOOL_CALL_DONE_EVENT = 'ovrdroid:tool-call-done';
export const TOOL_HOOKS_START_EVENT = 'ovrdroid:tool-hooks-start';
export const TOOL_HOOKS_DONE_EVENT = 'ovrdroid:tool-hooks-done';
export const SNAPSHOT_BYTE_CAP = 256 * 1024;
export const NOTE_LINE_CAP = 40;
export const CREDIT_PATH_CAP = 20;

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

const CREDIT_HEAD = JSON.stringify('This ');
const CREDIT_MIDDLE = JSON.stringify(' call changed files you read or wrote earlier: ');
const CREDIT_TAIL = JSON.stringify(
  '. Droid recorded their new versions, so Edit accepts them. Your earlier view of them is out of date: read the changed part first unless you know what changed.',
);

export const CREDIT_NOTE =
  'function $ODcredited($ODname,$ODpaths){' +
  `let $ODshown=$ODpaths.slice(0,${CREDIT_PATH_CAP}).join(", "),` +
  `$ODhidden=$ODpaths.length>${CREDIT_PATH_CAP}?", \u2026 and "+($ODpaths.length-${CREDIT_PATH_CAP})+" more":"";` +
  `return ${CREDIT_HEAD}+$ODname+${CREDIT_MIDDLE}+$ODshown+$ODhidden+${CREDIT_TAIL}}`;

const CALL_START_LISTENER =
  `process.on(${JSON.stringify(TOOL_CALL_START_EVENT)},($ODwaits)=>{` +
  'let $ODtracker=gc();' +
  '$ODwaits.push(Promise.all([...$ODtracker.fileTimestamps.keys()].map(async($ODpath)=>{' +
  'try{return[$ODpath,(await de.stat($ODpath)).mtime.getTime()]}catch{return null}' +
  '})).then(($ODpairs)=>new Map($ODpairs.filter(Boolean))))});';

const CALL_DONE_LISTENER =
  `process.on(${JSON.stringify(TOOL_CALL_DONE_EVENT)},($ODid,$ODname,$ODpre,$ODwaits)=>{` +
  'let $ODtracker=gc();' +
  '$ODwaits.push((async()=>{' +
  'let $ODbefore=$ODpre[0],$ODhits=await Promise.all([...$ODtracker.fileTimestamps].map(async([$ODpath,$ODentry])=>{' +
  'try{let $ODnow=(await de.stat($ODpath)).mtime.getTime(),$ODwas=$ODentry.mtime.getTime(),$ODthen=$ODbefore.get($ODpath);' +
  'return $ODnow===$ODwas||($ODthen!==undefined&&$ODthen!==$ODwas)?null:{path:$ODpath,operation:$ODentry.operation}' +
  '}catch{return null}})),$ODmoved=$ODhits.filter(Boolean);' +
  'if($ODmoved.length===0)return"";' +
  'await Promise.all($ODmoved.map(($ODhit)=>$ODtracker.trackFileOperation($ODhit.path,$ODid,$ODhit.operation)));' +
  'return $ODcredited($ODname,$ODmoved.map(($ODhit)=>$ODhit.path))' +
  '})())});';

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

const TRACKER_PAYLOAD =
  HOOK_DIFF_NOTE +
  CREDIT_NOTE +
  CALL_START_LISTENER +
  CALL_DONE_LISTENER +
  SNAPSHOT_LISTENER +
  REFRESH_LISTENER;

export const BEFORE_CALL =
  'let $ODpre=await(async()=>{let $ODwaits=[];' +
  `process.emit(${JSON.stringify(TOOL_CALL_START_EVENT)},$ODwaits);` +
  'return Promise.all($ODwaits)})();';

const RACE_CALL = 'let z=await this.raceToolWithBatchAbort(';

const HOOKS_CALL =
  'ie=await _o("PostToolUse",{session_id:q,transcript_path:C,cwd:I(),permission_mode:JR(w),hook_event_name:"PostToolUse",tool_name:d.name,tool_input:d.input,tool_response:z},d.name,{...this.context,updateAction:this.updateAction,sessionId:q,toolCallId:d.id,abortSignal:o.abortController.signal});';

const FOLD_FUNCTION =
  '$ODfold=($ODresult,$ODnotes)=>{' +
  'if($ODnotes.length===0)return $ODresult;' +
  'let $ODtext=$ODnotes.join("\\n\\n"),$ODparsed;' +
  'try{$ODparsed=JSON.parse($ODresult)}catch{}' +
  'if($ODparsed===null||typeof $ODparsed!=="object"||Array.isArray($ODparsed))return $ODresult+"\\n\\n"+$ODtext;' +
  'let $ODhost=Array.isArray($ODparsed.files)&&$ODparsed.files.length>0?$ODparsed.files[0]:$ODparsed;' +
  '$ODhost.systemReminder=$ODhost.systemReminder?$ODhost.systemReminder+"\\n\\n"+$ODtext:$ODtext;' +
  'return JSON.stringify($ODparsed)},';

const TAKE_SNAPSHOT =
  '$ODsnap=await(async()=>{let $ODwaits=[];' +
  `process.emit(${JSON.stringify(TOOL_HOOKS_START_EVENT)},d.id,$ODwaits);` +
  'return Promise.all($ODwaits)})(),';

const FOLD_NOTES =
  'let $ODnotes=[];' +
  'if(ie.length>0){let $ODwaits=[];' +
  `process.emit(${JSON.stringify(TOOL_HOOKS_DONE_EVENT)},d.id,$ODsnap,$ODwaits);` +
  '$ODnotes.push(...(await Promise.all($ODwaits)).flat())}' +
  '{let $ODwaits=[];' +
  `process.emit(${JSON.stringify(TOOL_CALL_DONE_EVENT)},d.id,d.name,$ODpre,$ODwaits);` +
  '$ODnotes.push(...(await Promise.all($ODwaits)))}' +
  'z=$ODfold(z,$ODnotes.filter(Boolean));';

export const fileTrackerPatches: readonly Patch[] = [
  {
    name: 'file-tracker-listeners',
    find: 'function gc(){let t=le(Je);if(t)return t;return E.getInstance()}',
    lookups: ['await de.stat(r);this.fileTimestamps.set('],
    replace: `function gc(){let t=le(Je);if(t)return t;return E.getInstance()}${TRACKER_PAYLOAD}`,
  },
  {
    name: 'tool-call-start-stat',
    find: RACE_CALL,
    replace: BEFORE_CALL + RACE_CALL,
  },
  {
    name: 'tool-call-done-notice',
    find: HOOKS_CALL,
    replace: FOLD_FUNCTION + TAKE_SNAPSHOT + HOOKS_CALL + FOLD_NOTES,
  },
];
