import type { Patch } from './patches.ts';

export const SHARED_CACHE_LINES = 512;

export const WRAP_CACHE_ENTRIES = 2048;

const STYLE_NEIGHBOURS = 'else e+=f(h(t[n-1].styles,o.styles));';

const INK_TOKENIZER_TAIL = String.raw`if(e+=o.value,n===t.length-1)e+=f(h(o.styles,[]))}return e}function y(t){if(!Number.isInteger(t))return!1;return GA(t)||zA(t)}var W=new Intl.Segmenter(void 0,{granularity:"grapheme"});function D(t,e){if(y(e))return!0;if(t.includes("\uFE0F"))return!0;if(e>=127462&&e<=127487)return!0;return!1}function Z(t,e){t=t.slice(e);for(let i=1;i<K.length;i++)if(t.charCodeAt(i)!==K[i])return;let n=t.indexOf(";",M.length);if(n===-1)return;let o=Q(`;

const WRAP_LINE = 'p=_n(h,i,{trim:!1,hard:!0,wordWrap:!1}).split(`\n`)';

const ROWS_OF =
  'function $ODrowsOf($ODt,$ODc){return $ODt?Xa($ODt.split("\\n"),$ODt,$ODc).cursorLineCount:0}';

const SHRINK_PAD =
  'function $ODshrinkPad($ODs,$ODf,$ODl,$ODc,$ODr){if(!($ODr>0))return 0;' +
  'let $ODt=$ODs.$ODtop??0,$ODa=$ODt+($ODs.$ODh??0)>=$ODr;' +
  'if($ODl)$ODt+=$ODrowsOf($ODl,$ODc)-1;' +
  'let $ODn=Math.min($ODr,$ODrowsOf($ODf,$ODc)),$ODp=$ODa?Math.max(0,$ODr-$ODt-$ODn):0;' +
  '$ODs.$ODh=$ODn+$ODp;$ODs.$ODtop=Math.max(0,Math.min($ODt,$ODr-$ODs.$ODh));return $ODp}';

const CURSOR_SHIFT =
  'function $ODshift($ODc,$ODp){if(!$ODc||!$ODp)return $ODc;let $ODn={...$ODc};$ODn.y+=$ODp;return $ODn}';

export const SHRINK_HELPERS = `${ROWS_OF}${SHRINK_PAD}${CURSOR_SHIFT}`;

const INK_CLASS = 'class dg{options;log;cursorPosition;throttledLog;';

const ROWS_SOURCE = 'Xa=(e,i,l,g,s=!0)=>{let E=Jf(e,i);if(E.length===0){';

const FRAME_WRITE_HEAD =
  'let y=Ka(E).columns,N=E.isTTY&&E.rows>0?$S(e,y,E.rows):void 0,U=N!==void 0,';

const FRAME_WRITE_TAIL =
  ';if(this.log.setCursorPosition(this.cursorPosition),s){let T=this.shouldSync();if(T)E.write(ki);if(this.log.clear(),E.write(l),';

const SHIFTED_TAIL = FRAME_WRITE_TAIL.replace(
  'setCursorPosition(this.cursorPosition)',
  'setCursorPosition($ODshift(this.cursorPosition,$ODp))',
);

const VIEWPORT_REPAINT = 'let oA=AN(this.fullStaticOutput,Z,T,q,K===void 0?void 0:J);';

const HEIGHT_RESIZE = 'if(this.log.resizeClear()){';

const INVALIDATE = 'invalidateOutput=(e=!1)=>{if(this.log.reset(),';

const RESET_ANCHOR = 'this.$ODtop=this.$ODh=0';

export const inkShrinkPatches: readonly Patch[] = [
  {
    name: 'ink-shrink-repaint-helpers',
    find: INK_CLASS,
    lookups: [ROWS_SOURCE],
    replace: `${SHRINK_HELPERS}${INK_CLASS}`,
  },
  {
    name: 'ink-shrink-repaint-pad',
    find: `${FRAME_WRITE_HEAD}z=N??e+\`\n\`${FRAME_WRITE_TAIL}`,
    replace: `${FRAME_WRITE_HEAD}$ODp=$ODshrinkPad(this,N??e+\`\n\`,s?l:"",y,E.isTTY?E.rows:0),z="\\n".repeat($ODp)+(N??e+\`\n\`)${SHIFTED_TAIL}`,
  },
  {
    name: 'ink-shrink-repaint-viewport',
    find: VIEWPORT_REPAINT,
    replace: `${VIEWPORT_REPAINT}this.$ODh=Math.min(q,$ODrowsOf(Z,T)),this.$ODtop=Math.max(0,Math.min(q,oA.split("\\n").length)-this.$ODh);`,
  },
  {
    name: 'ink-shrink-repaint-resize',
    find: HEIGHT_RESIZE,
    replace: `${HEIGHT_RESIZE}${RESET_ANCHOR};`,
  },
  {
    name: 'ink-shrink-repaint-reset',
    find: INVALIDATE,
    replace: `invalidateOutput=(e=!1)=>{if(${RESET_ANCHOR},this.log.reset(),`,
  },
];
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
  ...inkShrinkPatches,
];
