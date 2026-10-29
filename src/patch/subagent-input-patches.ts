import type { Patch } from './patches.ts';

const SUBAGENT_LABEL = 'SUBAGENT';
const SUBAGENT_COLOR = 'magenta';

export const IS_SUBAGENT = 'gP?.some(($ODt)=>$ODt.name==="subagent")??!1';

export const HEAVY_TOP =
  '.replace(/[\\u256D\\u2500\\u256E]/g,($ODc)=>({"\\u256D":"\\u250F","\\u2500":"\\u2501","\\u256E":"\\u2513"})[$ODc])';

const STOCK_DETECT_TAIL =
  'gP=Loe??(Wo===m().getCurrentSessionId()?m().getCurrentSessionTags():void 0),kg=en(gP??void 0),';

const STOCK_FRAME =
  'cs=Ze?a.missionV2:As?a.spec:ci?a.agi:void 0,' +
  'us=Ze?a.missionV2:As?a.spec:ci?a.success:void 0,' +
  'Pa=Ze&&Je?Fh(Je):void 0,ds=co?Lge(I,co,Pa):void 0,';

const STOCK_BOX =
  't(c,{width:I,children:t(o,{color:cs,dimColor:!W,children:ds})}),' +
  't(c,{borderStyle:"round",borderColor:cs,borderDimColor:!W,borderTop:!1,width:I,';

export const subagentInputPatches: readonly Patch[] = [
  {
    name: 'subagent-input-prop',
    find: 'draftPastedBlocksRef:Jt}){',
    replace: 'draftPastedBlocksRef:Jt,$ODsubagent}){',
  },
  {
    name: 'subagent-input-label',
    find: 'co=Ze?wn:As?ss:ci?as:void 0,',
    replace: `co=$ODsubagent?${JSON.stringify(SUBAGENT_LABEL)}:Ze?wn:As?ss:ci?as:void 0,`,
  },
  {
    name: 'subagent-input-magenta-heavy-label',
    find: STOCK_FRAME,
    replace:
      `cs=$ODsubagent?${JSON.stringify(SUBAGENT_COLOR)}:Ze?a.missionV2:As?a.spec:ci?a.agi:void 0,` +
      'us=Ze?a.missionV2:As?a.spec:ci?a.success:void 0,' +
      'Pa=$ODsubagent?void 0:Ze&&Je?Fh(Je):void 0,' +
      `ds=co?$ODsubagent?Lge(I,co,Pa)${HEAVY_TOP}:Lge(I,co,Pa):void 0,`,
  },
  {
    name: 'subagent-input-bold-bright-border',
    find: STOCK_BOX,
    replace:
      't(c,{width:I,children:t(o,{color:cs,dimColor:!W&&!$ODsubagent,children:ds})}),' +
      't(c,{borderStyle:$ODsubagent?"bold":"round",borderColor:cs,borderDimColor:!W&&!$ODsubagent,borderTop:!1,width:I,',
  },
  {
    name: 'subagent-input-passes-flag',
    find: 'missionTitle:Ig?wG(Ig,Wo):void 0,',
    lookups: [STOCK_DETECT_TAIL],
    replace: `missionTitle:Ig?wG(Ig,Wo):void 0,$ODsubagent:${IS_SUBAGENT},`,
  },
];
