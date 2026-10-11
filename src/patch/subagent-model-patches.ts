import type { Patch } from './patches.ts';

const TIERS = ['light', 'medium', 'heavy'] as const;
export const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'inherit'] as const;

const TIER_LIST = JSON.stringify(TIERS);
const EFFORT_LIST = JSON.stringify(EFFORTS);

export const SPLIT_MODEL =
  'function $ODsplit($ODin,$ODvalid,$ODids){' +
  `let $ODtiers=${TIER_LIST},$ODsteps=${EFFORT_LIST},` +
  '$ODout={complexity:$ODin.complexity,effort:$ODin.effort},$ODraw=$ODin.model;' +
  'if($ODout.complexity!==void 0&&!$ODtiers.includes($ODout.complexity))' +
  'throw Error("complexity \\""+$ODout.complexity+"\\" is not a tier. Allowed: "+$ODtiers.join(", "));' +
  'if($ODout.effort!==void 0&&!$ODsteps.includes($ODout.effort))' +
  'throw Error("effort \\""+$ODout.effort+"\\" is not a step. Allowed: "+$ODsteps.join(", "));' +
  'if($ODraw===void 0)return $ODout;' +
  'let $ODid=String($ODraw).trim(),$ODopen=$ODid.lastIndexOf("[");' +
  'if($ODid.endsWith("]")&&$ODopen>=0&&!$ODvalid($ODid)){' +
  'let $ODseen=new Set;' +
  'for(let $ODpair of $ODid.slice($ODopen+1,-1).split(",")){' +
  'let $ODeq=$ODpair.indexOf("="),$ODkey=($ODeq<0?$ODpair:$ODpair.slice(0,$ODeq)).trim(),$ODval=$ODeq<0?"":$ODpair.slice($ODeq+1).trim();' +
  'if($ODkey!=="effort")' +
  'throw Error("model brackets: unknown key \\""+$ODkey+"\\". Allowed keys: effort");' +
  'if(!$ODsteps.includes($ODval))' +
  'throw Error("model brackets: effort \\""+$ODval+"\\" is not allowed. Allowed: "+$ODsteps.join(", "));' +
  'if($ODseen.has($ODkey))throw Error("model brackets set "+$ODkey+" twice");' +
  'if($ODout[$ODkey]!==void 0)' +
  'throw Error($ODkey+" is set twice: in the model brackets and in the "+$ODkey+" field. Set it in one place");' +
  '$ODseen.add($ODkey);$ODout[$ODkey]=$ODval}' +
  '$ODid=$ODid.slice(0,$ODopen).trim()}' +
  'if($ODid==="inherit")$ODout.inherit=!0;' +
  'else if($ODid!==""&&$ODvalid($ODid))$ODout.model=$ODid;' +
  'else throw Error("Unknown model \\""+$ODid+"\\". Valid model ids: inherit, "+$ODids().join(", "));' +
  'return $ODout}';

export const MATCH_NAME =
  'function $ODname($ODwant,$ODnames){' +
  'if($ODnames.includes($ODwant))return $ODwant;' +
  'let $ODkey=($ODs)=>$ODs.trim().toLowerCase().split(" ").join("-"),' +
  '$ODhits=[...new Set($ODnames.filter(($ODn)=>$ODkey($ODn)===$ODkey($ODwant)))];' +
  'return $ODhits.length===1?$ODhits[0]:$ODwant}';

export const PICK_MODEL =
  'function $ODpick($ODl,$ODs){' +
  'let $ODtier=$ODl.complexity,$ODgiven=$ODl.model!==void 0||$ODl.inherit===!0,$ODlaunch=$ODgiven||$ODl.effort!==void 0;' +
  'if(!$ODs.custom){' +
  'if(!$ODlaunch)return $ODs.stock($ODtier);' +
  'let $ODbase=$ODs.stock($ODtier),$ODp=$ODs.parent(),' +
  '$ODm=$ODl.model??($ODl.inherit?$ODp.modelId:void 0)??$ODbase.modelId,' +
  '$ODe=$ODl.effort==="inherit"?$ODp.reasoningEffort:$ODl.effort??($ODm===$ODbase.modelId?$ODbase.reasoningEffort:$ODm?$ODs.lower($ODm,$ODbase.complexity,$ODp.reasoningEffort):void 0);' +
  'return{modelId:$ODm,reasoningEffort:$ODe!==void 0&&$ODm?$ODs.clamp($ODm,$ODe):$ODe,complexity:$ODbase.complexity,$ODtoolModel:$ODl.model}}' +
  'if($ODtier!==void 0)throw Error($ODs.name+" is a custom agent, so it cannot take a tier. Launch it without complexity");' +
  'let $ODfixed=$ODs.fixedModel,$ODdeclared=$ODs.declaredModel;' +
  'if($ODdeclared&&$ODgiven)' +
  'throw Error($ODs.name+" fixes its model ("+$ODdeclared+"), so it cannot take a launch model. Launch it without model");' +
  'if($ODdeclared&&$ODl.effort!==void 0)' +
  'throw Error($ODs.name+" fixes its model ("+$ODdeclared+"), so it cannot take a launch effort. Launch it without effort");' +
  'if(!$ODlaunch&&$ODs.effort!=="inherit"&&($ODfixed||$ODdeclared||$ODs.effort===void 0))return $ODs.stock(void 0);' +
  'let $ODp=$ODs.parent(),' +
  '$ODfromParent=$ODl.model===void 0&&($ODl.inherit===!0||!$ODfixed),' +
  '$ODm=$ODl.model??($ODfromParent?$ODp.modelId:$ODfixed),' +
  '$ODx=$ODl.effort??$ODs.effort,' +
  '$ODe=$ODx==="inherit"?$ODp.reasoningEffort:$ODx??($ODfromParent?$ODp.reasoningEffort:void 0);' +
  'return{modelId:$ODm,reasoningEffort:$ODe!==void 0&&$ODm?$ODs.clamp($ODm,$ODe):$ODe,complexity:void 0,$ODtoolModel:$ODl.model}}';

export const REFUSE_RESUME_FIELDS =
  'function $ODresume($ODt){' +
  'if(!$ODt.resume)return;' +
  'if($ODt.readonly===!0)' +
  'throw Error("readonly applies only to a new launch, so it cannot be combined with resume. The resumed subagent keeps the tools it started with. Resume without readonly");' +
  'for(let $ODk of["model","effort","complexity"])if($ODt[$ODk]!==void 0)' +
  'throw Error($ODk+" applies only to a new launch, so it cannot be combined with resume. The resumed subagent keeps the model and effort it started with. Resume without "+$ODk)}';

export const CHECK_DROID =
  'function $ODdroidErrors($ODmeta){' +
  'let $ODerr=[];' +
  'if($ODmeta.maxDepth!==void 0&&!(Number.isInteger($ODmeta.maxDepth)&&$ODmeta.maxDepth>0))' +
  '$ODerr.push("maxDepth must be a positive integer, not "+JSON.stringify($ODmeta.maxDepth));' +
  'if($ODmeta.skills!==void 0&&!(Array.isArray($ODmeta.skills)&&$ODmeta.skills.every(($ODn)=>typeof $ODn==="string")))' +
  '$ODerr.push("skills must be a list of skill names, not "+JSON.stringify($ODmeta.skills));' +
  'return $ODerr}';

const MODEL_IDS =
  'function $ODids(){let $ODc=C().getCustomModels();' +
  'return[...new Set([...Cs(),...(Array.isArray($ODc)?$ODc.map(($ODm)=>$ODm.id):[])])]}';

export const TASK_HELPERS =
  SPLIT_MODEL + MATCH_NAME + PICK_MODEL + REFUSE_RESUME_FIELDS + MODEL_IDS;

export const TASK_CONFIG_LOOKUP = 'static async buildStreamJsonRpcTaskConfig(t,o,a){';

const LOAD_DROIDS_LOOKUP = 'y=await Do().loadAllDroids(),S=o?.sessionExecutionContext';

const LAUNCH_MODEL_LOOKUP =
  'let R=v.type==="custom"?v.droid:Ele(v.config),b=[...Cs()],A=(Q)=>vi.validateModel(Q,b).valid,D=C().resolveModelWithFallback(R.metadata.model,A),F=';

const MODEL_DESCRIPTION =
  'Optional model for the subagent: a model id from the list at the end of this tool\'s description, or "inherit" for this session\'s model. ' +
  'Brackets set the effort in the same string: "<id>[effort=xhigh]", "<id>[effort=inherit]" (this session\'s effort), "inherit[effort=high]". Brackets take only effort. ' +
  'Only agents whose file says model inherit, and the built-ins worker and explorer, take a model; an agent whose file names a model refuses one. Omit it to run the agent on its own model.';

const EFFORT_DESCRIPTION =
  `Optional exact reasoning effort for the subagent, one of ${EFFORTS.join(', ')}. ` +
  `"inherit" means this session's effort. ` +
  "On an agent whose file says model inherit it wins over the reasoningEffort in that file. Droid then moves it to the highest step at or below it that the final model supports, or to the model's lowest step. " +
  'Only agents that take a model take an effort; an agent whose file names a model refuses one.';

const COMPLEXITY_DESCRIPTION =
  `Optional complexity tier, one of ${TIERS.join(', ')}. ` +
  'Only the built-ins worker and explorer take a tier; every custom agent refuses one. ' +
  "When a built-in inherits this session's model, light does not reason at all where the model allows it, heavy reasons most, and the tier never raises effort above this session; it also selects the tier model when tier models are configured in settings.";

const STOCK_COMPLEXITY_FIELD =
  'complexity:y(tte).optional().describe("Optional complexity tier. When the subagent inherits this session\'s model, caps how hard it reasons (light does not reason at all where the model allows it, heavy reasons most) and never raises it above this session. Also selects the tier model when complexity\\u2192model routing is configured in settings. Ignored for custom subagents, which run on their configured model and reasoning effort, or on this session\'s when they inherit."),';

const STOCK_LOOKUP =
  'E=y.find((Q)=>Q.metadata.name===l&&Q.validationResult.valid&&ub(Q.metadata.name,S))';

export const STOCK_RESOLVE =
  '{modelId:O,reasoningEffort:W,complexity:j}=Ie.resolveSubagentModelSelection({subagent:v,requestedComplexity:t.complexity,droidModel:F,dependencies:o})';

export const PICK_LOOKUPS: readonly string[] = [
  LAUNCH_MODEL_LOOKUP,
  'reasoningEffort:g.modelId?lw({modelId:g.modelId,',
];

export const PICK_CALL =
  '{modelId:O,reasoningEffort:W,complexity:j,$ODtoolModel}=$ODpick($ODl,{' +
  'name:R.metadata.name,custom:v.type==="custom",fixedModel:F&&F!=="inherit"?F:void 0,' +
  'declaredModel:typeof R.metadata.model==="string"&&R.metadata.model.trim()!==""&&R.metadata.model!=="inherit"?R.metadata.model:void 0,' +
  'effort:R.metadata.reasoningEffort,' +
  'stock:($ODc)=>Ie.resolveSubagentModelSelection({subagent:v,requestedComplexity:$ODc,droidModel:F,dependencies:o}),' +
  'parent:()=>Ie.resolveSubagentModelSelection({subagent:{type:"custom",droid:R},droidModel:"inherit",dependencies:o}),' +
  'lower:($ODm,$ODc,$ODe)=>lw({modelId:$ODm,complexity:$ODc,inherited:$ODe}),' +
  'clamp:($ODm,$ODe)=>lw({modelId:$ODm,inherited:$ODe,$ODclamp:!0})})';

const STOCK_LW_HEAD =
  'function lw({modelId:t,complexity:o,inherited:a}){if(!o||a===void 0)return a;';

const STOCK_DROID_CLASS_HEAD =
  'class ET{settingsManager;constructor(e=Me.getInstance()){this.settingsManager=e}';

const STOCK_GET_ALL_DROIDS =
  'async getAllDroids(){return(await this.settingsManager.getResolvedSettings()).droids?.customDroids??[]}';

const STOCK_EFFORT_WARNING =
  'let R=this.validateModel(e.model,r);if(t.push(...R.errors),e.reasoningEffort!==void 0){if(o==="inherit")a.push("Reasoning effort is ignored when inheriting the parent model");';

export const subagentModelPatches: readonly Patch[] = [
  {
    name: 'task-schema-model-effort-fields',
    find: STOCK_COMPLEXITY_FIELD,
    lookups: ['subagent_type:e().describe("An available agent type'],
    replace:
      `complexity:y(tte).optional().describe(${JSON.stringify(COMPLEXITY_DESCRIPTION)}),` +
      `model:e().optional().describe(${JSON.stringify(MODEL_DESCRIPTION)}),` +
      `effort:y(${EFFORT_LIST}).optional().describe(${JSON.stringify(EFFORT_DESCRIPTION)}),`,
  },
  {
    name: 'task-description-lists-model-ids',
    find: 'let a=bZ({description:t,enableRemoteExecution:o});',
    replace:
      'let a=bZ({description:t+"\\n\\nModel ids the `model` field takes in this session: inherit, "+$ODids().join(", ")+".",enableRemoteExecution:o});',
  },
  {
    name: 'task-model-helpers',
    find: 'class ki extends Dp{toolRegistry=Ye();',
    lookups: [LAUNCH_MODEL_LOOKUP],
    replace: `${TASK_HELPERS}class ki extends Dp{toolRegistry=Ye();`,
  },
  {
    name: 'task-launch-splits-model-and-matches-name',
    find: `${TASK_CONFIG_LOOKUP}if(t.resume){`,
    lookups: [LAUNCH_MODEL_LOOKUP, LOAD_DROIDS_LOOKUP, 'oO().map((p)=>p.name)'],
    replace:
      `${TASK_CONFIG_LOOKUP}$ODresume(t);let $ODdroids=await Do().loadAllDroids();` +
      'if(typeof t.subagent_type==="string")t.subagent_type=$ODname(t.subagent_type,' +
      '[...$ODdroids.map(($ODd)=>$ODd.metadata.name),...oO().map(($ODb)=>$ODb.name)]);' +
      'let $ODl=$ODsplit(t,($ODm)=>vi.validateModel($ODm,[...Cs()]).valid,$ODids);' +
      'if(t.resume){',
  },
  {
    name: 'task-resume-reuses-the-loaded-droids',
    find: 'Q=await Do().loadAllDroids(),ge=hn(t.resume)',
    replace: 'Q=$ODdroids,ge=hn(t.resume)',
  },
  {
    name: 'task-launch-reuses-the-loaded-droids',
    find: LOAD_DROIDS_LOOKUP,
    replace: 'y=$ODdroids,S=o?.sessionExecutionContext',
  },
  {
    name: 'task-launch-refuses-invalid-droid',
    find: STOCK_LOOKUP,
    replace:
      `${STOCK_LOOKUP}??(($ODbad)=>{if($ODbad)throw Error($ODbad.metadata.name+" is invalid, so it cannot launch: "+$ODbad.validationResult.errors.join("; "));})` +
      '(y.find((Q)=>Q.metadata.name===l&&ub(Q.metadata.name,S)))',
  },
  {
    name: 'effort-clamps-to-model',
    find: STOCK_LW_HEAD,
    lookups: ['let l=U6(t,F6[o])??jL(t)[0];'],
    replace:
      'function lw({modelId:t,complexity:o,inherited:a,$ODclamp:$ODc}){if($ODc)return U6(t,a)??jL(t)[0]??a;if(!o||a===void 0)return a;',
  },
  {
    name: 'droid-validation-accepts-inherit-effort',
    find: 'static validateReasoningEffort(e,r){if(e==="inherit")return!0;',
    replace: 'static validateReasoningEffort(e,r){if(e==="inherit"||r==="inherit")return!0;',
  },
  {
    name: 'droid-validation-checks-new-fields',
    find: STOCK_EFFORT_WARNING,
    replace:
      'let R=this.validateModel(e.model,r);' +
      'if(t.push(...R.errors,...$ODdroidErrors(e)),e.reasoningEffort!==void 0){' +
      'if(o==="inherit"){}',
  },
  {
    name: 'droid-load-checks-new-fields',
    find: STOCK_DROID_CLASS_HEAD + STOCK_GET_ALL_DROIDS,
    replace:
      `${CHECK_DROID}${STOCK_DROID_CLASS_HEAD}async getAllDroids(){` +
      'let $ODlist=(await this.settingsManager.getResolvedSettings()).droids?.customDroids??[];' +
      'return $ODlist.map(($ODd)=>{let $ODerr=$ODdroidErrors($ODd.metadata);' +
      'return $ODerr.length===0?$ODd:{...$ODd,validationResult:{...$ODd.validationResult,valid:!1,errors:[...$ODd.validationResult.errors,...$ODerr]}}})}',
  },
];
