import type { Patch } from './patches.ts';

export const TOOL_CALL_START_EVENT = 'ovrdroid:tool-call-start';
export const TOOL_CALL_DONE_EVENT = 'ovrdroid:tool-call-done';
export const TOOL_CALL_END_EVENT = 'ovrdroid:tool-call-end';
export const SCRIPT_TOOL = 'Script';
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
const CREDIT_CALL = JSON.stringify(' call');
const CREDIT_SHARED = JSON.stringify(', or a tool call that ran at the same time,');
const CREDIT_MIDDLE = JSON.stringify(' changed files you read or wrote earlier: ');
const CREDIT_TAIL = JSON.stringify(
  '. Droid recorded their new versions, so Edit accepts them. Your earlier view of them is out of date: read the changed part first unless you know what changed.',
);

export const CREDIT_NOTE =
  'function $ODcredited($ODname,$ODpaths,$ODshared){' +
  `let $ODshown=$ODpaths.slice(0,${CREDIT_PATH_CAP}).join(", "),` +
  `$ODhidden=$ODpaths.length>${CREDIT_PATH_CAP}?", \u2026 and "+($ODpaths.length-${CREDIT_PATH_CAP})+" more":"";` +
  `return ${CREDIT_HEAD}+$ODname+${CREDIT_CALL}+($ODshared?${CREDIT_SHARED}:"")+${CREDIT_MIDDLE}+$ODshown+$ODhidden+${CREDIT_TAIL}}`;

const LIVE_CALLS =
  'var $ODlive=new Map;' +
  `process.on(${JSON.stringify(TOOL_CALL_END_EVENT)},($ODid)=>{$ODlive.delete($ODid)});`;

const CALL_START_LISTENER =
  `process.on(${JSON.stringify(TOOL_CALL_START_EVENT)},($ODwaits,$ODid,$ODname)=>{` +
  `if($ODname!==${JSON.stringify(SCRIPT_TOOL)}){` +
  'let $ODrecord={shared:$ODlive.size>0};' +
  'for(let $ODother of $ODlive.values())$ODother.shared=!0;' +
  '$ODlive.set($ODid,$ODrecord)}' +
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
  'return $ODcredited($ODname,$ODmoved.map(($ODhit)=>$ODhit.path),$ODlive.get($ODid)?.shared===!0)' +
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
  LIVE_CALLS +
  CALL_START_LISTENER +
  CALL_DONE_LISTENER +
  SNAPSHOT_LISTENER +
  REFRESH_LISTENER;

function collectWaits(event: string, args: string): string {
  return `(async()=>{let $ODwaits=[];process.emit(${JSON.stringify(event)},${args});return Promise.all($ODwaits)})()`;
}

function callDone(id: string, name: string): string {
  return `process.emit(${JSON.stringify(TOOL_CALL_DONE_EVENT)},${id},${name},$ODpre,$ODwaits);`;
}

export function beforeCall(id: string, name: string): string {
  return `let $ODpre=await${collectWaits(TOOL_CALL_START_EVENT, `$ODwaits,${id},${name}`)};`;
}

export function callEnd(id: string): string {
  return `process.emit(${JSON.stringify(TOOL_CALL_END_EVENT)},${id})`;
}

const PERMISSION_FN = 'this.createTuiRequestPermissionFn(t);';
const AFTER_PERMISSION_FN = 'cZ(ue??null);let xe=()=>Xqe(g.name,';
const RUNNER_FINALLY = '}finally{this._runningTools.delete(g.id),';

const HOOKS_CALL =
  'ie=await _o("PostToolUse",{session_id:q,transcript_path:C,cwd:I(),permission_mode:JR(w),hook_event_name:"PostToolUse",tool_name:d.name,tool_input:d.input,tool_response:z},d.name,{...this.context,updateAction:this.updateAction,sessionId:q,toolCallId:d.id,abortSignal:o.abortController.signal});';

const FOLD_FUNCTION =
  '$ODfold=($ODresult,$ODnotes)=>{' +
  'if($ODnotes.length===0)return $ODresult;' +
  'let $ODtext=$ODnotes.join("\\n\\n"),$ODparsed;' +
  'if(Array.isArray($ODresult))return[...$ODresult,{type:"text",text:$ODtext}];' +
  'if(typeof $ODresult!=="string")return $ODresult;' +
  'try{$ODparsed=JSON.parse($ODresult)}catch{}' +
  'if($ODparsed===null||typeof $ODparsed!=="object"||Array.isArray($ODparsed))return $ODresult+"\\n\\n"+$ODtext;' +
  'let $ODhost=Array.isArray($ODparsed.files)&&$ODparsed.files.length>0?$ODparsed.files[0]:$ODparsed;' +
  '$ODhost.systemReminder=$ODhost.systemReminder?$ODhost.systemReminder+"\\n\\n"+$ODtext:$ODtext;' +
  'return JSON.stringify($ODparsed)},';

const TAKE_SNAPSHOT = `$ODsnap=await${collectWaits(TOOL_HOOKS_START_EVENT, 'd.id,$ODwaits')},`;

const FOLD_NOTES =
  'let $ODnotes=[];' +
  'if(ie.length>0){let $ODwaits=[];' +
  `process.emit(${JSON.stringify(TOOL_HOOKS_DONE_EVENT)},d.id,$ODsnap,$ODwaits);` +
  '$ODnotes.push(...(await Promise.all($ODwaits)).flat())}' +
  `{let $ODwaits=[];${callDone('d.id', 'd.name')}` +
  '$ODnotes.push(...(await Promise.all($ODwaits)))}' +
  '{let $ODshown=$ODnotes.filter(Boolean);' +
  'z=$ODfold(z,$ODshown);' +
  're!==void 0&&(re=$ODfold(re,$ODshown))}';

const MODEL_CONTENT_BINDING = '{content:z,modelContent:re}=await this.raceToolWithBatchAbort(';

const NESTED_RUN =
  'u=()=>W(o,{sessionId:o.sessionId,toolUseId:e.toolUseId,toolName:e.toolName,input:n,...t,...E(r.parentToolUseId)},s),';

const NESTED_DISPATCH = '{value:T,userValue:l,llmReminders:y}=await G5(o.sessionId,a.tool,';

const NESTED_CALL_CHECK =
  `$ODrun=async()=>{try{${beforeCall('e.toolUseId', 'e.toolName')}` +
  `let $ODout=await u(),$ODwaits=[];${callDone('e.toolUseId', 'e.toolName')}` +
  'let $ODnotes=(await Promise.all($ODwaits)).filter(Boolean);' +
  'return $ODnotes.length===0?$ODout:{...$ODout,llmReminders:[...$ODout.llmReminders??[],...$ODnotes]}' +
  `}finally{${callEnd('e.toolUseId')}}},`;

export const fileTrackerPatches: readonly Patch[] = [
  {
    name: 'file-tracker-listeners',
    find: 'function gc(){let t=le(Je);if(t)return t;return E.getInstance()}',
    lookups: ['import de from"fs/promises"'],
    replace: `function gc(){let t=le(Je);if(t)return t;return E.getInstance()}${TRACKER_PAYLOAD}`,
  },
  {
    name: 'tool-call-start-stat',
    find: PERMISSION_FN + AFTER_PERMISSION_FN,
    replace: PERMISSION_FN + beforeCall('g.id', 'g.name') + AFTER_PERMISSION_FN,
  },
  {
    name: 'tool-call-end-live',
    find: RUNNER_FINALLY,
    replace: `}finally{${callEnd('g.id')},this._runningTools.delete(g.id),`,
  },
  {
    name: 'tool-call-done-notice',
    find: HOOKS_CALL,
    lookups: [MODEL_CONTENT_BINDING],
    replace: FOLD_FUNCTION + TAKE_SNAPSHOT + HOOKS_CALL + FOLD_NOTES,
  },
  {
    name: 'nested-tool-call-notice',
    find: `${NESTED_RUN}${NESTED_DISPATCH}u);`,
    replace: `${NESTED_RUN}${NESTED_CALL_CHECK}${NESTED_DISPATCH}$ODrun);`,
  },
];
