import { logoPatches } from './logo.ts';
import { reactProductionPatches } from './react.ts';

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
  'this["~standard"]={version:1,vendor:"zod",validate:(t)=>this["~validate"](t)}';

const OWN_METHOD =
  'A=(e,K,G)=>(Object.defineProperty(e,K,{value:G,writable:!0,enumerable:!0,configurable:!0}),G)';

const LAZY_GET = 'get(){return Object.hasOwn(this,"_def")?A(this,K,B.bind(this)):B}';

const LAZY_SET = 'set(G){Object.hasOwn(this,"_def")?A(this,K,G):W(this,K,G)}';

const LAZY_ACCESSORS = `static{let P=this.prototype,${OWN_METHOD},W=(e,K,B)=>Object.defineProperty(e,K,{configurable:!0,${LAZY_GET},${LAZY_SET}});${JSON.stringify(LAZY_METHODS)}.forEach((K)=>W(P,K,P[K])),W(P,"spa",P.safeParseAsync)}`;

const TURN_CLOCK_STATE =
  '$ODc={session:null,sent:0,done:0,busy:!1},' +
  '$ODa=(T)=>{let R=Math.floor(T/6e4);if(R<1)return"<1m";if(R<60)return R+"m";' +
  'let H=Math.floor(R/60);if(H<24)return H+"h";return Math.floor(H/24)+"d"},' +
  '$ODt=(S)=>{try{return Kr().getSessionStateManager().getSessionManager(S)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TRACK =
  'let $busy=r!=="idle";' +
  'if($ODc.session!==o)$ODc.session=o,$ODc.sent=0,$ODc.done=0,$ODc.busy=$busy;' +
  'else if($busy!==$ODc.busy)$ODc.busy=$busy,$busy?$ODc.sent=$ODt(o):$ODc.done=$ODt(o);';

const TURN_CLOCK_TICK =
  'let $last=Math.max($ODc.sent,$ODc.done),$now=$last?Date.now():0,[$t,$re]=rJ.useState(0);' +
  'rJ.useEffect(()=>{if(!$last)return;' +
  'let $age=Date.now()-$last,$step=$age<36e5?6e4:$age<864e5?36e5:864e5,' +
  '$id=setTimeout(()=>$re((V)=>V+1),$step-$age%$step);' +
  'return()=>clearTimeout($id)},[$last,$t]);';

const TURN_CLOCK_PARTS =
  'if($last){let $ago=[];' +
  'if($ODc.sent)$ago.push(ad("\\u2191"+$ODa($now-$ODc.sent),{color:fe.text.muted}));' +
  'if($ODc.done)$ago.push(ad(($ODc.sent?" ":"")+"\\u2193"+$ODa($now-$ODc.done),{color:fe.text.muted}));' +
  'jve(x,$ago)}';

export const patches: readonly Patch[] = [
  {
    name: 'kitty-probe-timeout',
    find: 'catch{u(!1);return}setTimeout(()=>u(!1),150)',
    replace: 'catch{u(!1);return}setTimeout(()=>u(!1),30.)',
  },
  {
    name: 'whoami-no-block',
    find: 'let c=await EMd(r,n);if(c.resolved&&VE&&VE.tokenHash===t)',
    replace: 'let c=/**/  EMd(r,n);if(c.resolved&&VE&&VE.tokenHash===t)',
  },
  {
    name: 'certificate-count-skip',
    find: 'async function nch(){let e=await Yds(),t=await iIs(e);',
    replace: 'async function nch(){let e=null/*Yds*/,t=await iIs(e);',
  },
  {
    name: 'shutdown-flush-deadline',
    find: '$ip=1e4,Wip=1000,',
    replace: '$ip=1e4,Wip=10.0,',
  },
  {
    name: 'session-search-warm-skip',
    find: 'warmSessionSearch:!e||e.length===0,',
    replace: 'warmSessionSearch:!1/*e.length*/,',
  },
  {
    name: 'zod-v3-lazy-bound-methods',
    find: `constructor(e){this.spa=this.safeParseAsync,this._def=e,${CONSTRUCTOR_BINDS.map(
      (name) => `this.${name}=this.${name}.bind(this),`,
    ).join('')}${STANDARD_SCHEMA}`,
    replace: `${LAZY_ACCESSORS}constructor(e){this._def=e,${STANDARD_SCHEMA}`,
  },
  {
    name: 'model-alias-lookup-set',
    find: 'if(e in JE)return e;if(Object.values(JE).includes(e))return e;return}',
    replace:
      'if(e in JE)return e;if((Sm.$o!==JE&&(Sm.$o=JE,Sm.$s=new Set(Object.values(JE))),Sm.$s).has(e))return e;return}',
  },
  {
    name: 'ink-string-width-grapheme-memo',
    find: 'for(let{segment:u}of Ehm.segment(i)){if(xhm(u))continue;if(Hhm.test(u)){a+=2;continue}let d=Dhm(u).codePointAt(0);a+=Fse(d,c),a+=khm(u,c)}if(o)FTl(e,a);return a}',
    replace:
      'let $m=n?b2e.$n:b2e.$w;for(let{segment:u}of Ehm.segment(i)){let $c=$m.get(u);if($c===void 0){if(xhm(u))$c=0;else if(Hhm.test(u))$c=2;else{let d=Dhm(u).codePointAt(0);$c=Fse(d,c)+khm(u,c)}if($m.size<2e4)$m.set(u,$c)}a+=$c}if(o)FTl(e,a);return a}',
  },
  {
    name: 'ink-string-width-grapheme-memo-init',
    find: 'Hhm=/^\\p{RGI_Emoji}$/v;nve=new Map});',
    replace: 'Hhm=/^\\p{RGI_Emoji}$/v;nve=new Map;b2e.$n=new Map;b2e.$w=new Map});',
  },
  {
    name: 'app-display-width-grapheme-memo',
    find: 'for(let{segment:c}of jFd.segment(o)){if(QFd(c))continue;if(VFd.test(c)){i+=2;continue}let u=zFd(c).codePointAt(0);i+=Fse(u,a),i+=XFd(c,a)}return i}',
    replace:
      'let $m=n?Qit.$n:Qit.$w;for(let{segment:c}of jFd.segment(o)){let $c=$m.get(c);if($c===void 0){if(QFd(c))$c=0;else if(VFd.test(c))$c=2;else{let u=zFd(c).codePointAt(0);$c=Fse(u,a)+XFd(c,a)}if($m.size<2e4)$m.set(c,$c)}i+=$c}return i}',
  },
  {
    name: 'app-display-width-grapheme-memo-init',
    find: 'VFd=/^\\p{RGI_Emoji}$/v});function pFr(e)',
    replace: 'VFd=/^\\p{RGI_Emoji}$/v;Qit.$n=new Map;Qit.$w=new Map});function pFr(e)',
  },
  {
    name: 'turn-clock-state',
    find: 'var rJ,pFl,IPm,wPm="\\uF418",',
    replace: `var ${TURN_CLOCK_STATE},rJ,pFl,IPm,wPm="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:A,updateNoticeDisplay:S}){let E=OPm(',
    replace: `isSessionArchived:A,updateNoticeDisplay:S}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let E=OPm(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'let M=zcc(a);if(M)jve(x,[ad(M,{color:fe.primary})]);let F=[];',
    replace: `let M=zcc(a);if(M)jve(x,[ad(M,{color:fe.primary})]);${TURN_CLOCK_PARTS}let F=[];`,
  },
  {
    name: 'auto-update-notice-only',
    find: 'if(!g)return Jj(a,"no-update"),"no-update";if(g.isRollback){',
    replace:
      'if(!g)return Jj(a,"no-update"),"no-update";return s7o({type:"update-available",version:g.version.version}),ve("Auto-update blocked by ovrdroid; run: ovrdroid update",{version:g.version.version}),Jj(a,"skipped"),"skipped";if(g.isRollback){',
  },
  {
    name: 'update-notice-command',
    find: 'available:"\\u2193 v{{version}} available",',
    replace: 'available:"\\u2193 v{{version}} available \\xB7 run: ovrdroid update",',
  },
  {
    name: 'command-menu-prefix-first',
    find: 'if(A&&S)return 1;if(A)return 2;if(S)return 3;return 4}',
    replace: 'if(S)return A?1:2;if(A)return 3;return 4}',
  },
  {
    name: 'command-catalog-mark-scanned',
    find: 'function lne(e){if(yJt.status===e.status',
    replace: 'function lne(e){if(e.status==="ready")lne.$done=!0;if(yJt.status===e.status',
  },
  {
    name: 'command-menu-loading-first-scan-only',
    find: 'isLoading:de.status==="refreshing"}',
    replace: 'isLoading:de.status==="refreshing"&&!lne.$done}',
  },
  {
    name: 'command-menu-visibility-same-commit',
    find: 'Lt=Np.useCallback((Do)=>{on({showCommands:Do}),oe(Do)},[on])',
    replace: 'Lt=Np.useCallback((Do)=>{on({showCommands:Do}),oe(Do),xe?.(Do)},[on,xe])',
  },
  {
    name: 'command-menu-visibility-reset-on-unmount',
    find: 'Np.useEffect(()=>{xe?.(K)},[K,xe]);',
    replace: 'Np.useEffect(()=>()=>{xe?.(!1)},[xe]);',
  },
  {
    name: 'settings-watch-after-paint',
    find: 'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,',
    replace:
      'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,setTimeout(()=>this.$ow(),400).unref?.()}$ow(){if(!this.watchingEnabled)return;this.watchingEnabled=!0,',
  },
  {
    name: 'draft-dismiss-no-rerender',
    find: 'let n=rJ.useCallback(()=>{t({type:"draft-edited"})},[]);return{display:e,dismissAfterDraftEdit:n}',
    replace:
      'let $r=rJ.useRef(e);$r.current=e;let n=rJ.useCallback(()=>{let s=$r.current;if(s.notice.kind==="hidden"||s.dismissed)return;t({type:"draft-edited"})},[]);return{display:e,dismissAfterDraftEdit:n}',
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
