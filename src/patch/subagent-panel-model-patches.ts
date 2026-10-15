import type { Patch } from './patches.ts';

const MODEL_LABEL_OF =
  '($ODmodel,$ODeffort)=>{if(!$ODmodel)return;let $ODname=ue($ODmodel).shortDisplayName;' +
  `return $ODeffort?\`\${$ODname} (\${ti($ODeffort)})\`:$ODname}`;

export const ITEM_MODEL_LABEL =
  `(($ODstore)=>(${MODEL_LABEL_OF})($ODstore?$ODstore.getModelId():ee.model,$ODstore?$ODstore.getReasoningEffort():ee.reasoningEffort))` +
  '(ee.sessionId?K.getSessionManager(ee.sessionId)?.getStore():void 0)';

const STOCK_ITEM_TAIL =
  'startTime:ee.startTime,progressUpdates:gq({sessionStateManager:K,taskId:ee.taskId})})}';

const PATCHED_ITEM_TAIL =
  'startTime:ee.startTime,progressUpdates:gq({sessionStateManager:K,taskId:ee.taskId}),' +
  `modelLabel:${ITEM_MODEL_LABEL}})}`;

const STOCK_MAIN_MODEL_LABEL =
  'function Vye(f){let{mainModel:w,mainReasoningEffort:v}=f;if(!w||!v)return;' +
  `let k=ue(w).shortDisplayName,A=ti(v);return\`\${k} (\${A})\`}`;

const STOCK_ROW_DETAIL = `Ce=fe.detail?\`: \${fe.detail}\`:""`;

const PATCHED_ROW_DETAIL = `Ce=(fe.modelLabel?\` \\u00B7 \${fe.modelLabel}\`:"")+(fe.detail?\`: \${fe.detail}\`:"")`;

const STOCK_DETAIL_HEADER = 'l(o,{color:a.primary,bold:!0,children:[bL(f),xL(f.label)]}),f.pid&&';

const PATCHED_DETAIL_HEADER =
  'l(o,{color:a.primary,bold:!0,children:[bL(f),xL(f.label)]}),' +
  'f.modelLabel&&l(o,{color:a.text.muted,children:[" \\u00B7 ",f.modelLabel]}),f.pid&&';

export const subagentPanelModelPatches: readonly Patch[] = [
  {
    name: 'subagent-panel-model-item-label',
    find: STOCK_ITEM_TAIL,
    lookups: [STOCK_MAIN_MODEL_LABEL],
    replace: PATCHED_ITEM_TAIL,
  },
  {
    name: 'subagent-panel-model-row',
    find: STOCK_ROW_DETAIL,
    replace: PATCHED_ROW_DETAIL,
  },
  {
    name: 'subagent-panel-model-detail-header',
    find: STOCK_DETAIL_HEADER,
    replace: PATCHED_DETAIL_HEADER,
  },
];
