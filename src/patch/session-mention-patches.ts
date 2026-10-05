import type { Patch } from './patches.ts';
import { SESSION_LIST_STATICS } from './session-list-patches.ts';

export const SESSION_QUERY =
  'static $ODsessionQuery($ODt,$ODc){for(let $ODi=$ODc-1;$ODi>=0;$ODi--){let $ODch=$ODt[$ODi];' +
  'if($ODch==="\\n"||$ODch==="\\r")return null;' +
  'if($ODch==="#"&&($ODi===0||/\\s/.test($ODt[$ODi-1]))){let $ODq=$ODt.slice($ODi+1,$ODc);' +
  'if(/^\\s/.test($ODq))return null;return{query:$ODq,start:$ODi}}}return null}';

export const SESSION_POOL =
  'static $ODsessionPool($ODall,$ODself){return $ODall.filter(($ODs)=>!$ODs.isSubagent&&$ODs.id!==$ODself)' +
  '.sort(($ODa,$ODb)=>$ODb.modifiedTime-$ODa.modifiedTime)}';

export const SESSION_MATCHES =
  'static $ODsessionMatches($ODpool,$ODq,$ODmax,$ODheads){let $ODl=$ODq.toLowerCase(),$ODw=$ODl.split(/\\s+/).filter(Boolean),$ODtop=[],$ODrest=[];' +
  'for(let $ODs of $ODpool){if($ODtop.length>=$ODmax)break;let $ODt=$ODs.title.toLowerCase();' +
  'if($ODw.every(($ODk)=>$ODt.includes($ODk))||$ODs.id.toLowerCase().startsWith($ODl)){$ODtop.push($ODs);continue}' +
  'let $ODhd=$ODheads?.get($ODs.id),$ODh=[$ODt,this.$ODsessionPlace($ODs.cwd).label,$ODs.cwd&&this.$ODhomePath($ODs.cwd),$ODhd?.branch,$ODhd?.text].filter(Boolean).join(" ").toLowerCase();' +
  'if($ODw.every(($ODk)=>$ODh.includes($ODk)))$ODrest.push($ODs)}' +
  'return $ODtop.concat($ODrest).slice(0,$ODmax)}';

export const SESSION_KEEP =
  'static $ODsessionKeep($ODids,$ODnow,$ODpool,$ODmax){if(!$ODids.length)return $ODnow;' +
  'let $ODby=new Map($ODpool.map(($ODs)=>[$ODs.id,$ODs])),$ODhad=new Set($ODids);' +
  'return $ODids.map(($ODi)=>$ODby.get($ODi)).concat($ODnow.filter(($ODs)=>!$ODhad.has($ODs.id))).slice(0,$ODmax)}';

export const SESSION_COMPLETE =
  'static $ODsessionComplete($ODt,$ODc,$ODid){let $ODm=this.$ODsessionQuery($ODt,$ODc);' +
  `if(!$ODm)return{newText:$ODt,newCursorPosition:$ODc};let $ODtag=\`#session-\${$ODid} \`;` +
  'return{newText:$ODt.slice(0,$ODm.start)+$ODtag+$ODt.slice($ODc),newCursorPosition:$ODm.start+$ODtag.length}}';

export const SHORT_PATH_CHARS = 30;

export const SESSION_REPO =
  'static $ODrepos=new Map;' +
  'static $ODsessionPlace($ODcwd){if(!$ODcwd)return{label:"",root:!0};let $ODplace=this.$ODrepos.get($ODcwd);' +
  'if($ODplace===void 0)this.$ODrepos.set($ODcwd,$ODplace=this.$ODrepoPlace($ODcwd));return $ODplace}' +
  'static $ODrepoPlace($ODcwd){let $ODfs=require("fs"),$ODp=require("path");try{' +
  'if(!$ODfs.statSync($ODcwd,{throwIfNoEntry:!1})?.isDirectory())return{label:this.$ODshortPath($ODcwd),root:!0};' +
  'for(let $ODdir=$ODcwd;;){let $ODgit=$ODp.join($ODdir,".git"),$ODst=$ODfs.statSync($ODgit,{throwIfNoEntry:!1});' +
  'if($ODst){let $ODat=$ODdir===$ODcwd;if($ODst.isDirectory())return{label:$ODp.basename($ODdir),root:$ODat};' +
  'let $ODgd=/^gitdir:\\s*(.+)$/m.exec($ODfs.readFileSync($ODgit,"utf8"));' +
  'if($ODgd){let $ODtrees=$ODp.dirname($ODp.resolve($ODdir,$ODgd[1].trim())),$ODdot=$ODp.dirname($ODtrees);' +
  'if($ODp.basename($ODtrees)==="worktrees"&&$ODp.basename($ODdot)===".git")return{label:$ODp.basename($ODp.dirname($ODdot)),root:!1}}' +
  'return{label:$ODp.basename($ODdir),root:$ODat}}' +
  'let $ODup=$ODp.dirname($ODdir);if($ODup===$ODdir)break;$ODdir=$ODup}' +
  '}catch{}return{label:this.$ODshortPath($ODcwd),root:!0}}' +
  'static $ODhomePath($ODcwd){let $ODhome=require("os").homedir();' +
  'return $ODcwd===$ODhome||$ODcwd.startsWith($ODhome+"/")?"~"+$ODcwd.slice($ODhome.length):$ODcwd}' +
  'static $ODshortPath($ODcwd){let $ODpath=this.$ODhomePath($ODcwd),$ODparts=$ODpath.split("/");' +
  `return $ODpath.length>${SHORT_PATH_CHARS}&&$ODparts.length>4?[...$ODparts.slice(0,2),"\\u2026",...$ODparts.slice(-2)].join("/"):$ODpath}`;

export const SESSION_ITEMS =
  'static $ODsessionItems($ODrows,$ODfirst){return $ODrows.map(($ODs)=>({' +
  'label:($ODs.title?ZT($ODs.title):R().t("common:sessions.untitled")).replace(/\\s+/g," ").trim(),' +
  'value:"#session-"+$ODs.id,$ODsession:$ODs.id,$ODrow:$ODs,$ODhead:$ODfirst($ODs),$ODplace:this.$ODsessionPlace($ODs.cwd)}))}';

export const TRANSCRIPT_HEAD_BYTES = 131_072;

export const SESSION_TEXT = String.raw`static $ODsessionText($ODraw,$ODhead={text:null,branch:null,seen:!1}){let $ODlines=$ODraw.split("\n");$ODlines.pop();for(let $ODline of $ODlines){let $ODr;try{$ODr=JSON.parse($ODline)}catch{continue}let $ODm=$ODr?.message;if($ODr?.type!=="message"||$ODm?.role!=="user")continue;let $ODc=$ODm.content,$ODt=typeof $ODc==="string"?$ODc:Array.isArray($ODc)?$ODc.filter(($ODb)=>$ODb?.type==="text"&&typeof $ODb.text==="string").map(($ODb)=>$ODb.text).join("\n"):"";if(String($ODr.id).startsWith("context-")){if(!$ODhead.seen)$ODhead.seen=!0,$ODhead.branch=this.$ODstatusBranch($ODt);continue}if($ODm.visibility!==void 0){let $ODk=/^\s*Skill "([^"]+)" activated(?::([\s\S]*))?$/.exec($ODt);if(!$ODk)continue;$ODt="/"+$ODk[1]+" "+($ODk[2]??"")}$ODt=$ODt.replace(/<(system-[\w-]+)>[\s\S]*?<\/\1>/g,"").replace(/<system-[\w-]+>[\s\S]*$/,"").replace(/\s+/g," ").trim();if($ODt){$ODhead.text=$ODt;return $ODhead}}return $ODhead}`;

export const TRANSCRIPT_MAX_BYTES = 4_194_304;

export const SESSION_HEAD =
  `static $ODsessionHead($ODpath){let $ODfs=require("fs"),$ODfd,$ODhead={text:null,branch:null,seen:!1};try{$ODfd=$ODfs.openSync($ODpath,"r");` +
  `let $ODbuf=Buffer.allocUnsafe(${TRANSCRIPT_HEAD_BYTES}),$ODend=0,$ODpos=0;for(;;){` +
  'if($ODend===$ODbuf.length){let $ODnext=Buffer.allocUnsafe($ODbuf.length*2);$ODbuf.copy($ODnext,0,0,$ODend);$ODbuf=$ODnext}' +
  `let $ODn=$ODfs.readSync($ODfd,$ODbuf,$ODend,Math.min($ODbuf.length-$ODend,${TRANSCRIPT_MAX_BYTES}-$ODpos),$ODpos);$ODpos+=$ODn;$ODend+=$ODn;` +
  'let $ODcut=$ODn===0?$ODend:$ODbuf.lastIndexOf(10,$ODend-1)+1;' +
  'if($ODcut>0)this.$ODsessionText($ODbuf.toString("utf8",0,$ODcut)+"\\n",$ODhead);' +
  `if($ODhead.text||$ODn===0||$ODpos>=${TRANSCRIPT_MAX_BYTES})return $ODhead;` +
  '$ODend-=$ODcut;$ODbuf.copyWithin(0,$ODcut,$ODcut+$ODend)}' +
  '}catch{return $ODhead}finally{if($ODfd!==void 0)$ODfs.closeSync($ODfd)}}';

export const TRANSCRIPT_TAIL_BYTES = 65_536;

export const SESSION_LAST =
  'static $ODsessionLast($ODpath){let $ODfs=require("fs"),$ODfd;try{$ODfd=$ODfs.openSync($ODpath,"r");' +
  'let $ODsize=$ODfs.fstatSync($ODfd).size;' +
  `for(let $ODlen=${TRANSCRIPT_TAIL_BYTES};;$ODlen*=2){let $ODstart=Math.max(0,$ODsize-$ODlen),$ODbuf=Buffer.allocUnsafe($ODsize-$ODstart),$ODgot=0;` +
  'while($ODgot<$ODbuf.length){let $ODn=$ODfs.readSync($ODfd,$ODbuf,$ODgot,$ODbuf.length-$ODgot,$ODstart+$ODgot);if($ODn===0)break;$ODgot+=$ODn}' +
  'let $ODlines=$ODbuf.toString("utf8",0,$ODgot).split("\\n");if($ODstart>0)$ODlines.shift();' +
  'for(let $ODi=$ODlines.length-1;$ODi>=0;$ODi--){let $ODr;try{$ODr=JSON.parse($ODlines[$ODi])}catch{continue}let $ODm=$ODr?.message;' +
  'if($ODr?.type!=="message"||$ODm?.visibility!==void 0||$ODm.hookEventName)continue;let $ODat=Date.parse($ODr.timestamp);if(!Number.isNaN($ODat))return $ODat}' +
  `if($ODstart===0||$ODlen>=${TRANSCRIPT_MAX_BYTES})return null}` +
  '}catch{return null}finally{if($ODfd!==void 0)$ODfs.closeSync($ODfd)}}';

const SESSION_STATICS =
  SESSION_QUERY +
  SESSION_POOL +
  SESSION_MATCHES +
  SESSION_KEEP +
  SESSION_COMPLETE +
  SESSION_ITEMS +
  SESSION_TEXT +
  SESSION_HEAD +
  SESSION_LAST +
  SESSION_REPO +
  SESSION_LIST_STATICS;

export const SESSION_PROMPT_LINE =
  '- A `#session-<uuid>` tag in a user message names another Droid session. Run `dsx show <uuid>` for its summary. For its transcript, run `dsx export <uuid> --no-thinking -o /tmp/session-<uuid>.md` and read that file in parts, because piped export output is cut short; without dsx, the transcript is `~/.factory/sessions/*/<uuid>.jsonl` and can be very large, so read it in parts.';

const PROMPT_ANCHOR =
  '\\`<system-reminder>\\` blocks are injected by the harness. Treat them as trusted runtime context, not user-authored text. Address diagnostics relevant to the task, and report unrelated or unresolved issues accurately.';

const CALLBACK_START = 'let vr=wn??zi,Di=$n??Ma;if(!_e){';

const PO_LOOKUP =
  'Hs=++Po.current;if(go.current)clearTimeout(go.current);go.current=setTimeout(()=>{if(Hs===Po.current)On(!0)}';

const UU_LOOKUP = 'var Wre=()=>R().t("common:fileSuggestions.file"),r5=100;class uu{';

const SUGGESTIONS_CLOSED =
  'if(ao.current)clearTimeout(ao.current),ao.current=null;if(go.current)clearTimeout(go.current),go.current=null;On(!1)';

export const sessionMentionPatches: readonly Patch[] = [
  {
    name: 'session-mention-helpers',
    find: 'static isInPathContext({text:y,cursorPosition:E}){return uu.extractPathQuery({text:y,cursorPosition:E})!==null}}',
    lookups: [
      UU_LOOKUP,
      'children:bt.title?ZT(bt.title):oe("sessions.untitled")',
      'Pe=be?Li(be,Math.max(0,Le-_e)):void 0',
      'let{slice:U}=Ar(D,F-QS.length);',
    ],
    replace: `static isInPathContext({text:y,cursorPosition:E}){return uu.extractPathQuery({text:y,cursorPosition:E})!==null}${SESSION_STATICS}}`,
  },
  {
    name: 'session-mention-invalidate',
    find: CALLBACK_START,
    lookups: [UU_LOOKUP, PO_LOOKUP, 'Ba=k(()=>new uu(q,co),[q,co])'],
    replace:
      'let vr=wn??zi,Di=$n??Ma,$ODseq=++Po.current;' +
      'if(!uu.$ODsessionQuery(vr,Di))Ba.$ODpool=Ba.$ODload=Ba.$ODfirst=void 0;if(!_e){',
  },
  {
    name: 'session-mention-close-cancels',
    find: 'Qt=g((wn)=>{Go({showSuggestions:wn}),zt(wn)},[Go])',
    lookups: [PO_LOOKUP],
    replace: 'Qt=g((wn)=>{if(!wn)++Po.current;Go({showSuggestions:wn}),zt(wn)},[Go])',
  },
  {
    name: 'session-mention-suggest',
    find: `${SUGGESTIONS_CLOSED},En([]),Qt(!1)},[zi,Ma,Ba,Mt,qt,Zt.status,_e,Pe])`,
    lookups: [
      CALLBACK_START,
      UU_LOOKUP,
      'On(!1),En(oi),Ro(0),Qt(oi.length>0)',
      PO_LOOKUP,
      'catch(E){return h(E,"Error occurred while fetching file suggestions"),[]}',
      'await p().getSessionsForSelector(I())',
    ],
    replace:
      `${SUGGESTIONS_CLOSED};let $ODhash=Pe?null:uu.$ODsessionQuery(vr,Di);` +
      'if(!$ODhash){En([]),Qt(!1);return}' +
      'let $ODseen=Ba.$ODfirst??=new Map,' +
      '$ODfirst=($ODs)=>{if(!$ODseen.has($ODs.id)){let $ODpath=p().getSessionMessagesPath($ODs.id,$ODs.cwd);$ODseen.set($ODs.id,uu.$ODsessionHead($ODpath));' +
      'let $ODat=uu.$ODsessionLast($ODpath);if($ODat!==null)$ODs.modifiedTime=new Date($ODat)}return $ODseen.get($ODs.id)},' +
      '$ODshown=[],$ODshow=($ODpool,$ODkeep)=>{let $ODopen=$ODkeep&&$ODshown.length>0,' +
      '$ODrows=uu.$ODsessionItems(uu.$ODsessionKeep($ODopen?$ODshown:[],uu.$ODsessionMatches($ODpool,$ODhash.query,r5,$ODseen),$ODpool,r5),$ODfirst);' +
      '$ODshown=$ODrows.map(($ODr)=>$ODr.$ODsession);En($ODrows);if(!$ODopen)Ro(0);' +
      'Qt($ODrows.length>0);$ODseq=Po.current},' +
      '$ODscan=($ODpool)=>{let $ODi=0,$ODstep=()=>{if(Ba.$ODpool!==$ODpool)return;' +
      'for(let $ODend=Math.min($ODi+50,$ODpool.length);$ODi<$ODend;$ODi++)$ODfirst($ODpool[$ODi]);' +
      'if($ODi>=$ODpool.length)$ODpool.sort(($ODa,$ODb)=>$ODb.modifiedTime-$ODa.modifiedTime);' +
      'Ba.$ODrefresh?.();if($ODi<$ODpool.length)setTimeout($ODstep)};setTimeout($ODstep)};' +
      'Ba.$ODrefresh=()=>{if($ODseq===Po.current&&Ba.$ODpool)$ODshow(Ba.$ODpool,!0)};' +
      'if(Ba.$ODpool){$ODshow(Ba.$ODpool);return}' +
      'let $ODload=Ba.$ODload??=p().getSessionsForSelector(Ba.workingDirectory)' +
      '.then(($ODall)=>uu.$ODsessionPool($ODall,p().getCurrentSessionId()));' +
      '$ODload.then(($ODpool)=>{if(Ba.$ODload!==$ODload)return;let $ODfresh=Ba.$ODpool!==$ODpool;Ba.$ODpool=$ODpool;' +
      'if($ODseq===Po.current)$ODshow($ODpool);if($ODfresh)$ODscan($ODpool)},' +
      '($ODe)=>{if(Ba.$ODload===$ODload)Ba.$ODload=void 0;h($ODe,"Failed to load sessions for the # picker")})' +
      '},[zi,Ma,Ba,Mt,qt,Zt.status,_e,Pe])',
  },
  {
    name: 'session-mention-escape',
    find: 'Hi=g(()=>mo.current&&ko(),[ko])',
    lookups: ['Un=g(()=>{U(!1),z(!1)},[U,z])'],
    replace: 'Hi=g(()=>{U(!1);return mo.current&&ko()},[ko,U])',
  },
  {
    name: 'session-mention-service-drops',
    find: 'v(()=>{if(Po.current+=1,ao.current)clearTimeout(ao.current),ao.current=null;if(go.current)clearTimeout(go.current),go.current=null;On(!1),En([]),Qt(!1),Ro(0)},[Ba])',
    replace:
      'v(()=>{if(Po.current+=1,ao.current)clearTimeout(ao.current),ao.current=null;if(go.current)clearTimeout(go.current),go.current=null;On(!1),En([]),Qt(!1),Ro(0);' +
      'return()=>{Ba.$ODpool=Ba.$ODload=Ba.$ODfirst=Ba.$ODrefresh=void 0}},[Ba])',
  },
  {
    name: 'session-mention-select',
    find: 'let Di=uu.completeFilePath({text:$n,cursorPosition:vr,selectedSuggestion:wn});',
    replace:
      'let Di=wn.$ODsession?uu.$ODsessionComplete($n,vr,wn.$ODsession):uu.completeFilePath({text:$n,cursorPosition:vr,selectedSuggestion:wn});',
  },
  {
    name: 'session-mention-prompt',
    find: PROMPT_ANCHOR,
    replace: `${PROMPT_ANCHOR}\n${SESSION_PROMPT_LINE.replaceAll('`', '\\`')}`,
  },
];
