import type { Patch } from './patches.ts';

export const UNWRAPPED = 'overflow';

export const CODE_COPY_GLOBAL = '__odCodeCopy';

export const UNWRAP_KEY = 'unwrapCode';

const TEXT_PROPS =
  'color:e,backgroundColor:i,dimColor:l=!1,bold:u=!1,italic:s=!1,underline:C=!1,strikethrough:f=!1,inverse:h=!1,';

const TEXT_TAIL =
  'children:N,"aria-label":M,"aria-hidden":X=!1}){let{isScreenReaderEnabled:O}=Be(Wn),K=Be(Dg),';

const LABEL =
  'A.showCodeLanguage&&D?t(c,{children:t(o,{color:a.text.muted,italic:!0,children:D})}):null';

const STOCK_BLOCK = `return l(c,{flexDirection:"column",borderLeft:!0,borderColor:a.text.muted,width:A.maxWidth,children:[${LABEL},t(c,{paddingLeft:2,width:"100%",children:bse(O,A,D)})]},E)}`;

const FLAT_BLOCK = `if(A.${UNWRAP_KEY})return l(c,{flexDirection:"column",width:A.maxWidth,children:[${LABEL},t(globalThis.${CODE_COPY_GLOBAL}.wrap.Provider,{value:"${UNWRAPPED}",children:t(c,{flexDirection:"column",width:"100%",children:bse(O,A,D)})})]},E);`;

const MESSAGE_MARKDOWN =
  'f.messageType==="markdown"?t(Da,{maxWidth:y,color:f.role==="assistant"?a.markdown.heading:f.role==="tool"?a.toolName:q,children:Q})';

export const NO_BREAK_SPACE = '\u00A0';

const NO_BREAK_SPACE_ESCAPE = String.raw`"\xa0"`;

export const codeCopyPatches: readonly Patch[] = [
  {
    name: 'code-copy-inline-code-joined',
    find: 'case"inlineCode":f.segment(rt(F.value,',
    replace: `case"inlineCode":f.segment(rt(F.value.replaceAll(" ",${NO_BREAK_SPACE_ESCAPE}),`,
  },
  {
    name: 'code-copy-no-break-space-joins-words',
    find: 'function z(n){return/\\s/.test(n.text)}',
    replace: `function z(n){return n.text!==${NO_BREAK_SPACE_ESCAPE}&&/\\s/.test(n.text)}`,
  },
  {
    name: 'code-copy-no-break-space-printed-plain',
    find: 'e+=l.text,r=l.style,i=l.url}',
    replace: `e+=l.text.replaceAll(${NO_BREAK_SPACE_ESCAPE}," "),r=l.style,i=l.url}`,
  },
  {
    name: 'code-copy-text-wrap-context',
    find: `function o({${TEXT_PROPS}wrap:p="wrap",${TEXT_TAIL}`,
    lookups: ['Dg=Ct(void 0)'],
    replace: `var $ODcopy=globalThis.${CODE_COPY_GLOBAL}={wrap:Ct("wrap"),config:{${UNWRAP_KEY}:!0}};function o({${TEXT_PROPS}wrap:p,${TEXT_TAIL}$ODinherited=Be($ODcopy.wrap);p??=$ODinherited;let `,
  },
  {
    name: 'code-copy-block-unwrapped',
    find: STOCK_BLOCK,
    replace: `${FLAT_BLOCK}${STOCK_BLOCK}`,
  },
  {
    name: 'code-copy-transcript-markdown',
    find: MESSAGE_MARKDOWN,
    replace: MESSAGE_MARKDOWN.replace(
      't(Da,{maxWidth:y,',
      `t(Da,{maxWidth:y,config:globalThis.${CODE_COPY_GLOBAL}.config,`,
    ),
  },
];
