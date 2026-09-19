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
  '$ODt=(S)=>{try{return P().getSessionStateManager().getSessionManager(S)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TICK =
  'let $last=Math.max($ODc.sent,$ODc.done),$now=$last?Date.now():0,[$t,$re]=g(0);' +
  'x(()=>{if(!$last)return;' +
  'let $age=Date.now()-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5,' +
  '$id=setTimeout(()=>$re((V)=>V+1),$step-$age%$step);' +
  'return()=>clearTimeout($id)},[$last,$t]);';

const TURN_CLOCK_TRACK =
  'let $busy=C!=="idle";' +
  'if($ODc.session!==F)$ODc.session=F,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(F):$ODc.done=$ODt(F);';

const TURN_CLOCK_PARTS =
  'if($last){let $ago=[];' +
  'if($ODc.sent)$ago.push(je("\\u2191"+$ODa($now-$ODc.sent),{color:s.text.muted}));' +
  'if($ODc.done)$ago.push(je(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:s.text.muted}));' +
  'cc(ge,$ago)}';

const UPDATE_FILE_NAME = 'ovrdroid-update.json';

const UPDATE_FILE_WRITER_NAME = '$ODw';

const UPDATE_FILE_READER_NAME = '$ODr';

const UPDATE_LOCAL = '$ODv';

const UPDATE_STYLE = 'ovrdroid-update';

const UPDATE_FILE_WRITER =
  `function ${UPDATE_FILE_WRITER_NAME}(V){` +
  `try{let P=Y.join(L(),O(),${JSON.stringify(UPDATE_FILE_NAME)});` +
  'if(V===null)E.rmSync(P,{force:!0});' +
  'else E.writeFileSync(P,JSON.stringify({version:V}))}catch{}}';

const UPDATE_FILE_READER =
  `function ${UPDATE_FILE_READER_NAME}(){` +
  `try{let P=rne.join(L(),O(),${JSON.stringify(UPDATE_FILE_NAME)}),` +
  'V=JSON.parse(Hoe.readFileSync(P,"utf8")).version;' +
  'return typeof V==="string"&&V!==Wi()?V:null}catch{return null}}';

const UPDATE_HEADER_LINE =
  `if(${UPDATE_LOCAL}){` +
  `let $x="\\u2193 v"+${UPDATE_LOCAL}+" available \\xB7 run: ovrdroid update";` +
  `Gi(ge,ve,Te($x),$x,"${UPDATE_STYLE}"),ve+=2}`;

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'catch{n(!1);return}setTimeout(()=>n(!1),150)',
    replace: 'catch{n(!1);return}setTimeout(()=>n(!1),30.)',
  },
  {
    name: 'whoami-no-block',
    find: 'let h=await Uo(s,a);if(h.resolved&&S&&S.tokenHash===r)',
    replace: 'let h=Uo(s,a);if(h.resolved&&S&&S.tokenHash===r)',
  },
  {
    name: 'certificate-count-skip',
    find: 'async function tt(){let e=await F(),t=await x(e);',
    replace: 'async function tt(){let e=null/*F*/,t=await x(e);',
  },
  {
    name: 'shutdown-flush-deadline',
    find: 'yn=1e4,Cn=1000,',
    replace: 'yn=1e4,Cn=10,',
  },
  {
    name: 'session-search-warm-skip',
    find: 'warmSessionSearch:!a||a.length===0,',
    replace: 'warmSessionSearch:!1,',
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
    find: 'if(e in Xn)return e;if(Object.values(Xn).includes(e))return e;return}',
    replace:
      'if(e in Xn)return e;if((St.$o!==Xn&&(St.$o=Xn,St.$s=new Set(Object.values(Xn))),St.$s).has(e))return e;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:F}of d0.segment(f)){if(v0(F))continue;if(y0.test(F)){d+=2;continue}let G=G0(F).codePointAt(0);d+=dl(G,h),d+=w0(F,h)}if(Q)ic(n,d);return d}',
    replace:
      'let $m=o?kn.$n:kn.$w;for(let{segment:F}of d0.segment(f)){let $c=$m.get(F);if($c===void 0){if(v0(F))$c=0;else if(y0.test(F))$c=2;else{let G=G0(F).codePointAt(0);$c=dl(G,h)+w0(F,h)}if($m.size<2e4)$m.set(F,$c)}d+=$c}if(Q)ic(n,d);return d}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'y0=/^\\p{RGI_Emoji}$/v;function uc(n){',
    replace: 'y0=/^\\p{RGI_Emoji}$/v;kn.$n=new Map;kn.$w=new Map;function uc(n){',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 'for(let{segment:c}of Le.segment(o)){if(De(c))continue;if(xe.test(c)){a+=2;continue}let p=we(c).codePointAt(0);a+=dl(p,u),a+=Fe(c,u)}return a}',
    replace:
      'let $m=r?Xb.$n:Xb.$w;for(let{segment:c}of Le.segment(o)){let $c=$m.get(c);if($c===void 0){if(De(c))$c=0;else if(xe.test(c))$c=2;else{let p=we(c).codePointAt(0);$c=dl(p,u)+Fe(c,u)}if($m.size<2e4)$m.set(c,$c)}a+=$c}return a}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: 'xe=/^\\p{RGI_Emoji}$/v;function we(e){',
    replace: 'xe=/^\\p{RGI_Emoji}$/v;Xb.$n=new Map;Xb.$w=new Map;function we(e){',
  },
  {
    name: 'turn-clock-state',
    find: 'var bte=new Set(["thinking","streaming","compressing","executing_tool"]),Tte="\\uF418",',
    replace: `var ${TURN_CLOCK_STATE},bte=new Set(["thinking","streaming","compressing","executing_tool"]),Tte="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:ue,updateNoticeDisplay:de}){let pe=vte(',
    replace: `isSessionArchived:ue,updateNoticeDisplay:de}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let pe=vte(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'let xe=P7(z);if(xe)cc(ge,[je(xe,{color:s.primary})]);let we=[];',
    replace: `let xe=P7(z);if(xe)cc(ge,[je(xe,{color:s.primary})]);${TURN_CLOCK_PARTS}let we=[];`,
  },
  {
    name: 'auto-update-notice-only',
    find: 'if(!m)return s(u,"no-update"),"no-update";if(m.isRollback){',
    replace:
      `if(!m)return ${UPDATE_FILE_WRITER_NAME}(null),s(u,"no-update"),"no-update";` +
      `return ${UPDATE_FILE_WRITER_NAME}(m.version.version),` +
      'l("Auto-update blocked by ovrdroid; run: ovrdroid update",{version:m.version.version}),' +
      's(u,"skipped"),"skipped";if(m.isRollback){',
  },
  {
    name: 'update-notice-writer',
    find: 'function j(){return Y.join(L(),O(),Z)}',
    replace: `${UPDATE_FILE_WRITER}function j(){return Y.join(L(),O(),Z)}`,
  },
  {
    name: 'update-notice-reader',
    find: 'function xZ(f){return{empty:{color:void 0,bold:!1,italic:!1},',
    replace:
      `${UPDATE_FILE_READER}function xZ(f){return{empty:{color:void 0,bold:!1,italic:!1},` +
      `"${UPDATE_STYLE}":{color:s.warning,bold:!0,italic:!1},`,
  },
  {
    name: 'update-notice-header-room',
    find: 'ue=!ae().isProductionTier,de=!ee&&!!Wi(),fe=le.length+2+(ue?1:0)+(de?2:0)+5,',
    replace:
      `ue=!ae().isProductionTier,de=!ee&&!!Wi(),${UPDATE_LOCAL}=${UPDATE_FILE_READER_NAME}(),` +
      `fe=le.length+2+(ue?1:0)+(de?2:0)+(${UPDATE_LOCAL}?2:0)+5,`,
  },
  {
    name: 'update-notice-header-line',
    find: 'Gi(ge,ve,Te(Ye),Ye,"box-label"),ve+=2;',
    replace: `${UPDATE_HEADER_LINE}Gi(ge,ve,Te(Ye),Ye,"box-label"),ve+=2;`,
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(ue&&de)return 1;if(ue)return 2;if(de)return 3;return 4}',
    replace: 'if(de)return ue?1:2;if(ue)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function tc(n){let t=l();if(t.snapshot.status===n.status',
    replace:
      'function tc(n){if(n.status==="ready")Go.$done=!0;let t=l();if(t.snapshot.status===n.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:mo.status==="refreshing"}',
    replace: 'isLoading:mo.status==="refreshing"&&!Go.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'bt=A((bn)=>{Bo({showCommands:bn}),ao(bn)},[Bo])',
    replace: 'bt=A((bn)=>{Bo({showCommands:bn}),ao(bn),Ot?.(bn)},[Bo,Ot])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'x(()=>{Ot?.(co)},[co,Ot]);',
    replace: 'x(()=>()=>{Ot?.(!1)},[Ot]);',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let w=A(()=>{b({type:"draft-edited"})},[]);return{display:f,dismissAfterDraftEdit:w}',
    replace:
      'let $r=v(f);$r.current=f;let w=A(()=>{let $s=$r.current;if($s.notice.kind==="hidden"||$s.dismissed)return;b({type:"draft-edited"})},[]);return{display:f,dismissAfterDraftEdit:w}',
  },
  {
    name: 'web-fetch-always-loaded',
    find: 'outputSchemas:{result:Ke},toolkit:"Web Search",deferred:!0,isToolEnabled:!0}',
    replace: 'outputSchemas:{result:Ke},toolkit:"Web Search",deferred:!1,isToolEnabled:!0}',
  },
  {
    name: 'web-search-always-loaded',
    find: 'outputSchemas:{result:Qt},toolkit:"Web Search",deferred:!0,isToolEnabled:!0}',
    replace: 'outputSchemas:{result:Qt},toolkit:"Web Search",deferred:!1,isToolEnabled:!0}',
  },
  {
    name: 'gate-first-turn-on-ide-connect',
    find: 'if(!this.isBlockOnMcpLoadEnabled())return;await this.awaitMcpReadinessBeforeAgentTurn()}',
    replace:
      'if(this.ideInitPromise){let $t;await Promise.race([this.ideInitPromise.catch(()=>{}),new Promise((r)=>{$t=setTimeout(r,5000);$t.unref?.()})]);clearTimeout($t)}' +
      'if(!this.isBlockOnMcpLoadEnabled())return;await this.awaitMcpReadinessBeforeAgentTurn()}',
  },
  {
    name: 'mcp-gate-timeout-15s',
    find: 'Ot=60000;function _t(){let e=process.env.FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS',
    replace: 'Ot=15000;function _t(){let e=process.env.FACTORY_MCP_BLOCKING_LOAD_TIMEOUT_MS',
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
