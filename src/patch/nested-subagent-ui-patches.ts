import type { Patch } from './patches.ts';

export const NEST_UI_DEPTH = 3;

export const TASK_NAME =
  'function $ODtaskName($ODi){let $ODr=typeof $ODi.resume==="string"?$ODi.resume.trim():"",$ODq=$ODr?qg($ODr):void 0,' +
  '$ODt=$ODq?.subagentType||(typeof $ODi.subagent_type==="string"?$ODi.subagent_type:"");' +
  `return{name:$ODr?\`Resume \${$ODt||"subagent"}\`:$ODt||"Task",description:$ODq?.description||(typeof $ODi.description==="string"?$ODi.description:"")}}`;

export const IS_TASK_STEP =
  'function $ODtaskStepOf($ODu){return!!$ODu&&$ODu.toolName==="Task"&&($ODu.type==="tool_call"||$ODu.type==="tool_result")}';

export const NESTS = `function $ODnests($ODu,$ODd){return $ODtaskStepOf($ODu)&&!!$ODu.toolUseId&&!!$ODu.subagentSessionId&&$ODd<${NEST_UI_DEPTH}}`;

const COMPACT_LABEL = `function $ODcompactLabel($ODi){let $ODn=$ODtaskName($ODi);return $ODn.description?\`\${$ODn.name} "\${by($ODn.description)}"\`:$ODn.name}`;

const NEST_ROW =
  'function $ODNestRow({update:$ODu,depth:$ODd}){let $ODin=$ODu.parameters??{},' +
  '$ODres=$ODu.type==="tool_result"?$ODu.fullOutput??$ODu.text:void 0,' +
  '{updates:$ODup,liveSummary:$ODls,invocationSummary:$ODis}=phe({input:$ODin,result:$ODres,toolUseId:$ODu.toolUseId,parentSessionId:$ODu.subagentSessionId});' +
  'return fhe({input:$ODin,result:$ODres,isError:$ODu.type==="tool_result"&&$ODu.status==="error",progressUpdates:$ODup,liveSummary:$ODls,invocationSummary:$ODis,nestDepth:$ODd})}';

const TASK_DETAIL_STEP =
  'function $ODtaskDetailStep($ODu,$ODk,$ODstep,$ODd){if($ODu.type!=="tool_call"||$ODu.toolName!=="Task")return null;' +
  `let $ODn=$ODtaskName($ODu.parameters??{}),$ODkey=\`call-\${$ODk}\`,` +
  `$ODline=l(o,{color:a.text.muted,children:["\\u21B3 ",$ODn.description?\`\${$ODn.name} (\${$ODn.description})\`:$ODn.name]});` +
  'if(!$ODnests($ODu,$ODd))return{key:$ODkey,node:$ODline};' +
  'return{key:$ODkey,node:l(c,{flexDirection:"column",children:[$ODline,' +
  't(c,{marginLeft:4,flexDirection:"column",children:t($ODNestList,{update:$ODu,depth:$ODd+1,step:$ODstep},$ODu.toolUseId)})]})}}';

const STEP_ROWS =
  'function $ODstepRows($ODup,$ODstep,$ODd){let $ODrows=[];' +
  '$ODup.forEach(($ODx,$ODi)=>{let $ODr=$ODtaskDetailStep($ODx,$ODi,$ODstep,$ODd)??$ODstep($ODx,$ODi);if($ODr)$ODrows.push($ODr)});return $ODrows}';

const DETAIL_STEPS =
  'function $ODDetailSteps({input:$ODin,toolUseId:$ODid,progressUpdates:$ODpu,step:$ODstep}){' +
  'let{updates:$ODup}=phe({input:$ODin,progressUpdates:$ODpu,toolUseId:$ODid}),$ODrows=$ODstepRows($ODup,$ODstep,1),' +
  '$ODn=$ODrows.length,$ODcut=$ODn>N1,$ODshow=$ODcut?$ODrows.slice(-N1):$ODrows;' +
  'return $ODn>0?l(c,{flexDirection:"column",children:[$ODcut&&t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.earlierUpdates",{count:$ODn-N1})}),' +
  '$ODshow.map(($ODr)=>t(c,{children:$ODr.node},$ODr.key))]}):t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.initializingDetail")})}';

const NEST_LIST =
  'function $ODNestList({update:$ODu,depth:$ODd,step:$ODstep}){let $ODin=$ODu.parameters??{},' +
  '{updates:$ODup,liveSummary:$ODls,invocationSummary:$ODis}=phe({input:$ODin,toolUseId:$ODu.toolUseId,parentSessionId:$ODu.subagentSessionId}),' +
  '$ODrows=$ODstepRows($ODup,$ODstep,$ODd);' +
  'let $ODs=$ODis?.status,$ODend=$ODs==="completed"||$ODs==="cancelled"||$ODs==="failed"||$ODrows.length===0' +
  `?fhe({input:$ODin,progressUpdates:$ODup,liveSummary:$ODls,invocationSummary:$ODis,nestDepth:${NEST_UI_DEPTH}}):null;` +
  'return l(c,{flexDirection:"column",children:[...$ODrows.map(($ODr)=>t(c,{children:$ODr.node},$ODr.key)),$ODend]})}';

const STOCK_CHILD_LOOKUP =
  'toolUseId:A,ssmChildSessionId:D}){let O=dhe(y);if(O)return O;let F=uhe(E);if(F)return F;' +
  'if(typeof f.resume==="string"&&f.resume.trim())return f.resume.trim();if(D)return D;if(!A)return;' +
  'let K=m().getCurrentSessionId();if(!K)return;return lp({parentSessionId:K,parentToolUseId:A})?.childSessionId}' +
  'function phe({input:f,progressUpdates:y,result:E,toolUseId:A}){let D=B(()=>N().getSessionStateManager(),[]),' +
  'O=O2({ssm:D,parentSessionId:m().getCurrentSessionId(),toolUseId:A}),' +
  'F=B(()=>mhe({input:f,progressUpdates:y,result:E,toolUseId:A,ssmChildSessionId:O}),[f,y,E,A,O])';

const PATCHED_CHILD_LOOKUP =
  'toolUseId:A,ssmChildSessionId:D,parentSessionId:$ODps}){let O=dhe(y);if(O)return O;let F=uhe(E);if(F)return F;' +
  'if(typeof f.resume==="string"&&f.resume.trim())return f.resume.trim();if(D)return D;if(!A)return;' +
  'let K=$ODps??m().getCurrentSessionId();if(!K)return;return lp({parentSessionId:K,parentToolUseId:A})?.childSessionId}' +
  'function phe({input:f,progressUpdates:y,result:E,toolUseId:A,parentSessionId:$ODps}){let D=B(()=>N().getSessionStateManager(),[]),' +
  'O=O2({ssm:D,parentSessionId:$ODps??m().getCurrentSessionId(),toolUseId:A}),' +
  'F=B(()=>mhe({input:f,progressUpdates:y,result:E,toolUseId:A,ssmChildSessionId:O,parentSessionId:$ODps}),[f,y,E,A,O,$ODps])';

const STOCK_COMPACT_ARGS_END = 'invocationSummary:O}){';

const STOCK_LATEST_STEP =
  'else me=Sy(be)||be.text||A1(be.details)||u().t("common:toolDisplay.task.statusUpdate");';

const TRUNCATE_STEP = `if(me.length>80)me=\`\${me.slice(0,77)}...\`;`;

const STOCK_GHE =
  'function ghe(f){let{updates:y,liveSummary:E,invocationSummary:A}=phe(f);return fhe({...f,progressUpdates:y,liveSummary:E,invocationSummary:A})}';

const STOCK_COMPACT_TAIL = `${STOCK_LATEST_STEP}${TRUNCATE_STEP}return l(o,{color:a.text.muted,children:["\\u21B3 ",me]})}${STOCK_GHE}`;

const PATCHED_COMPACT_TAIL =
  `${STOCK_LATEST_STEP}if($ODtaskStepOf(be))me=$ODcompactLabel(be.parameters??{});` +
  `${TRUNCATE_STEP}let $ODline=l(o,{color:a.text.muted,children:["\\u21B3 ",me]});` +
  'return $ODnests(be,$ODdepth)?l(c,{flexDirection:"column",children:[$ODline,' +
  't(c,{marginLeft:2,children:t($ODNestRow,{update:be,depth:$ODdepth+1},be.toolUseId)})]}):$ODline}' +
  `${STOCK_GHE}${TASK_NAME}${IS_TASK_STEP}${NESTS}${COMPACT_LABEL}${NEST_ROW}${TASK_DETAIL_STEP}${STEP_ROWS}${DETAIL_STEPS}${NEST_LIST}`;

const RENDER_CHUNK_LOOKUPS = [
  'var U2=200,N1=10;function Sy(',
  'l(c,{flexDirection:"column",marginBottom:1,children:[t(o,{color:a.text.muted,bold:!0,children:u().t("common:toolDisplay.task.inputLabel")})',
  'getHeaderBadge:lhe,getHeaderLabel:che};function qg(',
  `?.description;return K?\`"\${by(K)}"\`:""}`,
];

export const TASK_BOX_MAX_ROWS = 1 + NEST_UI_DEPTH;

const STOCK_TASK_BOX =
  'if(f.toolName==="Task")return Q(t(c,{height:2,overflow:"hidden",children:X}));return X}';

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
  'function NV(f,y,E){return t(Zp,{toolName:f.toolName,toolInput:f.toolInput,status:f.status,result:f.detailedContent||f.result,';

const STOCK_DETAIL_OUTPUT =
  'children:!q?X.length>0?l(c,{flexDirection:"column",children:[Q&&t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.earlierUpdates",{count:Z-N1})}),' +
  'X.map((oe)=>t(c,{children:oe.node},oe.key))]}):t(o,{color:a.text.muted,children:u().t("common:toolDisplay.task.initializingDetail")}):';

const PATCHED_DETAIL_OUTPUT =
  'children:!q?t($ODDetailSteps,{input:f,toolUseId:$ODtid,progressUpdates:A,step:$ODstep}):';

export const nestedSubagentUiPatches: readonly Patch[] = [
  {
    name: 'nested-subagent-ui-task-call-carries-id',
    find: 'update:{type:"tool_call",toolName:S.name,',
    replace: 'update:{type:"tool_call",toolName:S.name,toolUseId:S.id,',
  },
  {
    name: 'nested-subagent-ui-task-result-carries-id',
    find: '{type:"tool_result",toolName:c.call?.name??c.block.toolUseId,',
    replace:
      '{type:"tool_result",toolName:c.call?.name??c.block.toolUseId,toolUseId:c.block.toolUseId,',
  },
  {
    name: 'nested-subagent-ui-child-of-any-parent',
    find: STOCK_CHILD_LOOKUP,
    replace: PATCHED_CHILD_LOOKUP,
  },
  {
    name: 'nested-subagent-ui-compact-depth',
    find: STOCK_COMPACT_ARGS_END,
    replace: 'invocationSummary:O,nestDepth:$ODdepth=1}){',
  },
  {
    name: 'nested-subagent-ui-compact-row',
    find: STOCK_COMPACT_TAIL,
    lookups: RENDER_CHUNK_LOOKUPS,
    replace: PATCHED_COMPACT_TAIL,
  },
  {
    name: 'nested-subagent-ui-compact-box-grows',
    find: STOCK_TASK_BOX,
    replace: STOCK_TASK_BOX.replace('height:2,', `minHeight:2,maxHeight:${TASK_BOX_MAX_ROWS},`),
  },
  {
    name: 'nested-subagent-ui-detail-step',
    find: STOCK_DETAIL_HEAD,
    replace: PATCHED_DETAIL_HEAD,
  },
  {
    name: 'nested-subagent-ui-detail-step-returns',
    find: STOCK_DETAIL_TAIL,
    replace: PATCHED_DETAIL_TAIL,
  },
  {
    name: 'nested-subagent-ui-detail-knows-tool-use',
    find: STOCK_DETAIL_TOOL,
    replace: STOCK_DETAIL_TOOL.replace(
      '{toolName:f.toolName,',
      '{toolUseId:f.toolName==="Task"?f.id:void 0,toolName:f.toolName,',
    ),
  },
  {
    name: 'nested-subagent-ui-detail-live-steps',
    find: STOCK_DETAIL_OUTPUT,
    lookups: [STOCK_DETAIL_ARGS],
    replace: PATCHED_DETAIL_OUTPUT,
  },
];
