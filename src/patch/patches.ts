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

const TURN_CLOCK_TICK =
  'let $last=Math.max($ODc.sent,$ODc.done),$now=$last?Date.now():0,[$t,$re]=g(0);' +
  'x(()=>{if(!$last)return;' +
  'let $age=Date.now()-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5,' +
  '$id=setTimeout(()=>$re((V)=>V+1),$step-$age%$step);' +
  'return()=>clearTimeout($id)},[$last,$t]);';

const TURN_CLOCK_TRACK =
  'let $busy=F!=="idle";' +
  'if($ODc.session!==U)$ODc.session=U,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(U):$ODc.done=$ODt(U);';

const TURN_CLOCK_PARTS =
  'if($last){let $ago=[];' +
  'if($ODc.sent)$ago.push(je("\\u2191"+$ODa($now-$ODc.sent),{color:s.text.muted}));' +
  'if($ODc.done)$ago.push(je(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:s.text.muted}));' +
  'pc(xe,$ago)}';

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
    find: 'Cn=1e4,Rn=1000,',
    replace: 'Cn=1e4,Rn=10,',
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
    find: 'for(let{segment:F}of D0.segment(f)){if(N0(F))continue;if(p0.test(F)){d+=2;continue}let G=S0(F).codePointAt(0);d+=dl(G,h),d+=R0(F,h)}if(Q)uc(n,d);return d}',
    replace:
      'let $m=o?kn.$n:kn.$w;for(let{segment:F}of D0.segment(f)){let $c=$m.get(F);if($c===void 0){if(N0(F))$c=0;else if(p0.test(F))$c=2;else{let G=S0(F).codePointAt(0);$c=dl(G,h)+R0(F,h)}if($m.size<2e4)$m.set(F,$c)}d+=$c}if(Q)uc(n,d);return d}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'p0=/^\\p{RGI_Emoji}$/v;function nc(n){',
    replace: 'p0=/^\\p{RGI_Emoji}$/v;kn.$n=new Map;kn.$w=new Map;function nc(n){',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 'for(let{segment:h}of Z0.segment(Q)){if($0(h))continue;if(j0.test(h)){f+=2;continue}let F=P0(h).codePointAt(0);f+=dl(F,d),f+=Am(h,d)}return f}',
    replace:
      'let $m=o?Si.$n:Si.$w;for(let{segment:h}of Z0.segment(Q)){let $c=$m.get(h);if($c===void 0){if($0(h))$c=0;else if(j0.test(h))$c=2;else{let F=P0(h).codePointAt(0);$c=dl(F,d)+Am(h,d)}if($m.size<2e4)$m.set(h,$c)}f+=$c}return f}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: 'j0=/^\\p{RGI_Emoji}$/v;function P0(n){',
    replace: 'j0=/^\\p{RGI_Emoji}$/v;Si.$n=new Map;Si.$w=new Map;function P0(n){',
  },
  {
    name: 'turn-clock-state',
    find: 'var Wte=new Set(["thinking","streaming","compressing","executing_tool"]),zte="\\uF418",',
    replace: `var ${TURN_CLOCK_STATE},Wte=new Set(["thinking","streaming","compressing","executing_tool"]),zte="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:de,updateNoticeDisplay:me}){let pe=qte(',
    replace: `isSessionArchived:de,updateNoticeDisplay:me}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let pe=qte(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'let Te=R7(K);if(Te)pc(xe,[je(Te,{color:s.primary})]);let ve=[];',
    replace: `let Te=R7(K);if(Te)pc(xe,[je(Te,{color:s.primary})]);${TURN_CLOCK_PARTS}let ve=[];`,
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
    name: 'update-notice-sticky',
    find:
      'function Zte({chatDraftEmpty:b,updateNoticeDisplay:w}){' +
      'let{t:C}=ut("common"),{hasIssues:F,results:U}=Z1();',
    replace:
      'function Zte({chatDraftEmpty:b,updateNoticeDisplay:w}){' +
      'let{t:C}=ut("common"),{hasIssues:F,results:U}=Z1();' +
      'if($ODu(w.notice))return{text:C(w.notice.key,{version:w.notice.version}),color:s.warning};',
  },
  {
    name: 'update-notice-sticky-predicate',
    find: 'function eF(b){if(b===null)return{kind:"hidden"};',
    replace:
      'function $ODu(N){return N.kind==="progress"&&N.key==="update.available"}' +
      'function eF(b){if(b===null)return{kind:"hidden"};',
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(de&&me)return 1;if(de)return 2;if(me)return 3;return 4}',
    replace: 'if(me)return de?1:2;if(de)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function ec(n){let t=l();if(t.snapshot.status===n.status',
    replace:
      'function ec(n){if(n.status==="ready")$o.$done=!0;let t=l();if(t.snapshot.status===n.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:uo.status==="refreshing"}',
    replace: 'isLoading:uo.status==="refreshing"&&!$o.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'xt=A((Tn)=>{Ao({showCommands:Tn}),ao(Tn)},[Ao])',
    replace: 'xt=A((Tn)=>{Ao({showCommands:Tn}),ao(Tn),Bt?.(Tn)},[Ao,Bt])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'x(()=>{Bt?.(go)},[go,Bt]);',
    replace: 'x(()=>()=>{Bt?.(!1)},[Bt]);',
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
