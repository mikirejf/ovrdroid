import { OVRDROID_UNDER_HOME } from '../paths.ts';
import { denylistPatches } from './denylist-patches.ts';
import { logoPatches } from './logo.ts';
import { usagePatches } from './usage-patches.ts';

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
  '$ODt=(S)=>{try{return J().getSessionStateManager().getSessionManager(S)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TICK =
  'let $last=Math.max($ODc.sent,$ODc.done),$now=$last?Date.now():0,[$t,$re]=p(0);' +
  'x(()=>{if(!$last)return;' +
  'let $age=Date.now()-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5,' +
  '$id=setTimeout(()=>$re((V)=>V+1),$step-$age%$step);' +
  'return()=>clearTimeout($id)},[$last,$t]);';

const TURN_CLOCK_TRACK =
  'let $busy=_!=="idle";' +
  'if($ODc.session!==U)$ODc.session=U,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(U):$ODc.done=$ODt(U);';

const TURN_CLOCK_PARTS =
  'if($last){let $ago=[];' +
  'if($ODc.sent)$ago.push(nt("\\u2191"+$ODa($now-$ODc.sent),{color:o.text.muted}));' +
  'if($ODc.done)$ago.push(nt(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:o.text.muted}));' +
  'id(Ee,$ago)}';

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
  'return typeof V==="string"&&V!==ks()?V:null}catch{return null}}';

const UPDATE_HEADER_LINE =
  `if(${UPDATE_LOCAL}){` +
  `let $x="\\u2193 v"+${UPDATE_LOCAL}+" available \\xB7 run: ovrdroid update";` +
  `b(m,T,M($x),$x,{color:o.warning,bold:!0}),T+=2}`;

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'timeoutMs:n=150,platform:a="darwin"',
    replace: 'timeoutMs:n=30,platform:a="darwin"',
  },
  {
    name: 'certificate-count-skip',
    find: 'async function mt(){let r=await L(),t=await M(r);',
    replace: 'async function mt(){let r=null,t=await M(r);',
  },
  {
    name: 'shutdown-flush-deadline',
    find: 'M=1e4,A=1000,',
    replace: 'M=1e4,A=10,',
  },
  {
    name: 'session-search-warm-skip',
    find: 'if(!t){let r=C.then(()=>i.startBackgroundStartupOperation(i.phases.SessionSearchWarm,',
    replace:
      'if(!1){let r=C.then(()=>i.startBackgroundStartupOperation(i.phases.SessionSearchWarm,',
  },
  {
    name: 'git-ai-archive-skip',
    find: 'async archiveRetiredGitAiSessions(){try{',
    replace: 'async archiveRetiredGitAiSessions(){return;try{',
  },
  {
    name: 'session-index-atomic-save',
    find: 'kn.writeFileSync(this.cachePath,JSON.stringify(this.state,null,2)),Xs(this.cachePath)',
    replace:
      'let o=this.cachePath+"."+process.pid+".tmp";try{kn.writeFileSync(o,JSON.stringify(this.state,null,2)),Xs(o),kn.renameSync(o,this.cachePath)}finally{kn.rmSync(o,{force:!0})}',
  },
  {
    name: 'session-index-heal-unreadable',
    find: 'this.state=xf(this.sessionsDir),this.loadFailed=!0}',
    replace: 'this.state=xf(this.sessionsDir)}',
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
    find: 'if(o in Fn)return o;if(Object.values(Fn).includes(o))return o;return}',
    replace:
      'if(o in Fn)return o;if((ut.$o!==Fn&&(ut.$o=Fn,ut.$s=new Set(Object.values(Fn))),ut.$s).has(o))return o;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:y}of dD.segment(I)){if(GD(y))continue;if(yD.test(y)){m+=2;continue}let R=RD(y).codePointAt(0);m+=Pl(R,h),m+=vD(y,h)}if(B)Er(e,m);return m}',
    replace:
      'let $m=a?Yn.$n:Yn.$w;for(let{segment:y}of dD.segment(I)){let $c=$m.get(y);if($c===void 0){if(GD(y))$c=0;else if(yD.test(y))$c=2;else{let R=RD(y).codePointAt(0);$c=Pl(R,h)+vD(y,h)}if($m.size<2e4)$m.set(y,$c)}m+=$c}if(B)Er(e,m);return m}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'yD=/^\\p{RGI_Emoji}$/v;function gr(e){',
    replace: 'yD=/^\\p{RGI_Emoji}$/v;Yn.$n=new Map;Yn.$w=new Map;function gr(e){',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 'for(let{segment:u}of W.segment(o)){if(I(u))continue;if(x.test(u)){r+=2;continue}let f=D(u).codePointAt(0);r+=Pl(f,s),r+=P(u,s)}return r}',
    replace:
      'let $m=e?Uk.$n:Uk.$w;for(let{segment:u}of W.segment(o)){let $c=$m.get(u);if($c===void 0){if(I(u))$c=0;else if(x.test(u))$c=2;else{let f=D(u).codePointAt(0);$c=Pl(f,s)+P(u,s)}if($m.size<2e4)$m.set(u,$c)}r+=$c}return r}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: 'x=/^\\p{RGI_Emoji}$/v;function D(n){',
    replace: 'x=/^\\p{RGI_Emoji}$/v;Uk.$n=new Map;Uk.$w=new Map;function D(n){',
  },
  {
    name: 'turn-clock-state',
    find: 'var qme=new Set(["thinking","streaming","compressing","executing_tool"]),Gme="\\uF418",',
    replace: `var ${TURN_CLOCK_STATE},qme=new Set(["thinking","streaming","compressing","executing_tool"]),Gme="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:ue,updateNoticeDisplay:de}){let me=Qme(',
    replace: `isSessionArchived:ue,updateNoticeDisplay:de}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let me=Qme(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'let be=OQ(K);if(be)id(Ee,[nt(be,{color:o.primary})]);let Me=[];',
    replace: `let be=OQ(K);if(be)id(Ee,[nt(be,{color:o.primary})]);${TURN_CLOCK_PARTS}let Me=[];`,
  },
  {
    name: 'auto-update-notice-only',
    find: 'if(!g)return s(u,"no-update"),"no-update";if(g.isRollback){',
    replace:
      `if(!g)return ${UPDATE_FILE_WRITER_NAME}(null),s(u,"no-update"),"no-update";` +
      `return ${UPDATE_FILE_WRITER_NAME}(g.version.version),` +
      'l("Auto-update blocked by ovrdroid; run: ovrdroid update",{version:g.version.version}),' +
      's(u,"skipped"),"skipped";if(g.isRollback){',
  },
  {
    name: 'update-notice-writer',
    find: 'function F(){return $8(uee)}',
    replace: `${UPDATE_FILE_WRITER}function F(){return $8(uee)}`,
  },
  {
    name: 'update-notice-reader',
    find: 'function zI({width:t,height:e,t:n}){',
    replace: `${UPDATE_FILE_READER}function zI({width:t,height:e,t:n}){`,
  },
  {
    name: 'update-notice-header-room',
    find: 'L=!Te().isProductionTier,E=ks(),C=!h&&!!E,R=x.length+2+(L?1:0)+(C?2:0)+5,',
    replace:
      `L=!Te().isProductionTier,E=ks(),C=!h&&!!E,${UPDATE_LOCAL}=${UPDATE_FILE_READER_NAME}(),` +
      `R=x.length+2+(L?1:0)+(C?2:0)+(${UPDATE_LOCAL}?2:0)+5,`,
  },
  {
    name: 'update-notice-header-line',
    find: 'b(m,T,M(q),q,l),T+=2;',
    replace: `${UPDATE_HEADER_LINE}b(m,T,M(q),q,l),T+=2;`,
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(ue&&de)return 1;if(ue)return 2;if(de)return 3;return 4}',
    replace: 'if(de)return ue?1:2;if(ue)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function f0(a){let t=o();if(t.snapshot.status===a.status',
    replace:
      'function f0(a){if(a.status==="ready")Ui.$done=!0;let t=o();if(t.snapshot.status===a.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:$o.status==="refreshing"}',
    replace: 'isLoading:$o.status==="refreshing"&&!Ui.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'To=f((zn)=>{Nt({showCommands:zn}),po(zn)},[Nt])',
    replace: 'To=f((zn)=>{Nt({showCommands:zn}),po(zn),Ge?.(zn)},[Nt,Ge])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'x(()=>{Ge?.(mo)},[mo,Ge]);',
    replace: 'x(()=>()=>{Ge?.(!1)},[Ge]);',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let v=f(()=>{S({type:"draft-edited"})},[]);return{display:b,dismissAfterDraftEdit:v}',
    replace:
      'let $r=O(b);$r.current=b;let v=f(()=>{let $s=$r.current;if($s.notice.kind==="hidden"||$s.dismissed)return;S({type:"draft-edited"})},[]);return{display:b,dismissAfterDraftEdit:v}',
  },
  {
    name: 'web-fetch-always-loaded',
    find: 'outputSchemas:{result:M},toolkit:"Web Search",deferred:!0,isToolEnabled:!0}',
    replace: 'outputSchemas:{result:M},toolkit:"Web Search",deferred:!1,isToolEnabled:!0}',
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
    name: 'mcp-gate-timeout-15s',
    find: 'Ot=60000;function _t(){let e=Ci("FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS")',
    replace: 'Ot=15000;function _t(){let e=Ci("FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS")',
  },
  {
    name: 'slash-command-keeps-typed-input',
    find: 'let Pn=No.slice(1),cr=await Dn.execute(Pn,Rs);if(cr.handled){if(typeof cr.insertText==="string")return Ti(cr.insertText),"accepted";Ti("");',
    replace:
      'let Pn=No.slice(1),$ODi=kr.current,cr=await Dn.execute(Pn,Rs);if(cr.handled){if(typeof cr.insertText==="string")return Ti(cr.insertText),"accepted";if(kr.current===$ODi)Ti("");',
  },
  {
    name: 'new-session-loads-in-background',
    find: 'if(Pe?.missionV2)await mt().startPlanning(xt);return await Mc(xt),xt}',
    replace:
      'if(Pe?.missionV2)return await mt().startPlanning(xt),await Mc(xt),xt;return Mc(xt),xt}',
  },
  {
    name: 'session-load-keeps-pending-settings',
    find: 'De.current=Ot;return await Et.loadSession({sessionId:qt}),xe.current=qt,Xe.current={},X.emit(',
    replace:
      'De.current=Ot;await Et.loadSession({sessionId:qt}),xe.current=qt;let $ODs=Xe.current;if(Xe.current={},ak($ODs))try{await Et.updateSessionSettings({sessionId:qt,...$ODs})}catch(mo){n("[useDaemonAgent] Failed to sync pending session settings",{cause:mo})}return X.emit(',
  },
  ...logoPatches,
  ...usagePatches,
  ...denylistPatches,
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
