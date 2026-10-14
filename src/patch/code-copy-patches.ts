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

const STOCK_BLOCK = `return l(c,{flexDirection:"column",borderLeft:!0,borderColor:a.text.muted,width:A.maxWidth,children:[${LABEL},t(c,{paddingLeft:uS,width:"100%",children:bse(O,A,D)})]},E)}`;

const FLAT_BLOCK = `if(A.${UNWRAP_KEY})return l(c,{flexDirection:"column",width:A.maxWidth,children:[${LABEL},t(globalThis.${CODE_COPY_GLOBAL}.wrap.Provider,{value:"${UNWRAPPED}",children:t(c,{flexDirection:"column",width:"100%",children:bse(O,A,D)})})]},E);`;

const MESSAGE_MARKDOWN =
  'f.messageType==="markdown"?t(Da,{maxWidth:y,color:f.role==="assistant"?a.markdown.heading:f.role==="tool"?a.toolName:q,children:Q})';

export const NO_BREAK_SPACE = '\u00A0';

const NO_BREAK_SPACE_ESCAPE = String.raw`"\xa0"`;

export const COPY_PROMPT_LINE =
  '- Put any command the user may copy and run in a fenced code block, not as inline code in a sentence, so a terminal copy pastes it whole.';

const PROMPT_EXPRESSION = `\n\`+${JSON.stringify(COPY_PROMPT_LINE)}+\``;

const COMMUNICATION_HEAD =
  '- Before a long-running step, post one brief progress note. Do not interrupt short work or recap after every tool call.\n- Name what a tool accomplished, not the tool. Include identifiers only when the user is working with them.\n- Format only when structure carries meaning. No emojis unless requested.';

const SHORT_COMMUNICATION =
  '# Communication\n- In final responses, lead with the outcome, then include only what the user needs to understand or verify it.\n';

const LONG_COMMUNICATION = '- Use short sentences. Keep each paragraph focused on one topic.\n';

const WRAP_LINES_HEAD =
  'function H(n,t){let e=Math.max(1,Math.floor(t)),r=[],i=[],o=0,l=()=>{r.push(i),i=[],o=0};for(let a of G(n)){let c=a.length>0&&!z(a[0]),u=h(a),s=a,m=u;while(s.length>0){let f=e-o;if(f<=0){l();continue}if(m<=f){i.push(...s),o+=m,s=[],m=0;continue}if(c&&u<=e&&o>0){l();continue}';

const WRAP_LINES_WHOLE = WRAP_LINES_HEAD.replace('function H(n,t){', 'function H(n,t,$ODwhole){')
  .replace(
    'if(f<=0){l();continue}',
    'if(f<0&&$ODwhole&&!c){s=[],m=0;continue}if(f<=0){l();continue}',
  )
  .replace('if(m<=f){', 'if(m<=f||$ODwhole&&c&&!o){')
  .replace('if(c&&u<=e&&o>0)', 'if(c&&(u<=e||$ODwhole)&&o>0)');

const WRAP_ENTRY =
  'function VH(n,t){let e=Math.max(1,Math.floor(t)),r=k(n);if(h(r)<=e)return[B(r)];return H(k(n,void 0,!0),e).map(B)}';

const PARAGRAPH_LINES =
  'function dS(f,w){let v=w.config.maxWidth??Pse;return f.flatMap((k)=>FO(k,v))}';

const PARAGRAPH_TEXT =
  'function HM(f,w,v){let k=dS(f,w);return t(o,{italic:w.config.italic,children:k.join(`\n`)||" "},v)}';

export const codeCopyPatches: readonly Patch[] = [
  {
    name: 'code-copy-prompt-short',
    find: `${SHORT_COMMUNICATION}${COMMUNICATION_HEAD}`,
    replace: `${SHORT_COMMUNICATION}${COMMUNICATION_HEAD}${PROMPT_EXPRESSION}`,
  },
  {
    name: 'code-copy-prompt-long',
    find: `${LONG_COMMUNICATION}${COMMUNICATION_HEAD}`,
    replace: `${LONG_COMMUNICATION}${COMMUNICATION_HEAD}${PROMPT_EXPRESSION}`,
  },
  {
    name: 'code-copy-long-word-whole',
    find: WRAP_LINES_HEAD,
    replace: WRAP_LINES_WHOLE,
  },
  {
    name: 'code-copy-long-word-entry',
    find: WRAP_ENTRY,
    replace: WRAP_ENTRY.replace('function VH(n,t){', 'function VH(n,t,$ODwhole){').replace(
      'H(k(n,void 0,!0),e)',
      'H(k(n,void 0,!0),e,$ODwhole)',
    ),
  },
  {
    name: 'code-copy-paragraph-lines-unwrapped',
    find: PARAGRAPH_LINES,
    replace: PARAGRAPH_LINES.replace('FO(k,v)', `FO(k,v,w.config.${UNWRAP_KEY})`),
  },
  {
    name: 'code-copy-paragraph-text-unwrapped',
    find: PARAGRAPH_TEXT,
    replace: PARAGRAPH_TEXT.replace(
      'italic:w.config.italic,',
      `italic:w.config.italic,wrap:w.config.${UNWRAP_KEY}?"${UNWRAPPED}":void 0,`,
    ),
  },
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
