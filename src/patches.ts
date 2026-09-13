export interface Patch {
  name: string;
  find: string;
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
];

export function markerDigest(list: readonly Patch[] = patches): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(list.map((patch) => `${patch.name}|${patch.find}|${patch.replace}`).join('\n'));
  return hasher.digest('hex').slice(0, 12);
}

export function markerStatement(list: readonly Patch[] = patches): string {
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
