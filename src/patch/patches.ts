import { logoPatches } from './logo.ts';
import { reactProductionPatches } from './react.ts';

export interface Patch {
  name: string;
  find: string;
  until?: string;
  replace: string;
}

const MARKER_PREFIX = 'globalThis.__overdroid="';
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
  'this["~standard"]={version:1,vendor:"zod",validate:(R)=>this["~validate"](R)}';

const OWN_METHOD =
  'A=(T,K,G)=>(Object.defineProperty(T,K,{value:G,writable:!0,enumerable:!0,configurable:!0}),G)';

const LAZY_GET = 'get(){return Object.hasOwn(this,"_def")?A(this,K,B.bind(this)):B}';

const LAZY_SET = 'set(G){Object.hasOwn(this,"_def")?A(this,K,G):W(this,K,G)}';

const LAZY_ACCESSORS = `static{let P=this.prototype,${OWN_METHOD},W=(T,K,B)=>Object.defineProperty(T,K,{configurable:!0,${LAZY_GET},${LAZY_SET}});${JSON.stringify(LAZY_METHODS)}.forEach((K)=>W(P,K,P[K])),W(P,"spa",P.safeParseAsync)}`;

const TURN_CLOCK_STATE =
  '$ODc={session:null,sent:0,done:0,busy:!1},' +
  '$ODa=(T)=>{let R=Math.floor(T/6e4);if(R<1)return"<1m";if(R<60)return R+"m";' +
  'let H=Math.floor(R/60);if(H<24)return H+"h";return Math.floor(H/24)+"d"},' +
  '$ODt=(S)=>{try{return XA().getSessionStateManager().getSessionManager(S)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TRACK =
  'let $busy=A!=="idle";' +
  'if($ODc.session!==h)$ODc.session=h,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(h):$ODc.done=$ODt(h);';

const TURN_CLOCK_TICK =
  'let $last=Math.max($ODc.sent,$ODc.done),$now=$last?Date.now():0,[$t,$re]=PV.useState(0);' +
  'PV.useEffect(()=>{if(!$last)return;' +
  'let $age=Date.now()-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5,' +
  '$id=setTimeout(()=>$re((V)=>V+1),$step-$age%$step);' +
  'return()=>clearTimeout($id)},[$last,$t]);';

const TURN_CLOCK_PARTS =
  'if($last){let $ago=[];' +
  'if($ODc.sent)$ago.push(A_("\\u2191"+$ODa($now-$ODc.sent),{color:DT.text.muted}));' +
  'if($ODc.done)$ago.push(A_(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:DT.text.muted}));' +
  'j6T(K,$ago)}';

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'catch{B(!1);return}setTimeout(()=>B(!1),150)',
    replace: 'catch{B(!1);return}setTimeout(()=>B(!1),30.)',
  },
  {
    name: 'whoami-no-block',
    find: 'let _=await ARu(A,H);if(_.resolved&&hO&&hO.tokenHash===R)',
    replace: 'let _=/**/  ARu(A,H);if(_.resolved&&hO&&hO.tokenHash===R)',
  },
  {
    name: 'certificate-count-skip',
    find: 'async function Xwu(){let T=await pIn(),R=await HFn(T);',
    replace: 'async function Xwu(){let T=null/*pIn*/,R=await HFn(T);',
  },
  {
    name: 'shutdown-flush-deadline',
    find: 'FoH="timeout",yQB=1e4,cQB=1000,',
    replace: 'FoH="timeout",yQB=1e4,cQB=10.0,',
  },
  {
    name: 'session-search-warm-skip',
    find: 'warmSessionSearch:!T||T.length===0,',
    replace: 'warmSessionSearch:!1/*T.length*/,',
  },
  {
    name: 'zod-v3-lazy-bound-methods',
    find: `constructor(T){this.spa=this.safeParseAsync,this._def=T,${CONSTRUCTOR_BINDS.map(
      (name) => `this.${name}=this.${name}.bind(this),`,
    ).join('')}${STANDARD_SCHEMA}`,
    replace: `${LAZY_ACCESSORS}constructor(T){this._def=T,${STANDARD_SCHEMA}`,
  },
  {
    name: 'model-alias-lookup-set',
    find: 'if(T in RO)return T;if(Object.values(RO).includes(T))return T;return}',
    replace:
      'if(T in RO)return T;if((lC.$o!==RO&&(lC.$o=RO,lC.$s=new Set(Object.values(RO))),lC.$s).has(T))return T;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:B}of IZC.segment(n)){if(NZC(B))continue;if(wZC.test(B)){t+=2;continue}let f=JZC(B).codePointAt(0);t+=g0T(f,_),t+=QZC(B,_)}if(h)OKi(T,t);return t}',
    replace:
      'let $m=H?FKT.$n:FKT.$w;for(let{segment:B}of IZC.segment(n)){let c=$m.get(B);if(c===void 0){if(NZC(B))c=0;else if(wZC.test(B))c=2;else{let f=JZC(B).codePointAt(0);c=g0T(f,_)+QZC(B,_)}if($m.size<2e4)$m.set(B,c)}t+=c}if(h)OKi(T,t);return t}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'wZC=/^\\p{RGI_Emoji}$/v;H6T=new Map});',
    replace: 'wZC=/^\\p{RGI_Emoji}$/v;H6T=new Map;FKT.$n=new Map;FKT.$w=new Map});',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 'for(let{segment:_}of Q0u.segment(h)){if(o0u(_))continue;if(g0u.test(_)){n+=2;continue}let B=K0u(_).codePointAt(0);n+=g0T(B,t),n+=F0u(_,t)}return n}',
    replace:
      'let $m=H?c0R.$n:c0R.$w;for(let{segment:_}of Q0u.segment(h)){let c=$m.get(_);if(c===void 0){if(o0u(_))c=0;else if(g0u.test(_))c=2;else{let B=K0u(_).codePointAt(0);c=g0T(B,t)+F0u(_,t)}if($m.size<2e4)$m.set(_,c)}n+=c}return n}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: 'g0u=/^\\p{RGI_Emoji}$/v});',
    replace: 'g0u=/^\\p{RGI_Emoji}$/v;c0R.$n=new Map;c0R.$w=new Map});',
  },
  {
    name: 'turn-clock-state',
    find: 'var PV,jht,_BD,uBD=',
    replace: `var ${TURN_CLOCK_STATE},PV,jht,_BD,uBD=`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:I,updateNoticeDisplay:w}){let W=DBD(',
    replace: `isSessionArchived:I,updateNoticeDisplay:w}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let W=DBD(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'let S=j21(t);if(S)j6T(K,[A_(S,{color:DT.primary})]);let e=[];',
    replace: `let S=j21(t);if(S)j6T(K,[A_(S,{color:DT.primary})]);${TURN_CLOCK_PARTS}let e=[];`,
  },
  {
    name: 'auto-update-notice-only',
    find: 'if(!$)return cV(t,"no-update"),"no-update";if($.isRollback){',
    replace:
      'if(!$)return cV(t,"no-update"),"no-update";return Ja9({type:"update-available",version:$.version.version}),JT("Auto-update blocked by overdroid; run: overdroid update",{version:$.version.version}),cV(t,"skipped"),"skipped";if($.isRollback){',
  },
  {
    name: 'update-notice-command',
    find: 'available:"\\u2193 v{{version}} available",',
    replace: 'available:"\\u2193 v{{version}} available \\xB7 run: overdroid update",',
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(I&&w)return 1;if(I)return 2;if(w)return 3;return 4}',
    replace: 'if(w)return I?1:2;if(I)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function Td(T){if(omR.status===T.status',
    replace: 'function Td(T){if(T.status==="ready")Td.$done=!0;if(omR.status===T.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:fT.status==="refreshing"}',
    replace: 'isLoading:fT.status==="refreshing"&&!Td.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'WR=FB.useCallback((y9)=>{TH({showCommands:y9}),TT(y9)},[TH])',
    replace: 'WR=FB.useCallback((y9)=>{TH({showCommands:y9}),TT(y9),GT?.(y9)},[TH,GT])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'FB.useEffect(()=>{GT?.(x)},[x,GT]);',
    replace: 'FB.useEffect(()=>()=>{GT?.(!1)},[GT]);',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let H=PV.useCallback(()=>{R({type:"draft-edited"})},[]);return{display:T,dismissAfterDraftEdit:H}',
    replace:
      'let $r=PV.useRef(T);$r.current=T;let H=PV.useCallback(()=>{let s=$r.current;if(s.notice.kind==="hidden"||s.dismissed)return;R({type:"draft-edited"})},[]);return{display:T,dismissAfterDraftEdit:H}',
  },
  ...logoPatches,
];

async function productionPatches(): Promise<readonly Patch[]> {
  return [...patches, ...(await reactProductionPatches())];
}

let productionSet: Promise<readonly Patch[]> | undefined;

export async function patchSet(options: { devReact: boolean }): Promise<readonly Patch[]> {
  if (options.devReact) {
    return patches;
  }
  productionSet ??= productionPatches();
  return await productionSet;
}

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
