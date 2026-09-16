import { logoPatches } from './logo.ts';

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

const TURN_CLOCK_TRACK =
  'let $busy=F!=="idle";' +
  'if($ODc.session!==U)$ODc.session=U,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(U):$ODc.done=$ODt(U);';

const TURN_CLOCK_TICK =
  'let $last=Math.max($ODc.sent,$ODc.done),$now=$last?Date.now():0,[$t,$re]=g(0);' +
  'D(()=>{if(!$last)return;' +
  'let $age=Date.now()-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5,' +
  '$id=setTimeout(()=>$re((V)=>V+1),$step-$age%$step);' +
  'return()=>clearTimeout($id)},[$last,$t]);';

const TURN_CLOCK_PARTS =
  'if($last){let $ago=[];' +
  'if($ODc.sent)$ago.push(We("\\u2191"+$ODa($now-$ODc.sent),{color:s.text.muted}));' +
  'if($ODc.done)$ago.push(We(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:s.text.muted}));' +
  'dc(xe,$ago)}';

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'catch{n(!1);return}setTimeout(()=>n(!1),150)',
    replace: 'catch{n(!1);return}setTimeout(()=>n(!1),30.)',
  },
  {
    name: 'whoami-no-block',
    find: 'let h=await No(s,a);if(h.resolved&&S&&S.tokenHash===r)',
    replace: 'let h=/**/  No(s,a);if(h.resolved&&S&&S.tokenHash===r)',
  },
  {
    name: 'certificate-count-skip',
    find: 'async function tt(){let e=await F(),t=await x(e);',
    replace: 'async function tt(){let e=null/*F*/,t=await x(e);',
  },
  {
    name: 'shutdown-flush-deadline',
    find: 'pn=1e4,mn=1000,',
    replace: 'pn=1e4,mn=10.0,',
  },
  {
    name: 'session-search-warm-skip',
    find: 'warmSessionSearch:!o||o.length===0,',
    replace: 'warmSessionSearch:!1/*o.length*/,',
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
    find: 'if(e in jn)return e;if(Object.values(jn).includes(e))return e;return}',
    replace:
      'if(e in jn)return e;if((Tt.$o!==jn&&(Tt.$o=jn,Tt.$s=new Set(Object.values(jn))),Tt.$s).has(e))return e;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:N}of Q0.segment(m)){if(F0(N))continue;if(m0.test(N)){h+=2;continue}let M=y0(N).codePointAt(0);h+=Xc(M,S),h+=S0(N,S)}if(f)ec(n,h);return h}',
    replace:
      'let $m=o?kn.$n:kn.$w;for(let{segment:N}of Q0.segment(m)){let $c=$m.get(N);if($c===void 0){if(F0(N))$c=0;else if(m0.test(N))$c=2;else{let M=y0(N).codePointAt(0);$c=Xc(M,S)+S0(N,S)}if($m.size<2e4)$m.set(N,$c)}h+=$c}if(f)ec(n,h);return h}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'm0=/^\\p{RGI_Emoji}$/v;function tc(n){',
    replace: 'm0=/^\\p{RGI_Emoji}$/v;kn.$n=new Map;kn.$w=new Map;function tc(n){',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 'for(let{segment:S}of _0.segment(f)){if(W0(S))continue;if(Z0.test(S)){m+=2;continue}let N=V0(S).codePointAt(0);m+=Xc(N,h),m+=j0(S,h)}return m}',
    replace:
      'let $m=o?Si.$n:Si.$w;for(let{segment:S}of _0.segment(f)){let $c=$m.get(S);if($c===void 0){if(W0(S))$c=0;else if(Z0.test(S))$c=2;else{let N=V0(S).codePointAt(0);$c=Xc(N,h)+j0(S,h)}if($m.size<2e4)$m.set(S,$c)}m+=$c}return m}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: 'Z0=/^\\p{RGI_Emoji}$/v;function V0(n){',
    replace: 'Z0=/^\\p{RGI_Emoji}$/v;Si.$n=new Map;Si.$w=new Map;function V0(n){',
  },
  {
    name: 'turn-clock-state',
    find: 'var Nte=new Set(["thinking","streaming","compressing","executing_tool"]),Fte="\\uF418",',
    replace: `var ${TURN_CLOCK_STATE},Nte=new Set(["thinking","streaming","compressing","executing_tool"]),Fte="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:ce,updateNoticeDisplay:ue}){let de=Vte(',
    replace: `isSessionArchived:ce,updateNoticeDisplay:ue}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let de=Vte(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'let Te=Z$(q);if(Te)dc(xe,[We(Te,{color:s.primary})]);let we=[];',
    replace: `let Te=Z$(q);if(Te)dc(xe,[We(Te,{color:s.primary})]);${TURN_CLOCK_PARTS}let we=[];`,
  },
  {
    name: 'auto-update-notice-only',
    find: 'if(!m)return s(u,"no-update"),"no-update";if(m.isRollback){',
    replace:
      'if(!m)return s(u,"no-update"),"no-update";return _({type:"update-available",version:m.version.version}),l("Auto-update blocked by ovrdroid; run: ovrdroid update",{version:m.version.version}),s(u,"skipped"),"skipped";if(m.isRollback){',
  },
  {
    name: 'update-notice-command',
    find: 'available:"\\u2193 v{{version}} available",',
    replace: 'available:"\\u2193 v{{version}} available \\xB7 run: ovrdroid update",',
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(ce&&ue)return 1;if(ce)return 2;if(ue)return 3;return 4}',
    replace: 'if(ue)return ce?1:2;if(ce)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function Wa(n){if(r.status===n.status',
    replace: 'function Wa(n){if(n.status==="ready")Lo.$done=!0;if(r.status===n.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:to.status==="refreshing"}',
    replace: 'isLoading:to.status==="refreshing"&&!Lo.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'gt=A((yn)=>{Io({showCommands:yn}),Xt(yn)},[Io])',
    replace: 'gt=A((yn)=>{Io({showCommands:yn}),Xt(yn),At?.(yn)},[Io,At])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'D(()=>{At?.(io)},[io,At]);',
    replace: 'D(()=>()=>{At?.(!1)},[At]);',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let C=A(()=>{w({type:"draft-edited"})},[]);return{display:b,dismissAfterDraftEdit:C}',
    replace:
      'let $r=v(b);$r.current=b;let C=A(()=>{let $s=$r.current;if($s.notice.kind==="hidden"||$s.dismissed)return;w({type:"draft-edited"})},[]);return{display:b,dismissAfterDraftEdit:C}',
  },
  ...logoPatches,
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
