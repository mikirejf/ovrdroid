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
  'static $ODsessionMatches($ODpool,$ODq,$ODmax){let $ODl=$ODq.toLowerCase(),$ODw=$ODl.split(/\\s+/).filter(Boolean);' +
  'return $ODpool.filter(($ODs)=>$ODw.every(($ODk)=>$ODs.title.toLowerCase().includes($ODk))||$ODs.id.toLowerCase().startsWith($ODl))' +
  '.slice(0,$ODmax)}';

export const SESSION_COMPLETE =
  'static $ODsessionComplete($ODt,$ODc,$ODid){let $ODm=this.$ODsessionQuery($ODt,$ODc);' +
  `if(!$ODm)return{newText:$ODt,newCursorPosition:$ODc};let $ODtag=\`#session-\${$ODid} \`;` +
  'return{newText:$ODt.slice(0,$ODm.start)+$ODtag+$ODt.slice($ODc),newCursorPosition:$ODm.start+$ODtag.length}}';

export const SESSION_ITEMS =
  'static $ODsessionItems($ODrows,$ODwidth){return $ODrows.map(($ODs)=>{let $ODn=$ODs.messageCount,' +
  `$ODmeta=\`\${Mm($ODs.modifiedTime)} \\u00B7 \${$ODn} \${$ODn===1?"message":"messages"}\`,` +
  '$ODtitle=($ODs.title?ZT($ODs.title):R().t("common:sessions.untitled")).replace(/\\s+/g," ").trim();' +
  `return{label:\`\${DB($ODtitle,Math.max(8,$ODwidth-10-$ODmeta.length))}  \${$ODmeta}\`,value:\`#session-\${$ODs.id}\`,$ODsession:$ODs.id}})}`;

const SESSION_STATICS =
  SESSION_QUERY + SESSION_POOL + SESSION_MATCHES + SESSION_COMPLETE + SESSION_ITEMS;

export const SESSION_PROMPT_LINE =
  '- A `#session-<uuid>` tag in a user message names another Droid session. Run `dsx show <uuid>` for its summary and `dsx export <uuid> --no-thinking` for its transcript; without dsx, the transcript is `~/.factory/sessions/*/<uuid>.jsonl` and can be very large, so read it in parts.';

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
    ],
    replace: `static isInPathContext({text:y,cursorPosition:E}){return uu.extractPathQuery({text:y,cursorPosition:E})!==null}${SESSION_STATICS}}`,
  },
  {
    name: 'session-mention-invalidate',
    find: CALLBACK_START,
    lookups: [UU_LOOKUP, PO_LOOKUP, 'Ba=k(()=>new uu(q,co),[q,co])'],
    replace:
      'let vr=wn??zi,Di=$n??Ma,$ODseq=++Po.current;' +
      'if(!uu.$ODsessionQuery(vr,Di))Ba.$ODpool=Ba.$ODload=void 0;if(!_e){',
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
      'let $ODshow=($ODpool)=>{let $ODrows=uu.$ODsessionItems(uu.$ODsessionMatches($ODpool,$ODhash.query,r5),Math.min(U,process.stdout.columns||U));' +
      'En($ODrows),Ro(0),Qt($ODrows.length>0)};' +
      'if(Ba.$ODpool){$ODshow(Ba.$ODpool);return}' +
      'let $ODload=Ba.$ODload??=p().getSessionsForSelector(Ba.workingDirectory)' +
      '.then(($ODall)=>uu.$ODsessionPool($ODall,p().getCurrentSessionId()));' +
      '$ODload.then(($ODpool)=>{if(Ba.$ODload!==$ODload)return;Ba.$ODpool=$ODpool;if($ODseq===Po.current)$ODshow($ODpool)},' +
      '($ODe)=>{if(Ba.$ODload===$ODload)Ba.$ODload=void 0;h($ODe,"Failed to load sessions for the # picker")})' +
      '},[zi,Ma,Ba,Mt,qt,Zt.status,_e,Pe,U])',
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
