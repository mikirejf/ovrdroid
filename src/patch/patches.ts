import { OVRDROID_UNDER_HOME } from '../paths.ts';
import { CACHE_CLOCK_GLOBAL, CACHE_TTL_MS } from './cache-clock.ts';
import { denylistPatches } from './denylist-patches.ts';
import { logoPatches } from './logo.ts';
import { mcpIdlePatches } from './mcp-idle-patches.ts';
import { usagePatches } from './usage-patches.ts';
import { warmerPatches } from './warmer-patches.ts';

export interface Patch {
  name: string;
  find: string;
  until?: string;
  replace: string;
}

const MARKER_PREFIX = 'globalThis.__ovrdroid="';
const DIGEST_LENGTH = 12;
const DIGEST_PATTERN = /^[0-9a-f]+$/u;

export const CONSTRUCTOR_BINDS: readonly string[] = [
  'parse',
  'safeParse',
  'parseAsync',
  'safeParseAsync',
  'spa',
  'refine',
  'refinement',
  'superRefine',
  'optional',
  'nullable',
  'nullish',
  'array',
  'promise',
  'or',
  'and',
  'transform',
  'brand',
  'default',
  'catch',
  'describe',
  'pipe',
  'readonly',
  'isNullable',
  'isOptional',
];

export const LAZY_METHODS: readonly string[] = CONSTRUCTOR_BINDS.filter((name) => name !== 'spa');

const STANDARD_SCHEMA =
  'this["~standard"]={version:1,vendor:"zod",validate:(r)=>this["~validate"](r)}';

const OWN_METHOD =
  'A=(e,K,G)=>(Object.defineProperty(e,K,{value:G,writable:!0,enumerable:!0,configurable:!0}),G)';

const LAZY_GET = 'get(){return Object.hasOwn(this,"_def")?A(this,K,B.bind(this)):B}';

const LAZY_SET = 'set(G){Object.hasOwn(this,"_def")?A(this,K,G):W(this,K,G)}';

const LAZY_ACCESSORS = `static{let P=this.prototype,${OWN_METHOD},W=(e,K,B)=>Object.defineProperty(e,K,{configurable:!0,${LAZY_GET},${LAZY_SET}});${JSON.stringify(LAZY_METHODS)}.forEach((K)=>W(P,K,P[K])),W(P,"spa",P.safeParseAsync)}`;

const TURN_CLOCK_STATE =
  '$ODc={session:null,sent:0,done:0,busy:!1},' +
  '$ODa=(T)=>{let R=Math.floor(T/6e4);if(R<1)return"<1m";if(R<60)return R+"m";' +
  'let H=Math.floor(R/60);if(H<24)return H+"h";return Math.floor(H/24)+"d"},' +
  '$ODt=(S)=>{try{return L().getSessionStateManager().getSessionManager(S)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TICK =
  `let $last=Math.max($ODc.sent,$ODc.done),$cat=${CACHE_CLOCK_GLOBAL}?.get(F)?.at??0,$exp=$cat&&$cat+${CACHE_TTL_MS},` +
  '$now=$last||$cat?Date.now():0,[$t,$re]=A(0);' +
  'v(()=>{let $n=Date.now(),$w=1/0;' +
  'if($last){let $age=$n-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5;$w=$step-$age%$step}' +
  'if($cat&&$exp>$n)$w=Math.min($w,($exp-$n)%6e4+1);' +
  'if($w===1/0)return;' +
  'let $id=setTimeout(()=>$re((V)=>V+1),$w);' +
  'return()=>clearTimeout($id)},[$last,$cat,$t]);';

const TURN_CLOCK_TRACK =
  'let $busy=B!=="idle";' +
  'if($ODc.session!==F)$ODc.session=F,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(F):$ODc.done=$ODt(F);';

const TURN_CLOCK_PARTS =
  'let $ago=[];if($last||$cat){' +
  'if($ODc.sent)$ago.push(rt("\\u2191"+$ODa($now-$ODc.sent),{color:o.text.muted}));' +
  'if($ODc.done)$ago.push(rt(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:o.text.muted}));' +
  'if($cat){let $rem=$exp-$now;if($ago.length)$ago.push(rt(", ",{color:o.text.muted}));' +
  `$ago.push($rem>0?rt("cache "+$ODa(Math.min($rem,${CACHE_TTL_MS - 1})),{color:o.text.muted}):rt("cache cold",{color:o.warning}))}}` +
  'if($ago.length){let $f=fe||"[]",$i=$f.indexOf(",");if($i<0)$i=$f.length-1;' +
  'sd(Ie,[rt($f.slice(0,$i)+(fe?", ":""),{color:o.text.muted}),...$ago,rt($f.slice($i),{color:o.text.muted})]," ")}' +
  'else if(fe)sd(Ie,[rt(fe,{color:o.text.muted})]," ");';

const UPDATE_FILE_NAME = 'update.json';

const UPDATE_FILE_WRITER_NAME = '$ODw';

const UPDATE_FILE_READER_NAME = '$ODr';

const UPDATE_LOCAL = '$ODv';

const UPDATE_FILE_PATH = `require("os").homedir()+${JSON.stringify(`/${OVRDROID_UNDER_HOME}/${UPDATE_FILE_NAME}`)}`;

const UPDATE_FILE_WRITER =
  `function ${UPDATE_FILE_WRITER_NAME}(V){` +
  `try{let F=require("fs"),P=${UPDATE_FILE_PATH};` +
  'if(V===null)F.rmSync(P,{force:!0});' +
  'else F.mkdirSync(require("path").dirname(P),{recursive:!0}),F.writeFileSync(P,JSON.stringify({version:V}))}catch{}}';

const UPDATE_FILE_READER =
  `function ${UPDATE_FILE_READER_NAME}(){` +
  `try{let V=JSON.parse(require("fs").readFileSync(${UPDATE_FILE_PATH},"utf8")).version;` +
  'return typeof V==="string"&&V!==Hs()?V:null}catch{return null}}';

const UPDATE_HEADER_LINE =
  `if(${UPDATE_LOCAL}){` +
  `let $x="\\u2193 v"+${UPDATE_LOCAL}+" available \\xB7 run: ovrdroid update";` +
  `b(f,L,M($x),$x,{color:o.warning,bold:!0}),L+=2}`;

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'timeoutMs:a=150}={}){if(p)return i;',
    replace: 'timeoutMs:a=30}={}){if(p)return i;',
  },
  {
    name: 'certificate-count-skip',
    find: 'async function mt(){let r=await B(),t=await M(r);',
    replace: 'async function mt(){let r=null,t=await M(r);',
  },
  {
    name: 'shutdown-flush-deadline',
    find: 'M=1e4,R=1000,',
    replace: 'M=1e4,R=10,',
  },
  {
    name: 'git-ai-archive-skip',
    find: 'async archiveRetiredGitAiSessions(){try{',
    replace: 'async archiveRetiredGitAiSessions(){return;try{',
  },
  {
    name: 'session-index-atomic-save',
    find: 'ss.writeFileSync(this.cachePath,JSON.stringify(this.state,null,2)),tT(this.cachePath)',
    replace:
      'let o=this.cachePath+"."+process.pid+".tmp";try{ss.writeFileSync(o,JSON.stringify(this.state,null,2)),tT(o),ss.renameSync(o,this.cachePath)}finally{ss.rmSync(o,{force:!0})}',
  },
  {
    name: 'session-index-heal-unreadable',
    find: 'this.state=om(this.sessionsDir),this.loadFailed=!0}',
    replace: 'this.state=om(this.sessionsDir)}',
  },
  {
    name: 'zod-v3-lazy-bound-methods',
    find: `constructor(t){this.spa=this.safeParseAsync,this._def=t,${CONSTRUCTOR_BINDS.map(
      (name) => `this.${name}=this.${name}.bind(this),`,
    ).join('')}${STANDARD_SCHEMA}`,
    replace: `${LAZY_ACCESSORS}constructor(t){this._def=t,${STANDARD_SCHEMA}`,
  },
  {
    name: 'model-alias-lookup-set',
    find: 'if(o in In)return o;if(Object.values(In).includes(o))return o;return}',
    replace:
      'if(o in In)return o;if((gt.$o!==In&&(gt.$o=In,gt.$s=new Set(Object.values(In))),gt.$s).has(o))return o;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:p}of QD.segment(C)){if(FD(p))continue;if(mD.test(p)){D+=2;continue}let N=yD(p).codePointAt(0);D+=v0(N,d),D+=SD(p,d)}if(B)ar(n,D);return D}',
    replace:
      'let $m=l?Jn.$n:Jn.$w;for(let{segment:p}of QD.segment(C)){let $c=$m.get(p);if($c===void 0){if(FD(p))$c=0;else if(mD.test(p))$c=2;else{let N=yD(p).codePointAt(0);$c=v0(N,d)+SD(p,d)}if($m.size<2e4)$m.set(p,$c)}D+=$c}if(B)ar(n,D);return D}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'mD=/^\\p{RGI_Emoji}$/v;function ir(n){',
    replace: 'mD=/^\\p{RGI_Emoji}$/v;Jn.$n=new Map;Jn.$w=new Map;function ir(n){',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 's={ambiguousAsWide:!e};for(let{segment:u}of W.segment(o)){if(I(u))continue;if(x.test(u)){r+=2;continue}let f=D(u).codePointAt(0);r+=v0(f,s),r+=P(u,s)}return r}',
    replace:
      's={ambiguousAsWide:!e},$m=e?HB.$n:HB.$w;for(let{segment:u}of W.segment(o)){let $c=$m.get(u);if($c===void 0){if(I(u))$c=0;else if(x.test(u))$c=2;else{let f=D(u).codePointAt(0);$c=v0(f,s)+P(u,s)}if($m.size<2e4)$m.set(u,$c)}r+=$c}return r}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: 'x=/^\\p{RGI_Emoji}$/v;function D(n){',
    replace: 'x=/^\\p{RGI_Emoji}$/v;HB.$n=new Map;HB.$w=new Map;function D(n){',
  },
  {
    name: 'turn-clock-state',
    find: 'var Jce=new Set(["thinking","streaming","compressing","executing_tool"]),eue="\\uF418",',
    replace: `var ${TURN_CLOCK_STATE},Jce=new Set(["thinking","streaming","compressing","executing_tool"]),eue="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:de,updateNoticeDisplay:me}){let fe=rue(',
    replace: `isSessionArchived:de,updateNoticeDisplay:me}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let fe=rue(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'if(fe)sd(Ie,[rt(fe,{color:o.text.muted})]," ");',
    replace: TURN_CLOCK_PARTS,
  },
  {
    name: 'auto-update-notice-only',
    find: 'if(!f)return l(u,"no-update"),"no-update";if(f.isRollback){',
    replace:
      `if(!f)return ${UPDATE_FILE_WRITER_NAME}(null),l(u,"no-update"),"no-update";` +
      `return ${UPDATE_FILE_WRITER_NAME}(f.version.version),` +
      'T("Auto-update blocked by ovrdroid; run: ovrdroid update",{version:f.version.version}),' +
      'l(u,"skipped"),"skipped";if(f.isRollback){',
  },
  {
    name: 'update-notice-writer',
    find: 'function F(){return V4(bne)}',
    replace: `${UPDATE_FILE_WRITER}function F(){return V4(bne)}`,
  },
  {
    name: 'update-notice-reader',
    find: 'function $D({width:t,height:e,t:n}){',
    replace: `${UPDATE_FILE_READER}function $D({width:t,height:e,t:n}){`,
  },
  {
    name: 'update-notice-header-room',
    find: 'y=!oe().isProductionTier,E=Hs(),C=!d&&!!E,T=g.length+2+(y?1:0)+(C?2:0)+5,',
    replace:
      `y=!oe().isProductionTier,E=Hs(),C=!d&&!!E,${UPDATE_LOCAL}=${UPDATE_FILE_READER_NAME}(),` +
      `T=g.length+2+(y?1:0)+(C?2:0)+(${UPDATE_LOCAL}?2:0)+5,`,
  },
  {
    name: 'update-notice-header-line',
    find: 'b(f,L,M(q),q,l),L+=2;',
    replace: `${UPDATE_HEADER_LINE}b(f,L,M(q),q,l),L+=2;`,
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(m&&d)return 1;if(m)return 2;if(d)return 3;return 4}',
    replace: 'if(d)return m?1:2;if(m)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function fT(a){let t=o();if(t.snapshot.status===a.status',
    replace:
      'function fT(a){if(a.status==="ready")ei.$done=!0;let t=o();if(t.snapshot.status===a.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:Uo.status==="refreshing"}',
    replace: 'isLoading:Uo.status==="refreshing"&&!ei.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'vo=f((_n)=>{Pt({showCommands:_n}),Do(_n)},[Pt])',
    replace: 'vo=f((_n)=>{Pt({showCommands:_n}),Do(_n),Ke?.(_n)},[Pt,Ke])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'v(()=>{Ke?.(mo)},[mo,Ke]);',
    replace: 'v(()=>()=>{Ke?.(!1)},[Ke]);',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let N=f(()=>{_({type:"draft-edited"})},[]);return{display:P,dismissAfterDraftEdit:N}',
    replace:
      'let $r=O(P);$r.current=P;let N=f(()=>{let $s=$r.current;if($s.notice.kind==="hidden"||$s.dismissed)return;_({type:"draft-edited"})},[]);return{display:P,dismissAfterDraftEdit:N}',
  },
  {
    name: 'web-fetch-always-loaded',
    find: 'Factory wiki URLs.`,executionLocation:"server",inputSchema:Z,isVisibleToUser:!0,isTopLevelTool:!0,requiresConfirmation:!1,sideEffects:["network"],outputSchemas:{result:O},toolkit:"Web Search",deferred:!0',
    replace:
      'Factory wiki URLs.`,executionLocation:"server",inputSchema:Z,isVisibleToUser:!0,isTopLevelTool:!0,requiresConfirmation:!1,sideEffects:["network"],outputSchemas:{result:O},toolkit:"Web Search",deferred:!1',
  },
  {
    name: 'web-search-always-loaded',
    find: 'outputSchemas:{result:X},toolkit:"Web Search",deferred:!0,isToolEnabled:!0}',
    replace: 'outputSchemas:{result:X},toolkit:"Web Search",deferred:!1,isToolEnabled:!0}',
  },
  {
    name: 'gate-first-turn-on-ide-connect',
    find: 'awaitMcpReadinessBeforeAgentTurnIfEnabled(){if(this.refreshMcpListeners(),!this.isBlockOnMcpLoadEnabled())return;',
    replace:
      'awaitMcpReadinessBeforeAgentTurnIfEnabled(){this.refreshMcpListeners();' +
      'if(this.ideInitPromise){let $t;await Promise.race([this.ideInitPromise.catch(()=>{}),new Promise((r)=>{$t=setTimeout(r,5000);$t.unref?.()})]);clearTimeout($t)}' +
      'if(!this.isBlockOnMcpLoadEnabled())return;',
  },
  {
    name: 'slash-command-keeps-typed-input',
    find: 'let Dn=Po.slice(1),Gn=await vn.execute(Dn,gi);if(Gn.handled){if(typeof Gn.insertText==="string")return wi(Gn.insertText),"accepted";wi("");',
    replace:
      'let Dn=Po.slice(1),$ODi=Is.current,Gn=await vn.execute(Dn,gi);if(Gn.handled){if(typeof Gn.insertText==="string")return wi(Gn.insertText),"accepted";if(Is.current===$ODi)wi("");',
  },
  {
    name: 'new-session-loads-in-background',
    find: 'if(De?.missionV2)await ft().startPlanning(gt);return await wc(gt),gt}',
    replace:
      'if(De?.missionV2)return await ft().startPlanning(gt),await wc(gt),gt;return wc(gt),gt}',
  },
  {
    name: 'session-load-keeps-pending-settings',
    find: 'Le.current=_t;return await wt.loadSession({sessionId:Bt}),be.current=Bt,je.current={},Y.emit(',
    replace:
      'Le.current=_t;await wt.loadSession({sessionId:Bt}),be.current=Bt;let $ODs=je.current;if(je.current={},wM($ODs))try{await wt.updateSessionSettings({sessionId:Bt,...$ODs})}catch($ODx){n("[useDaemonAgent] Failed to sync pending session settings",{cause:$ODx})}return Y.emit(',
  },
  {
    name: 'session-load-reads-loaded-settings',
    find: 'A=await t.loadSession(e.sessionId,k),O=Number(',
    replace: 'A=(we()&&await C().initialize(),await t.loadSession(e.sessionId,k)),O=Number(',
  },
  {
    name: 'session-worker-starts-mcp-in-background',
    find: 'if(!(e.listTools===!0||e.inputFormat==="stream-json"||t.blockOnMcpLoad||Zi(e))){t.startBackgroundTask("mcp_init",t.startMcp);return}',
    replace:
      'if(!(e.listTools===!0||e.inputFormat==="stream-json"||(t.blockOnMcpLoad&&e.inputFormat!=="stream-jsonrpc")||Zi(e))){t.startBackgroundTask("mcp_init",t.startMcp);return}',
  },
  {
    name: 'first-message-shows-at-once',
    find:
      'Gt=f(async(Bt)=>{let Lo=L(),_t=(Me.current||Ee.current?null:be.current)??await Dt();if(!_t)return"rejected_with_notice";' +
      'let To=Bt.message,mo=Bt.requestId??xe(),Do=Bt.messageId??xe(),Wo=Lo.getSessionStateManager().getSessionManager(_t),' +
      'yn=Wo?.getDroidWorkingState()==="idle",Pt=ho(Bt.queuePlacement),Ot=yn&&Pt==="end_of_turn";if(Ot){',
    replace:
      'Gt=f(async(Bt)=>{let Lo=L(),$ODn=Me.current||Ee.current?null:be.current,To=Bt.message,mo=Bt.requestId??xe(),' +
      'Do=Bt.messageId??xe(),Pt=ho(Bt.queuePlacement),$ODe=null;if(!$ODn&&Pt==="end_of_turn"){' +
      'let $ODk=p().getCurrentSessionId(),$ODm=$ODk?Lo.getSessionStateManager().getSessionManager($ODk):null;' +
      'if($ODm&&$ODm.getDroidWorkingState()==="idle"){let $ODi=$ODm.getStore().getInteractionMode();' +
      '$ODm.addOptimisticMessage(mo,{id:Do,role:Bt.role??"user",content:eR({text:To,images:Kz(Bt.images)}),' +
      'createdAt:Date.now(),updatedAt:Date.now(),...$ODi&&{interactionMode:$ODi},...Bt.visibility&&{visibility:Bt.visibility}}),' +
      '$ODm.setThinking(),$ODm.$ODr=mo,$ODm.$ODc=!1,$ODe=$ODm}}' +
      'let $ODu=()=>{if(!$ODe)return;$ODe.$ODr=null;$ODe.removeOptimisticMessage(mo);' +
      'if($ODe.getDroidWorkingState()==="thinking")$ODe.stopStreaming();$ODe=null},' +
      '_t=$ODn??await Dt();if($ODe){let $ODx=$ODe.$ODc;$ODe.$ODr=null,$ODe.$ODc=!1;if($ODx)return $ODe=null,"accepted"}' +
      'if(!_t)return $ODu(),"rejected_with_notice";' +
      'let Wo=Lo.getSessionStateManager().getSessionManager(_t);if($ODe!==Wo)$ODu();' +
      'let yn=Wo?.getDroidWorkingState()==="idle",Ot=yn&&Pt==="end_of_turn";if(Ot){',
  },
  {
    name: 'first-message-shows-at-once-undo',
    find: 'if(Ot&&Wo)Wo.removeOptimisticMessage(mo);return h(bt,"[useDaemonAgent] Failed to send message"),P(EH(bt),{messageType:"text",visibility:"user_only"}),"rejected_with_notice"}},[P,Dt])',
    replace:
      'if(Ot&&Wo)Wo.removeOptimisticMessage(mo);return $ODu(),h(bt,"[useDaemonAgent] Failed to send message"),P(EH(bt),{messageType:"text",visibility:"user_only"}),"rejected_with_notice"}},[P,Dt])',
  },
  {
    name: 'first-message-cancel-before-session',
    find: 'eo=f(()=>{if(We.current)return We.current;let Bt=be.current;if(!Bt)return Promise.resolve();',
    replace:
      'eo=f(()=>{if(We.current)return We.current;let Bt=be.current;if(!Bt){' +
      'let $ODk=p().getCurrentSessionId(),$ODm=$ODk?L().getSessionStateManager().getSessionManager($ODk):null;' +
      'if($ODm?.$ODr){$ODm.removeOptimisticMessage($ODm.$ODr),$ODm.$ODr=null,$ODm.$ODc=!0;' +
      'if($ODm.getDroidWorkingState()==="thinking")$ODm.stopStreaming();' +
      'P(R().t("common:appMessages.requestCancelledByUser"),{messageType:"text",visibility:"user_only"})}' +
      'return Promise.resolve()}',
  },
  {
    name: 'mcp-servers-start-together',
    find: 'for(let[v,b]of A)try{await this.addServer(v,b),',
    until: 'await Promise.all(y.map(async([v,b])=>{',
    replace: 'await Promise.all([...A,...y].map(async([v,b])=>{',
  },
  {
    name: 'subagent-turn-ignores-hook-records',
    find: 'let s=e.slice(o+1),r=s.findIndex(Bb),u=r===-1?s:s.slice(0,r);return yb(u)}',
    replace:
      'let s=e.slice(o+1),r=s.findIndex((a)=>Bb(a)&&a.visibility!=="user_only"),u=r===-1?s:s.slice(0,r);return yb(u)}',
  },
  ...logoPatches,
  ...usagePatches,
  ...warmerPatches,
  ...denylistPatches,
  ...mcpIdlePatches,
];

export function markerDigest(list: readonly Patch[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(
    list
      .map((patch) => `${patch.name}|${patch.find}|${patch.until ?? ''}|${patch.replace}`)
      .join('\n'),
  );
  return hasher.digest('hex').slice(0, 12);
}

export function markerStatement(list: readonly Patch[]): string {
  return `${MARKER_PREFIX}${markerDigest(list)}";\n`;
}

export function findMarker(source: string): string | undefined {
  const at = source.indexOf(MARKER_PREFIX);
  if (at === -1) {
    return undefined;
  }
  const from = at + MARKER_PREFIX.length;
  const digest = source.slice(from, from + DIGEST_LENGTH);
  return source[from + DIGEST_LENGTH] === '"' && DIGEST_PATTERN.test(digest) ? digest : undefined;
}
