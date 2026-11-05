import type { Patch } from './patches.ts';

export const SHARED_CACHE_LINES = 512;

export const WRAP_CACHE_ENTRIES = 2048;

const STYLE_NEIGHBOURS = 'else e+=f(h(t[n-1].styles,o.styles));';

const INK_TOKENIZER_TAIL = String.raw`if(e+=o.value,n===t.length-1)e+=f(h(o.styles,[]))}return e}function y(t){if(!Number.isInteger(t))return!1;return GA(t)||zA(t)}var W=new Intl.Segmenter(void 0,{granularity:"grapheme"});function D(t,e){if(y(e))return!0;if(t.includes("\uFE0F"))return!0;if(e>=127462&&e<=127487)return!0;return!1}function Z(t,e){t=t.slice(e);for(let i=1;i<K.length;i++)if(t.charCodeAt(i)!==K[i])return;let n=t.indexOf(";",M.length);if(n===-1)return;let o=Q(`;

const WRAP_LINE = 'p=_n(h,i,{trim:!1,hard:!0,wordWrap:!1}).split(`\n`)';

export const inkFramePatches: readonly Patch[] = [
  {
    name: 'ink-style-diff-same-skip',
    find: `${STYLE_NEIGHBOURS}${INK_TOKENIZER_TAIL}`,
    replace: `else if(t[n-1].styles.length!==o.styles.length||t[n-1].styles.some(($ODs,$ODi)=>$ODs.code!==o.styles[$ODi].code||$ODs.endCode!==o.styles[$ODi].endCode))${STYLE_NEIGHBOURS.slice('else '.length)}${INK_TOKENIZER_TAIL}`,
  },
  {
    name: 'ink-output-caches-shared',
    find: 'caches=new BC;',
    replace: `caches=BC.$ODshared!==void 0&&BC.$ODshared.styledChars.size+BC.$ODshared.blockWidths.size<${SHARED_CACHE_LINES}?BC.$ODshared:BC.$ODshared=new BC;`,
  },
  {
    name: 'ink-frame-wrap-cache',
    find: WRAP_LINE,
    lookups: ['Gg=(e,i,l)=>{if(e==="")return[];'],
    replace: `p=(($ODm)=>{let $ODe=$ODm.get(h);if($ODe!==void 0&&$ODe.width===i)return $ODe.lines;let $ODl=_n(h,i,{trim:!1,hard:!0,wordWrap:!1}).split("\\n");if($ODm.size>=${WRAP_CACHE_ENTRIES})$ODm.clear();return $ODm.set(h,{width:i,lines:$ODl}),$ODl})(Gg.$ODwraps??=new Map)`,
  },
];
