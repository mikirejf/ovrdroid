export interface Patch {
  name: string;
  find: string;
  replace: string;
}

const MARKER_PREFIX = 'globalThis.__overdroid="';
const DIGEST_LENGTH = 12;
const DIGEST_PATTERN = /^[0-9a-f]+$/u;

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
    replace: 'FoH="timeout",yQB=1e4,cQB=100.,',
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
