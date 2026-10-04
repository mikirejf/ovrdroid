import type { Patch } from './patches.ts';

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
  'let $ODh=$ODheads?.get($ODs.id);if($ODh){$ODh=$ODt+" "+$ODh.toLowerCase();if($ODw.every(($ODk)=>$ODh.includes($ODk)))$ODrest.push($ODs)}}' +
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
  'static $ODsessionRepo($ODcwd){if(!$ODcwd)return"";let $ODname=this.$ODrepos.get($ODcwd);' +
  'if($ODname===void 0)this.$ODrepos.set($ODcwd,$ODname=this.$ODrepoName($ODcwd));return $ODname}' +
  'static $ODrepoName($ODcwd){let $ODfs=require("fs"),$ODp=require("path");try{' +
  'if(!$ODfs.statSync($ODcwd,{throwIfNoEntry:!1})?.isDirectory())return this.$ODshortPath($ODcwd);' +
  'for(let $ODdir=$ODcwd;;){let $ODgit=$ODp.join($ODdir,".git"),$ODst=$ODfs.statSync($ODgit,{throwIfNoEntry:!1});' +
  'if($ODst){if($ODst.isDirectory())return $ODp.basename($ODdir);' +
  'let $ODgd=/^gitdir:\\s*(.+)$/m.exec($ODfs.readFileSync($ODgit,"utf8"));' +
  'if($ODgd){let $ODtrees=$ODp.dirname($ODp.resolve($ODdir,$ODgd[1].trim())),$ODdot=$ODp.dirname($ODtrees);' +
  'if($ODp.basename($ODtrees)==="worktrees"&&$ODp.basename($ODdot)===".git")return $ODp.basename($ODp.dirname($ODdot))}' +
  'return $ODp.basename($ODdir)}' +
  'let $ODup=$ODp.dirname($ODdir);if($ODup===$ODdir)break;$ODdir=$ODup}' +
  '}catch{}return this.$ODshortPath($ODcwd)}' +
  'static $ODshortPath($ODcwd){let $ODhome=require("os").homedir(),' +
  '$ODpath=$ODcwd===$ODhome||$ODcwd.startsWith($ODhome+"/")?"~"+$ODcwd.slice($ODhome.length):$ODcwd,' +
  '$ODparts=$ODpath.split("/");' +
  `return $ODpath.length>${SHORT_PATH_CHARS}&&$ODparts.length>4?[...$ODparts.slice(0,2),"\\u2026",...$ODparts.slice(-2)].join("/"):$ODpath}`;

export const TITLE_MIN_CELLS = 8;

export const LABEL_MIN_CELLS = 6;

const ROW_MARGIN_CELLS = 6;

export const SESSION_ITEMS =
  'static $ODsessionItems($ODrows,$ODwidth,$ODfirst){' +
  `let $ODline=$ODwidth-${ROW_MARGIN_CELLS},$ODw=globalThis.Bun.stringWidth;return $ODrows.map(($ODs)=>{let $ODn=$ODs.messageCount,` +
  `$ODmeta=\`\${Mm($ODs.modifiedTime)} \\u00B7 \${$ODn} \${$ODn===1?"message":"messages"}\`,` +
  '$ODtitle=($ODs.title?ZT($ODs.title):R().t("common:sessions.untitled")).replace(/\\s+/g," ").trim(),' +
  '$ODroom=$ODline-2-$ODw($ODmeta),$ODrepo=this.$ODsessionRepo($ODs.cwd),' +
  `$ODfit=$ODroom-3-${TITLE_MIN_CELLS},$ODtag=$ODrepo&&$ODfit>=${LABEL_MIN_CELLS}?Li($ODrepo,$ODfit):"",` +
  `$ODlabel=\`\${DB($ODtitle,Math.max(4,$ODroom-($ODtag?$ODw($ODtag)+3:0)))}  \${$ODtag?$ODtag+" \\u00B7 ":""}\${$ODmeta}\`,$ODtext=$ODfirst($ODs);` +
  `if($ODtext&&!$ODtext.toLowerCase().startsWith($ODtitle.toLowerCase()))$ODlabel+=\`\\n  \${Li($ODtext,$ODline)}\`;` +
  `return{label:$ODlabel,value:\`#session-\${$ODs.id}\`,$ODsession:$ODs.id}})}`;

export const TRANSCRIPT_HEAD_BYTES = 131_072;

export const SESSION_TEXT = String.raw`static $ODsessionText($ODraw){let $ODlines=$ODraw.split("\n");$ODlines.pop();for(let $ODline of $ODlines){let $ODr;try{$ODr=JSON.parse($ODline)}catch{continue}let $ODm=$ODr?.message;if($ODr?.type!=="message"||$ODm?.role!=="user"||String($ODr.id).startsWith("context-"))continue;let $ODc=$ODm.content,$ODt=typeof $ODc==="string"?$ODc:Array.isArray($ODc)?$ODc.filter(($ODb)=>$ODb?.type==="text"&&typeof $ODb.text==="string").map(($ODb)=>$ODb.text).join("\n"):"";if($ODm.visibility!==void 0){let $ODk=/^\s*Skill "([^"]+)" activated(?::([\s\S]*))?$/.exec($ODt);if(!$ODk)continue;$ODt="/"+$ODk[1]+" "+($ODk[2]??"")}$ODt=$ODt.replace(/<(system-reminder|system-notification)>[\s\S]*?<\/\1>/g,"").replace(/\s+/g," ").trim();if($ODt)return $ODt}return null}`;

export const TRANSCRIPT_MAX_BYTES = 4_194_304;

export const SESSION_HEAD =
  `static $ODsessionHead($ODpath){let $ODfs=require("fs"),$ODfd;try{$ODfd=$ODfs.openSync($ODpath,"r");` +
  `let $ODbuf=Buffer.allocUnsafe(${TRANSCRIPT_HEAD_BYTES}),$ODend=0,$ODpos=0;for(;;){` +
  'if($ODend===$ODbuf.length){let $ODnext=Buffer.allocUnsafe($ODbuf.length*2);$ODbuf.copy($ODnext,0,0,$ODend);$ODbuf=$ODnext}' +
  `let $ODn=$ODfs.readSync($ODfd,$ODbuf,$ODend,Math.min($ODbuf.length-$ODend,${TRANSCRIPT_MAX_BYTES}-$ODpos),$ODpos);$ODpos+=$ODn;$ODend+=$ODn;` +
  'let $ODcut=$ODn===0?$ODend:$ODbuf.lastIndexOf(10,$ODend-1)+1,' +
  '$ODtext=$ODcut>0?this.$ODsessionText($ODbuf.toString("utf8",0,$ODcut)+"\\n"):null;' +
  `if($ODtext||$ODn===0||$ODpos>=${TRANSCRIPT_MAX_BYTES})return $ODtext;` +
  '$ODend-=$ODcut;$ODbuf.copyWithin(0,$ODcut,$ODcut+$ODend)}' +
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
  SESSION_REPO;

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
      'G=DB(q,F),j=z===""?G:fs(G,F)',
      'children:Mm(bt.modifiedTime)})}),t(T,{width:Wo,marginRight:Rd,children:t(i,{bold:Jo,color:Go,children:Mm(bt.createdTime)})',
      'children:bt.title?ZT(bt.title):oe("sessions.untitled")',
      'Pe=be?Li(be,Math.max(0,Le-_e)):void 0',
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
      'onRewindShortcut:F,width:U=tT.INPUT_WIDTH,',
    ],
    replace:
      `${SUGGESTIONS_CLOSED};let $ODhash=Pe?null:uu.$ODsessionQuery(vr,Di);` +
      'if(!$ODhash){En([]),Qt(!1);return}' +
      'let $ODseen=Ba.$ODfirst??=new Map,' +
      '$ODfirst=($ODs)=>{if(!$ODseen.has($ODs.id))$ODseen.set($ODs.id,uu.$ODsessionHead(p().getSessionMessagesPath($ODs.id,$ODs.cwd)));return $ODseen.get($ODs.id)},' +
      '$ODshown=[],$ODshow=($ODpool,$ODkeep)=>{let $ODopen=$ODkeep&&$ODshown.length>0,' +
      '$ODrows=uu.$ODsessionItems(uu.$ODsessionKeep($ODopen?$ODshown:[],uu.$ODsessionMatches($ODpool,$ODhash.query,r5,$ODseen),$ODpool,r5),Math.min(U,process.stdout.columns||U),$ODfirst);' +
      '$ODshown=$ODrows.map(($ODr)=>$ODr.$ODsession);En($ODrows);if(!$ODopen)Ro(0);' +
      'Qt($ODrows.length>0);$ODseq=Po.current},' +
      '$ODscan=($ODpool)=>{let $ODi=0,$ODstep=()=>{if(Ba.$ODpool!==$ODpool)return;' +
      'for(let $ODend=Math.min($ODi+50,$ODpool.length);$ODi<$ODend;$ODi++)$ODfirst($ODpool[$ODi]);' +
      'Ba.$ODrefresh?.();if($ODi<$ODpool.length)setTimeout($ODstep)};setTimeout($ODstep)};' +
      'Ba.$ODrefresh=()=>{if($ODseq===Po.current&&Ba.$ODpool)$ODshow(Ba.$ODpool,!0)};' +
      'if(Ba.$ODpool){$ODshow(Ba.$ODpool);return}' +
      'let $ODload=Ba.$ODload??=p().getSessionsForSelector(Ba.workingDirectory)' +
      '.then(($ODall)=>uu.$ODsessionPool($ODall,p().getCurrentSessionId()));' +
      '$ODload.then(($ODpool)=>{if(Ba.$ODload!==$ODload)return;let $ODfresh=Ba.$ODpool!==$ODpool;Ba.$ODpool=$ODpool;' +
      'if($ODseq===Po.current)$ODshow($ODpool);if($ODfresh)$ODscan($ODpool)},' +
      '($ODe)=>{if(Ba.$ODload===$ODload)Ba.$ODload=void 0;h($ODe,"Failed to load sessions for the # picker")})' +
      '},[zi,Ma,Ba,Mt,qt,Zt.status,_e,Pe,U])',
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
