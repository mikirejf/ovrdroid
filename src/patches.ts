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
    name: 'draft-dismiss-no-rerender',
    find: 'let H=PV.useCallback(()=>{R({type:"draft-edited"})},[]);return{display:T,dismissAfterDraftEdit:H}',
    replace:
      'let $r=PV.useRef(T);$r.current=T;let H=PV.useCallback(()=>{let s=$r.current;if(s.notice.kind==="hidden"||s.dismissed)return;R({type:"draft-edited"})},[]);return{display:T,dismissAfterDraftEdit:H}',
  },
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
