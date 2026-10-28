import { agentPatches } from './agent-patches.ts';
import { askUserPatches } from './askuser-patches.ts';
import { compactionPatches } from './compaction-patches.ts';
import { denylistPatches } from './denylist-patches.ts';
import { footerPatches } from './footer-patches.ts';
import { logoPatches } from './logo.ts';
import { mcpIdlePatches } from './mcp-idle-patches.ts';
import { sessionPatches } from './session-patches.ts';
import { shieldPatches } from './shield-patches.ts';
import { subagentSoundPatches } from './subagent-sound-patches.ts';
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

export const NO_PAINT_FALLBACK_MS = 2500;

const MARK_PAINTED =
  'if(!globalThis.$ODpainted)globalThis.$ODpainted=!0,' +
  'setTimeout(()=>{for(let $ODgo of globalThis.$ODafterPaint?.splice(0)??[])$ODgo()},0)';

const SHELL_FRAME_WRITE = `n=r.write(\`\${je.SYNC_OUTPUT_START}\${t}\${e}\${je.SYNC_OUTPUT_END}\`);`;

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'timeoutMs:n=150}={}){if(f)return;',
    replace: 'timeoutMs:n=30}={}){if(f)return;',
  },
  {
    name: 'shutdown-flush-deadline',
    find: 'var x=3000,H=2000,M=1e4,R=1000,A=250',
    replace: 'var x=3000,H=2000,M=1e4,R=10,A=250',
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
    lookups: ['return yt(a)==="gpt-6-astra"}'],
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
    find: 's={ambiguousAsWide:!e};for(let{segment:u}of W.segment(o)){if(I(u))continue;if(x.test(u)){r+=2;continue}let f=D(u).codePointAt(0);r+=v0(f,s),r+=P(u,s)}return r}var Z=8,',
    lookups: [
      'function HB(n,i={}){if(typeof n!=="string"||n.length===0)return 0;let{ambiguousIsNarrow:e=',
    ],
    replace:
      's={ambiguousAsWide:!e},$ODcells=e?(HB.$n??=new Map):(HB.$w??=new Map);for(let{segment:u}of W.segment(o)){let $ODw=$ODcells.get(u);if($ODw===void 0){if(I(u))$ODw=0;else if(x.test(u))$ODw=2;else{let f=D(u).codePointAt(0);$ODw=v0(f,s)+P(u,s)}if($ODcells.size<2e4)$ODcells.set(u,$ODw)}r+=$ODw}return r}var Z=8,',
  },
  ...footerPatches,
  ...subagentSoundPatches,
  ...updateNoticePatches,
  {
    name: 'command-menu-prefix-first',
    find: 'if(m&&d)return 1;if(m)return 2;if(d)return 3;return 4}',
    replace: 'if(d)return m?1:2;if(m)return 3;return 4}',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0;' +
      'let $ODgen=this.$ODgen=(this.$ODgen??0)+1,$ODdone=!1,' +
      '$ODgo=()=>{if($ODdone||this.$ODgen!==$ODgen)return;$ODdone=!0,this.$ODwatch()};' +
      'if(globalThis.$ODpainted)return $ODgo();' +
      `(globalThis.$ODafterPaint??=[]).push($ODgo),setTimeout($ODgo,${NO_PAINT_FALLBACK_MS}).unref?.()}` +
      '$ODwatch(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'settings-watch-after-paint-shell',
    find: `${SHELL_FRAME_WRITE}if(d=!1,s=0,m=!0,`,
    replace: `${SHELL_FRAME_WRITE}${MARK_PAINTED};if(d=!1,s=0,m=!0,`,
  },
  {
    name: 'settings-watch-after-paint-ink',
    find: 'renderInteractiveFrame(e,i,l,r){let E=l!=="",',
    replace: `renderInteractiveFrame(e,i,l,r){if(this.options.stdout===process.stdout)${MARK_PAINTED};let E=l!=="",`,
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
    find: 'if(this.refreshMcpListeners(),!this.isBlockOnMcpLoadEnabled())return;',
    replace:
      'this.refreshMcpListeners();' +
      'if(this.ideInitPromise){let $ODtimer;await Promise.race([this.ideInitPromise.catch(()=>{}),new Promise(($ODdone)=>{$ODtimer=setTimeout($ODdone,5000);$ODtimer.unref?.()})]);clearTimeout($ODtimer)}' +
      'if(!this.isBlockOnMcpLoadEnabled())return;',
  },
  {
    name: 'new-session-loads-in-background',
    find: '{title:ke.title}:{},...at});return await Cu(Sn),Sn}',
    replace:
      '{title:ke.title}:{},...at});if(ke?.missionV2)return await Cu(Sn),Sn;return Cu(Sn),Sn}',
  },
  {
    name: 'session-load-keeps-pending-settings',
    find: 'return await pt.loadSession({sessionId:dt}),De.current=dt,ot.current.delete(dt),ae.emit(',
    lookups: [
      '.notify("settings_updated")}function c4(',
      'r("[Daemon] Daemon disconnected",{code:',
    ],
    replace:
      'await pt.loadSession({sessionId:dt}),De.current=dt;let $ODs=ot.current.get(dt);if(ot.current.delete(dt),$ODs&&c4($ODs))try{await pt.updateSessionSettings({sessionId:dt,...$ODs})}catch($ODx){r("[Daemon] Failed to sync pending session settings",{cause:$ODx})}return ae.emit(',
  },
  {
    name: 'session-load-reads-loaded-settings',
    find: 'U=await t.loadSession(e.sessionId,x),H=Number(',
    lookups: [
      'zi=me({name:"SessionController",lifecycle:"agent",create:()=>new se});function _n(){let Wz=_e(zi);',
      'getCustomModels(){return C().getCustomModels()}',
    ],
    replace: 'U=(_e(zi)&&await C().initialize(),await t.loadSession(e.sessionId,x)),H=Number(',
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
      'ko=oo??Oe.current,tr=ko??await Wn(Ln());if(pt)return"rejected_with_notice";if(!tr)return Vn(),"rejected_with_notice";' +
      'let er=dt.message,Ir=Dt.getSessionStateManager(),Po=Ir.getSessionManager(tr),',
    lookups: [
      'fr=l0(dt.queuePlacement);if(Lo&&fr==="end_of_turn"){let Er=dk({text:er,images:$He(dt.images)})',
      'an=m().getCurrentSessionId(),Bt=dt.draft',
      'lt=dt.requestId??Zt?.requestId??st(),ln=dt.messageId??Zt?.messageId??st(),qn,fo=!1,zn,Gn=!1,Wt=()=>{',
    ],
    replace:
      'ko=oo??Oe.current,$ODe=null;if(!ko&&l0(dt.queuePlacement)==="end_of_turn"){' +
      'let $ODm=an?Dt.getSessionStateManager().getSessionManager(an):null;' +
      'if($ODm&&$ODm.getDroidWorkingState()==="idle"){let $ODi=$ODm.getStore().getInteractionMode();' +
      '$ODm.addOptimisticMessage(lt,{id:ln,role:dt.role??"user",content:dk({text:dt.message,images:$He(dt.images)}),' +
      'createdAt:Date.now(),updatedAt:Date.now(),...$ODi&&{interactionMode:$ODi},...dt.visibility&&{visibility:dt.visibility}}),' +
      '$ODm.setThinking(),$ODe=$ODm,qn={remove:()=>{$ODm.removeOptimisticMessage(lt);' +
      'if($ODm.getDroidWorkingState()==="thinking")$ODm.stopStreaming()},isConfirmed:()=>$ODm.getOptimisticMessage(lt)===void 0}}}' +
      'let tr=ko??await Wn(Ln());if(pt)return"rejected_with_notice";if(!tr)return Vn(),"rejected_with_notice";' +
      'let er=dt.message,Ir=Dt.getSessionStateManager(),Po=Ir.getSessionManager(tr);if($ODe&&$ODe!==Po)Wt(),qn=void 0;let ',
  },
  {
    name: 'live-reply-shows-every-line',
    find: 'if(N===void 0)return O;return t(c1e,{maxRows:N,children:O})});TF.displayName="DynamicMessageList";',
    replace: 'return O});TF.displayName="DynamicMessageList";',
  },
  {
    name: 'escape-keeps-turn-running',
    find: 'if(Ss!=="idle"||JC)return V3(),!0;return!1};return Pr.subscribe(Ee,{layer:4})',
    replace: 'if(Ss!=="idle"||JC)return!0;return!1};return Pr.subscribe(Ee,{layer:4})',
  },
  {
    name: 'no-escape-stop-hint',
    find: '"(Please wait)":"(Press ESC to stop)"}',
    replace: '"(Please wait)":""}',
  },
  {
    name: 'rewind-stops-running-turn',
    find: 'if(lo&&lo.getDroidWorkingState()!=="idle")return!1}catch(Ct){n("[App] Failed to read session state for rewind gate"',
    lookups: ['lL=g(async()=>{let ke=Eo?eu(Eo)?.getQueuedMessages()'],
    replace:
      'if(lo&&lo.getDroidWorkingState()!=="idle"&&(await lL(),lo.getDroidWorkingState()!=="idle"))return!1}catch(Ct){n("[App] Failed to read session state for rewind gate"',
  },
  {
    name: 'rewind-sees-current-stop',
    find: 'return yr.openPane({kind:"rewind",payload:{options:rt}}),!0},[wi,yr,it,sr,kn,bx,Vn]);',
    lookups: ['lL=g(async()=>{let ke=Eo?eu(Eo)?.getQueuedMessages()'],
    replace:
      'return yr.openPane({kind:"rewind",payload:{options:rt}}),!0},[wi,yr,it,sr,kn,bx,Vn,lL]);',
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
  ...agentPatches,
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
