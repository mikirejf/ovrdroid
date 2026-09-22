import { OVRDROID_UNDER_HOME } from '../paths.ts';
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
  '$ODt=(S)=>{try{return w().getSessionStateManager().getSessionManager(S)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TICK =
  'let $last=Math.max($ODc.sent,$ODc.done),$now=$last?Date.now():0,[$t,$re]=A(0);' +
  'D(()=>{if(!$last)return;' +
  'let $age=Date.now()-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5,' +
  '$id=setTimeout(()=>$re((V)=>V+1),$step-$age%$step);' +
  'return()=>clearTimeout($id)},[$last,$t]);';

const TURN_CLOCK_TRACK =
  'let $busy=I!=="idle";' +
  'if($ODc.session!==z)$ODc.session=z,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(z):$ODc.done=$ODt(z);';

const TURN_CLOCK_PARTS =
  'if($last){let $ago=[];' +
  'if($ODc.sent)$ago.push($e("\\u2191"+$ODa($now-$ODc.sent),{color:o.text.muted}));' +
  'if($ODc.done)$ago.push($e(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:o.text.muted}));' +
  'Al(be,$ago)}';

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
  'return typeof V==="string"&&V!==rs()?V:null}catch{return null}}';

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
    find: 'R=1e4,A=1000,',
    replace: 'R=1e4,A=10,',
  },
  {
    name: 'session-search-warm-skip',
    find: 'if(S(te),!t){let r=C.then(()=>i.startBackgroundStartupOperation(i.phases.SessionSearchWarm,',
    replace:
      'if(S(te),!1){let r=C.then(()=>i.startBackgroundStartupOperation(i.phases.SessionSearchWarm,',
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
    find: 'if(e in nr)return e;if(Object.values(nr).includes(e))return e;return}',
    replace:
      'if(e in nr)return e;if((ut.$o!==nr&&(ut.$o=nr,ut.$s=new Set(Object.values(nr))),ut.$s).has(e))return e;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:F}of mD.segment(C)){if(RD(F))continue;if(hD.test(F)){d+=2;continue}let v=ND(F).codePointAt(0);d+=ul(v,h),d+=GD(F,h)}if(B)gr(n,d);return d}',
    replace:
      'let $m=l?kn.$n:kn.$w;for(let{segment:F}of mD.segment(C)){let $c=$m.get(F);if($c===void 0){if(RD(F))$c=0;else if(hD.test(F))$c=2;else{let v=ND(F).codePointAt(0);$c=ul(v,h)+GD(F,h)}if($m.size<2e4)$m.set(F,$c)}d+=$c}if(B)gr(n,d);return d}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'hD=/^\\p{RGI_Emoji}$/v;function or(n){',
    replace: 'hD=/^\\p{RGI_Emoji}$/v;kn.$n=new Map;kn.$w=new Map;function or(n){',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 'for(let{segment:u}of S.segment(o)){if(x(u))continue;if(_.test(u)){r+=2;continue}let f=w(u).codePointAt(0);r+=ul(f,s),r+=D(u,s)}return r}',
    replace:
      'let $m=e?TS.$n:TS.$w;for(let{segment:u}of S.segment(o)){let $c=$m.get(u);if($c===void 0){if(x(u))$c=0;else if(_.test(u))$c=2;else{let f=w(u).codePointAt(0);$c=ul(f,s)+D(u,s)}if($m.size<2e4)$m.set(u,$c)}r+=$c}return r}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: '_=/^\\p{RGI_Emoji}$/v;function w(n){',
    replace: '_=/^\\p{RGI_Emoji}$/v;TS.$n=new Map;TS.$w=new Map;function w(n){',
  },
  {
    name: 'turn-clock-state',
    find: 'var QY=new Set(["thinking","streaming","compressing","executing_tool"]),JY="\\uF418",',
    replace: `var ${TURN_CLOCK_STATE},QY=new Set(["thinking","streaming","compressing","executing_tool"]),JY="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:ue,updateNoticeDisplay:de}){let me=tX(',
    replace: `isSessionArchived:ue,updateNoticeDisplay:de}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let me=tX(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'let ye=M$(j);if(ye)Al(be,[$e(ye,{color:o.primary})]);let we=[];',
    replace: `let ye=M$(j);if(ye)Al(be,[$e(ye,{color:o.primary})]);${TURN_CLOCK_PARTS}let we=[];`,
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
    find: 'function x(){return IN(fX)}',
    replace: `${UPDATE_FILE_WRITER}function x(){return IN(fX)}`,
  },
  {
    name: 'update-notice-reader',
    find: 'function rD({width:t,height:e,t:n}){',
    replace: `${UPDATE_FILE_READER}function rD({width:t,height:e,t:n}){`,
  },
  {
    name: 'update-notice-header-room',
    find: 'L=!oe().isProductionTier,A=rs(),C=!h&&!!A,R=x.length+2+(L?1:0)+(C?2:0)+5,',
    replace:
      `L=!oe().isProductionTier,A=rs(),C=!h&&!!A,${UPDATE_LOCAL}=${UPDATE_FILE_READER_NAME}(),` +
      `R=x.length+2+(L?1:0)+(C?2:0)+(${UPDATE_LOCAL}?2:0)+5,`,
  },
  {
    name: 'update-notice-header-line',
    find: 'b(m,T,M(Q),Q,l),T+=2;',
    replace: `${UPDATE_HEADER_LINE}b(m,T,M(Q),Q,l),T+=2;`,
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(ue&&de)return 1;if(ue)return 2;if(de)return 3;return 4}',
    replace: 'if(de)return ue?1:2;if(ue)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function Ys(a){let t=o();if(t.snapshot.status===a.status',
    replace:
      'function Ys(a){if(a.status==="ready")Di.$done=!0;let t=o();if(t.snapshot.status===a.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:zt.status==="refreshing"}',
    replace: 'isLoading:zt.status==="refreshing"&&!Di.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'ao=f((Xo)=>{xt({showCommands:Xo}),Kt(Xo)},[xt])',
    replace: 'ao=f((Xo)=>{xt({showCommands:Xo}),Kt(Xo),kt?.(Xo)},[xt,kt])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'D(()=>{kt?.(Yt)},[Yt,kt]);',
    replace: 'D(()=>()=>{kt?.(!1)},[kt]);',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let k=f(()=>{b({type:"draft-edited"})},[]);return{display:d,dismissAfterDraftEdit:k}',
    replace:
      'let $r=H(d);$r.current=d;let k=f(()=>{let $s=$r.current;if($s.notice.kind==="hidden"||$s.dismissed)return;b({type:"draft-edited"})},[]);return{display:d,dismissAfterDraftEdit:k}',
  },
  {
    name: 'web-fetch-always-loaded',
    find: 'outputSchemas:{result:O},toolkit:"Web Search",deferred:!0,isToolEnabled:!0}',
    replace: 'outputSchemas:{result:O},toolkit:"Web Search",deferred:!1,isToolEnabled:!0}',
  },
  {
    name: 'web-search-always-loaded',
    find: 'outputSchemas:{result:Y},toolkit:"Web Search",deferred:!0,isToolEnabled:!0}',
    replace: 'outputSchemas:{result:Y},toolkit:"Web Search",deferred:!1,isToolEnabled:!0}',
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
    find: 'kt=60000;function Lt(){let e=process.env.FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS',
    replace: 'kt=15000;function Lt(){let e=process.env.FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS',
  },
  ...logoPatches,
  ...usagePatches,
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
