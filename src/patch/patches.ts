import { askUserPatches } from './askuser-patches.ts';
import { compactionPatches } from './compaction-patches.ts';
import { denylistPatches } from './denylist-patches.ts';
import { errorPatches } from './error-patches.ts';
import { logoPatches } from './logo.ts';
import { mcpIdlePatches } from './mcp-idle-patches.ts';
import { sessionPatches } from './session-patches.ts';
import { shieldPatches } from './shield-patches.ts';
import { subagentSoundPatches } from './subagent-sound-patches.ts';
import { turnClockPatches } from './turn-clock-patches.ts';
import { updateNoticePatches } from './update-notice-patches.ts';
import { usagePatches } from './usage-patches.ts';
import { warmerPatches } from './warmer-patches.ts';

export interface Patch {
  name: string;
  find: string;
  until?: string;
  lookups?: readonly string[];
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
  '$ODown=($ODo,$ODk,$ODv)=>(Object.defineProperty($ODo,$ODk,{value:$ODv,writable:!0,enumerable:!0,configurable:!0}),$ODv)';

const LAZY_GET =
  'get(){return Object.hasOwn(this,"_def")?$ODown(this,$ODk,$ODfn.bind(this)):$ODfn}';

const LAZY_SET =
  'set($ODv){Object.hasOwn(this,"_def")?$ODown(this,$ODk,$ODv):$ODlazy(this,$ODk,$ODv)}';

const LAZY_ACCESSORS = `static{let $ODp=this.prototype,${OWN_METHOD},$ODlazy=($ODo,$ODk,$ODfn)=>Object.defineProperty($ODo,$ODk,{configurable:!0,${LAZY_GET},${LAZY_SET}});${JSON.stringify(LAZY_METHODS)}.forEach(($ODk)=>$ODlazy($ODp,$ODk,$ODp[$ODk])),$ODlazy($ODp,"spa",$ODp.safeParseAsync)}`;

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'timeoutMs:a=150}={}){if(p)return i;',
    replace: 'timeoutMs:a=30}={}){if(p)return i;',
  },
  {
    name: 'shutdown-flush-deadline',
    find: 'H=2000,M=1e4,R=1000,A=250;',
    replace: 'H=2000,M=1e4,R=10,A=250;',
  },
  {
    name: 'session-index-atomic-save',
    find: 'ss.writeFileSync(this.cachePath,JSON.stringify(this.state,null,2)),tT(this.cachePath)',
    replace:
      'let $ODtmp=this.cachePath+"."+process.pid+".tmp";try{ss.writeFileSync($ODtmp,JSON.stringify(this.state,null,2)),tT($ODtmp),ss.renameSync($ODtmp,this.cachePath)}finally{ss.rmSync($ODtmp,{force:!0})}',
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
    find: 'if(o in Mn)return o;if(Object.values(Mn).includes(o))return o;return}',
    lookups: ['function yt(o,t,i){if(ti(o))return oi(ke[o],t,i);let s=Kt[o];if(s)return s;if(o in'],
    replace:
      'if(o in Mn)return o;if((yt.$o!==Mn&&(yt.$o=Mn,yt.$s=new Set(Object.values(Mn))),yt.$s).has(o))return o;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:p}of QD.segment(C)){if(FD(p))continue;if(mD.test(p)){D+=2;continue}let N=yD(p).codePointAt(0);D+=v0(N,d),D+=SD(p,d)}if(B)ar(n,D);return D}',
    lookups: [
      'function Jn(n,i={}){if(typeof n!=="string"||n.length===0)return 0;let{ambiguousIsNarrow:l=!0,countAnsiEscapeCodes:o=!1}=i;if(ir(n))',
    ],
    replace:
      'let $ODcells=l?(Jn.$n??=new Map):(Jn.$w??=new Map);for(let{segment:p}of QD.segment(C)){let $ODw=$ODcells.get(p);if($ODw===void 0){if(FD(p))$ODw=0;else if(mD.test(p))$ODw=2;else{let N=yD(p).codePointAt(0);$ODw=v0(N,d)+SD(p,d)}if($ODcells.size<2e4)$ODcells.set(p,$ODw)}D+=$ODw}if(B)ar(n,D);return D}',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 's={ambiguousAsWide:!e};for(let{segment:u}of W.segment(o)){if(I(u))continue;if(x.test(u)){r+=2;continue}let f=D(u).codePointAt(0);r+=v0(f,s),r+=P(u,s)}return r}var',
    lookups: [
      'function HB(n,i={}){if(typeof n!=="string"||n.length===0)return 0;let{ambiguousIsNarrow:e=',
    ],
    replace:
      's={ambiguousAsWide:!e},$ODcells=e?(HB.$n??=new Map):(HB.$w??=new Map);for(let{segment:u}of W.segment(o)){let $ODw=$ODcells.get(u);if($ODw===void 0){if(I(u))$ODw=0;else if(x.test(u))$ODw=2;else{let f=D(u).codePointAt(0);$ODw=v0(f,s)+P(u,s)}if($ODcells.size<2e4)$ODcells.set(u,$ODw)}r+=$ODw}return r}var',
  },
  ...turnClockPatches,
  ...subagentSoundPatches,
  ...updateNoticePatches,
  {
    name: 'command-menu-prefix-first',
    find: 'if(m&&d)return 1;if(m)return 2;if(d)return 3;return 4}',
    replace: 'if(d)return m?1:2;if(m)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function fT(a){let t=o();if(t.snapshot.status===a.status',
    lookups: ['}function ei(){return '],
    replace:
      'function fT(a){if(a.status==="ready")ei.$done=!0;let t=o();if(t.snapshot.status===a.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:Uo.status==="refreshing"}',
    lookups: ['(_P,ei,ei),ro='],
    replace: 'isLoading:Uo.status==="refreshing"&&!ei.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'vo=f((_n)=>{Pt({showCommands:_n}),Do(_n)},[Pt])',
    lookups: ['onCommandMenuVisibilityChange:Ke,draftAttachments:'],
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
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ODwatch(),400).unref?.()}$ODwatch(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let N=f(()=>{_({type:"draft-edited"})},[]);return{display:P,dismissAfterDraftEdit:N}',
    lookups: ['O({staticKey:'],
    replace:
      'let $ODref=O(P);$ODref.current=P;let N=f(()=>{let $ODnow=$ODref.current;if($ODnow.notice.kind==="hidden"||$ODnow.dismissed)return;_({type:"draft-edited"})},[]);return{display:P,dismissAfterDraftEdit:N}',
  },
  {
    name: 'web-fetch-always-loaded',
    find: 'toolkit:"Web Search",deferred:!0,isToolEnabled:!0});var de=/^(\\d{4})-(\\d{2})-(\\d{2})$/;',
    replace:
      'toolkit:"Web Search",deferred:!1,isToolEnabled:!0});var de=/^(\\d{4})-(\\d{2})-(\\d{2})$/;',
  },
  {
    name: 'web-search-always-loaded',
    find: 'toolkit:"Web Search",deferred:!0,isToolEnabled:!0});var V_=4;',
    replace: 'toolkit:"Web Search",deferred:!1,isToolEnabled:!0});var V_=4;',
  },
  {
    name: 'gate-first-turn-on-ide-connect',
    find: 'awaitMcpReadinessBeforeAgentTurnIfEnabled(){if(this.refreshMcpListeners(),!this.isBlockOnMcpLoadEnabled())return;',
    replace:
      'awaitMcpReadinessBeforeAgentTurnIfEnabled(){this.refreshMcpListeners();' +
      'if(this.ideInitPromise){let $ODtimer;await Promise.race([this.ideInitPromise.catch(()=>{}),new Promise(($ODdone)=>{$ODtimer=setTimeout($ODdone,5000);$ODtimer.unref?.()})]);clearTimeout($ODtimer)}' +
      'if(!this.isBlockOnMcpLoadEnabled())return;',
  },
  {
    name: 'slash-command-keeps-typed-input',
    find: 'let Dn=Po.slice(1),Gn=await vn.execute(Dn,gi);if(Gn.handled){if(typeof Gn.insertText==="string")return wi(Gn.insertText),"accepted";wi("");',
    lookups: ['ss=O(null),Is=O(_??"")'],
    replace:
      'let Dn=Po.slice(1),$ODi=Is.current,Gn=await vn.execute(Dn,gi);if(Gn.handled){if(typeof Gn.insertText==="string")return wi(Gn.insertText),"accepted";if(Is.current===$ODi)wi("");',
  },
  {
    name: 'new-session-loads-in-background',
    find: 'if(De?.missionV2)await lb(gt);return await wc(gt),gt}',
    replace: 'if(De?.missionV2)return await lb(gt),await wc(gt),gt;return wc(gt),gt}',
  },
  {
    name: 'session-load-keeps-pending-settings',
    find: 'Le.current=_t;return await wt.loadSession({sessionId:Bt}),be.current=Bt,je.current={},Y.emit(',
    lookups: [
      '.notify("settings_updated")}function wM(',
      'n("[useDaemonAgent] Daemon disconnected",{code:',
    ],
    replace:
      'Le.current=_t;await wt.loadSession({sessionId:Bt}),be.current=Bt;let $ODs=je.current;if(je.current={},wM($ODs))try{await wt.updateSessionSettings({sessionId:Bt,...$ODs})}catch($ODx){n("[useDaemonAgent] Failed to sync pending session settings",{cause:$ODx})}return Y.emit(',
  },
  {
    name: 'session-load-reads-loaded-settings',
    find: 'A=await t.loadSession(e.sessionId,k),O=Number(',
    lookups: ['allowAmbientAwsCredentialProviders:()=>we()', 'C().validateModelAccess('],
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
    lookups: ['p().syncSettingsFromDaemon(', '}){return eR({text:', 'images:Kz(Bt.images)'],
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
    lookups: [
      'p().syncSettingsFromDaemon(',
      'L().sendTuiMessage({sessionId:',
      ',"[useDaemonAgent] Failed to create session"),P(',
      'R().t("common:droids.failedToLoadDroids")',
    ],
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
    find: 'for(let[K,oe]of N)await te(K,oe);await Promise.all(z.map(([K,oe])=>te(K,oe)));',
    replace: 'await Promise.all([...N,...z].map(([K,oe])=>te(K,oe)));',
  },
  ...logoPatches,
  ...usagePatches,
  ...warmerPatches,
  ...compactionPatches,
  ...denylistPatches,
  ...mcpIdlePatches,
  ...shieldPatches,
  ...askUserPatches,
  ...sessionPatches,
  ...errorPatches,
];

export function markerDigest(list: readonly Patch[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(
    list
      .map(
        (patch) =>
          `${patch.name}|${patch.find}|${patch.until ?? ''}|${(patch.lookups ?? []).join('|')}|${patch.replace}`,
      )
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
