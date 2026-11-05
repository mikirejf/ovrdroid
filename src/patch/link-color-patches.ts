import type { Patch } from './patches.ts';

const INLINE_HEAD = 'function rC(g,S,E,k){let R=ys(E.parentColor||k.color,k),';
const LINK_STYLE = 'I={...k,color:pu(E,k,"link")},';
const LINK_CHILDREN =
  'W=(j)=>{let q=new nC(!1);if(typeof j==="string")q.text(j,ys(I.color,I));else rC(q,j,E,I);return q.current};';

export const linkColorPatches: readonly Patch[] = [
  {
    name: 'markdown-link-color',
    find: INLINE_HEAD + LINK_STYLE + LINK_CHILDREN,
    replace: `${INLINE_HEAD}I={...k,color:E.config.colors.link},${LINK_CHILDREN.replace('rC(q,j,E,I)', 'rC(q,j,{...E,parentColor:I.color},I)')}`,
  },
];
