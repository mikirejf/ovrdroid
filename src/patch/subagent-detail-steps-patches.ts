import type { Patch } from './patches.ts';

const DETAIL_STEPS =
  'function $ODDetailSteps({input:$ODin,toolUseId:$ODid,progressUpdates:$ODpu,step:$ODstep}){' +
  'let{updates:$ODup}=phe({input:$ODin,progressUpdates:$ODpu,toolUseId:$ODid}),' +
  '$ODrows=$ODup.map($ODstep).filter(Boolean),' +
  '$ODn=$ODrows.length,$ODcut=$ODn>N1,$ODshow=$ODcut?$ODrows.slice(-N1):$ODrows;' +
  'return $ODn>0?l(c,{flexDirection:"column",children:[$ODcut&&t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.earlierUpdates",{count:$ODn-N1})}),' +
  '$ODshow.map(($ODr)=>t(c,{children:$ODr.node},$ODr.key))]}):t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.initializingDetail")})}';

const STOCK_TASK_RESULT =
  'function ghe(f){let{updates:y,liveSummary:E,invocationSummary:A}=phe(f);return fhe({...f,progressUpdates:y,liveSummary:E,invocationSummary:A})}';

const STOCK_DETAIL_ARGS =
  'renderDetailedView({input:f,result:y,isError:E,progressUpdates:A}){let{subagent_type:D,description:O,prompt:F}=f,';

const STOCK_DETAIL_HEAD =
  `${STOCK_DETAIL_ARGS}K=xe(y),q=y!==void 0,G=A??[],j=[];` +
  'G.forEach((oe,re)=>{let le=null;switch(oe.type){case"status":{';

const PATCHED_DETAIL_HEAD =
  'renderDetailedView({input:f,result:y,isError:E,progressUpdates:A,toolUseId:$ODtid}){let{subagent_type:D,description:O,prompt:F}=f,' +
  'K=xe(y),q=y!==void 0,G=A??[],j=[];' +
  'function $ODstep(oe,re){let le=null;switch(oe.type){case"status":{';

const STOCK_DETAIL_TAIL =
  'node:l(o,{color:a.error,children:["\\u26A0 ",oe.error]})};break}default:break}if(le)j.push(le)});let Z=j.length,Q=Z>N1,';

const PATCHED_DETAIL_TAIL =
  'node:l(o,{color:a.error,children:["\\u26A0 ",oe.error]})};break}default:break}return le}let Z=j.length,Q=Z>N1,';

const STOCK_DETAIL_TOOL =
  '{toolName:f.toolName,toolInput:f.toolInput,status:f.status,result:f.detailedContent||f.result,';

const STOCK_DETAIL_OUTPUT =
  'children:!q?X.length>0?l(c,{flexDirection:"column",children:[Q&&t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.earlierUpdates",{count:Z-N1})}),' +
  'X.map((oe)=>t(c,{children:oe.node},oe.key))]}):t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.initializingDetail")}):';

const PATCHED_DETAIL_OUTPUT =
  'children:!q?t($ODDetailSteps,{input:f,toolUseId:$ODtid,progressUpdates:A,step:$ODstep}):';

export const subagentDetailStepsPatches: readonly Patch[] = [
  {
    name: 'subagent-detail-steps-component',
    find: STOCK_TASK_RESULT,
    lookups: [
      'var U2=200,N1=10;function Sy(',
      'l(c,{flexDirection:"column",marginBottom:1,children:[t(o,{color:a.text.muted,bold:!0,children:u().t("common:toolDisplay.task.inputLabel")})',
    ],
    replace: `${STOCK_TASK_RESULT}${DETAIL_STEPS}`,
  },
  {
    name: 'subagent-ui-detail-step',
    find: STOCK_DETAIL_HEAD,
    replace: PATCHED_DETAIL_HEAD,
  },
  {
    name: 'subagent-ui-detail-step-returns',
    find: STOCK_DETAIL_TAIL,
    replace: PATCHED_DETAIL_TAIL,
  },
  {
    name: 'subagent-ui-detail-knows-tool-use',
    find: STOCK_DETAIL_TOOL,
    replace: STOCK_DETAIL_TOOL.replace(
      '{toolName:f.toolName,',
      '{toolUseId:f.toolName==="Task"?f.id:void 0,toolName:f.toolName,',
    ),
  },
  {
    name: 'subagent-ui-detail-live-steps',
    find: STOCK_DETAIL_OUTPUT,
    lookups: [STOCK_DETAIL_ARGS],
    replace: PATCHED_DETAIL_OUTPUT,
  },
];
