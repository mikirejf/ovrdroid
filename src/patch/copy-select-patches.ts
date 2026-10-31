import type { Patch } from './patches.ts';

const LABEL_LINE_STOCK = `function xfe(g,y,S){let M=Math.max(1,Math.floor(g));if(M===1)return"\\u256D";if(M===2)return"\\u256D\\u256E";let v=M-2,E=S?\`\\u2500\\u2500 \${y} \\xB7 \${S} \`:void 0,A=E&&Z(E)<=v?E:\`\\u2500\\u2500 \${y} \`;if(Z(A)>v)return\`\\u256D\${"\\u2500".repeat(v)}\\u256E\`;return\`\\u256D\${A}\${"\\u2500".repeat(v-Z(A))}\\u256E\`}`;

const LABEL_LINE_STRAIGHT = `function xfe(g,y,S){let M=Math.max(1,Math.floor(g));if(M<=2)return"\\u2500".repeat(M);let v=M-2,E=S?\`\\u2500\\u2500 \${y} \\xB7 \${S} \`:void 0,A=E&&Z(E)<=v?E:\`\\u2500\\u2500 \${y} \`;if(Z(A)>v)return"\\u2500".repeat(M);return"\\u2500"+A+"\\u2500".repeat(v-Z(A))+"\\u2500"}`;

const BLOCKQUOTE_BAR =
  'paddingLeft:1,borderStyle:"single",borderLeft:!0,borderRight:!1,borderTop:!1,borderBottom:!1,borderColor:y.config.colors.blockquote,';

const LABELED_BOX_BODY =
  'paddingX:1,children:l(c,{flexDirection:"column",width:"100%",children:[Vs,al,da]})';

const PLAIN_BOX_SIDES = 'borderDimColor:!V,width:E,paddingX:Eh.paddingX,';

export const copySelectPatches: readonly Patch[] = [
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
