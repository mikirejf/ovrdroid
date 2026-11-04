import type { Patch } from './patches.ts';

const LABEL_LINE_STOCK = `function xfe(g,y,S){let M=Math.max(1,Math.floor(g));if(M===1)return"\\u256D";if(M===2)return"\\u256D\\u256E";let v=M-2,E=S?\`\\u2500\\u2500 \${y} \\xB7 \${S} \`:void 0,A=E&&Z(E)<=v?E:\`\\u2500\\u2500 \${y} \`;if(Z(A)>v)return\`\\u256D\${"\\u2500".repeat(v)}\\u256E\`;return\`\\u256D\${A}\${"\\u2500".repeat(v-Z(A))}\\u256E\`}`;

const LABEL_LINE_STRAIGHT = `function xfe(g,y,S){let M=Math.max(1,Math.floor(g));if(M<=2)return"\\u2500".repeat(M);let v=M-2,E=S?\`\\u2500\\u2500 \${y} \\xB7 \${S} \`:void 0,A=E&&Z(E)<=v?E:\`\\u2500\\u2500 \${y} \`;if(Z(A)>v)return"\\u2500".repeat(M);return"\\u2500"+A+"\\u2500".repeat(v-Z(A))+"\\u2500"}`;

const BLOCKQUOTE_BAR =
  'paddingLeft:1,borderStyle:"single",borderLeft:!0,borderRight:!1,borderTop:!1,borderBottom:!1,borderColor:y.config.colors.blockquote,';

const LABELED_BOX_BODY =
  'paddingX:1,children:l(c,{flexDirection:"column",width:"100%",children:[Vs,al,da]})';

const PLAIN_BOX_SIDES = 'borderDimColor:!V,width:E,paddingX:Eh.paddingX,';

const EARLY_INPUT_BOX = String.raw`function OTe({handoff:e,width:n,windowsLike:t}){let o=HV(t),r={color:a.border},s=e.draft.length===0,i=D2({wrappedLayout:N2({value:s?e.placeholder:e.draft,maxLineWidth:qM(n)}),cursorOffset:s?0:e.cursor}),l=s?{dim:!0}:void 0,c=[{text:"\u2500".repeat(Math.max(0,n-2)),style:r}],u=[];u.push(o.hasBorder?[{text:"\u256D",style:r},...c,{text:"\u256E",style:r}]:[]);for(let p=0;p<i.displayLines.length;p++){let x=i.displayLines[p]??"",m=[];if(o.hasBorder)m.push({text:"\u2502",style:r});if(m.push({text:" ".repeat(o.paddingX)}),m.push({text:p===0?"> ":"  ",style:{color:a.primary}}),p===i.cursorLine){let{cursorCol:h}=i;m.push({text:x.slice(0,h),style:l}),m.push({text:x[h]??" ",style:{inverse:!0}}),m.push({text:x.slice(h+1),style:l})}else m.push({text:x,style:l});if(o.hasBorder)m.push({text:" ".repeat(Math.max(0,n-mt(m)-1))}),m.push({text:"\u2502",style:r});u.push(m)}return u.push(o.hasBorder?[{text:"\u2570",style:r},...c,{text:"\u256F",style:r}]:[]),u}`;

export const copySelectPatches: readonly Patch[] = [
  {
    name: 'copy-select-early-input-flat',
    find: EARLY_INPUT_BOX,
    replace: EARLY_INPUT_BOX.replaceAll(
      /\\u(?:256D|256E|2570|256F)/gu,
      String.raw`\u2500`,
    ).replaceAll(String.raw`\u2502`, ' '),
  },
  {
    name: 'copy-select-blockquote-flat',
    find: BLOCKQUOTE_BAR,
    replace: '',
  },
  {
    name: 'copy-select-label-line-straight',
    find: LABEL_LINE_STOCK,
    replace: LABEL_LINE_STRAIGHT,
  },
  {
    name: 'copy-select-labeled-box-no-sides',
    find: LABELED_BOX_BODY,
    replace: LABELED_BOX_BODY.replace('paddingX:1,', 'paddingX:2,borderLeft:!1,borderRight:!1,'),
  },
  {
    name: 'copy-select-plain-box-no-sides',
    find: PLAIN_BOX_SIDES,
    replace:
      'borderDimColor:!V,borderLeft:!1,borderRight:!1,width:E,paddingX:Eh.paddingX+(Eh.hasBorder?1:0),',
  },
];
