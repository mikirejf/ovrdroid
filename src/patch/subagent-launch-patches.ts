import type { Patch } from './patches.ts';
import {
  PICK_CALL,
  PICK_LOOKUPS,
  STOCK_RESOLVE,
  TASK_CONFIG_LOOKUP,
} from './subagent-model-patches.ts';

const READONLY_FIELD_DESCRIPTION =
  'Optional. Set true for work that leaves the repository unchanged. The subagent loses its Edit, Create, and Apply Patch tools. ' +
  'Its shell still runs commands up to medium risk (tests, builds, scratch programs) and refuses high-risk ones, ' +
  'so tell it in the prompt to write only in a temp folder. A subagent whose droid already limits its tools keeps only the read-only tools it had. ' +
  'Leave it out or set false for the normal tools.';

const TASK_RESUME_FIELD =
  'resume:e().optional().describe("Task ID (session ID) from a previous invocation to resume with full context preserved")';

const SKILL_LOOKUP = 'let l=await vT(),c=Lt(a),';

const SKILL_ESCAPE_LOOKUP = 'E=ap(p.metadata.name),T=ap(p.filePath);';

const SKILL_BLOCK_BODY =
  'let $ODwanted=$ODdroid.metadata.skills;' +
  'if(!$ODwanted?.length)return $ODdroid.systemPrompt;' +
  'let $ODall=await vT(),' +
  '$ODseen=new Set,' +
  '$ODblocks=$ODwanted.filter(($ODn)=>{let $ODk=Lt($ODn);return!$ODseen.has($ODk)&&$ODseen.add($ODk)}).map(($ODname)=>{' +
  'let $ODkey=Lt($ODname),$ODskill=$ODall.find(($ODs)=>Lt($ODs.metadata.name)===$ODkey),' +
  "$ODhead='Droid \"'+$ODdroid.metadata.name+'\" lists the skill \"'+$ODname+'\" in its skills field, but ';" +
  'if(!$ODskill)throw Error($ODhead+"no skill with that name exists.");' +
  'if(!$ODskill.validationResult.valid)throw Error($ODhead+"that skill is invalid: "+$ODskill.validationResult.errors.join(", ")+".");' +
  'if($ODskill.metadata.enabled===!1)throw Error($ODhead+"that skill is disabled.");' +
  'return\'<skill name="\'+ap($ODkey)+\'" filePath="\'+ap($ODskill.filePath)+\'">\\n\'+$ODskill.systemPrompt+"\\n</skill>"});' +
  'return $ODdroid.systemPrompt+"\\n\\n"+$ODblocks.join("\\n\\n")';

const SKILL_PROMPT_ARGUMENT = `await(async($ODdroid)=>{${SKILL_BLOCK_BODY}})(R)`;

const STOCK_EXPAND_TOOLS =
  'xx=()=>vi.expandTools({tools:R.metadata.tools,model:F||"inherit"}),xy=xx();' +
  'if(xy.errors.length>0){let xz=xc()?.whenStartupSettles();' +
  'if(xz)await xa(xz,o?.abortSignal).catch(()=>{throw new xe}),xy=xx();' +
  'if(xy.errors.length>0){let xf=xy.errors.join(" ");' +
  `return{llmError:\`Droid \${l} cannot run because its saved tools selection does not resolve: \${xf}\`,userError:\`Droid "\${l}" cannot run: \${xf}\`}}}` +
  'let _=xy.resolved,';

const TOOL_SELECTION =
  `$ODexpand=()=>vi.$ODdroidTools(R,$ODtoolModel??(F||"inherit")),$ODselection=$ODexpand();` +
  'if($ODselection.errors.length>0){let $ODstartup=xc()?.whenStartupSettles();' +
  'if($ODstartup)await xa($ODstartup,o?.abortSignal).catch(()=>{throw new xe}),$ODselection=$ODexpand();' +
  'if($ODselection.errors.length>0){let $ODerrors=$ODselection.errors.join(" ");' +
  `return{llmError:\`Droid \${l} cannot run because its saved tools selection does not resolve: \${$ODerrors}\`,userError:\`Droid "\${l}" cannot run: \${$ODerrors}\`}}}`;

export const STOCK_MCP_ENTRY_PARSER =
  'function lr(e){let[t,...o]=e.trim().slice(pc.length).split("/"),r=o[0];if(!t||o.length>1||r==="")return;' +
  'try{let a=decodeURIComponent(t);if(!a.trim())return;if(r===void 0)return{serverName:a};' +
  'let l=decodeURIComponent(r);return l?{serverName:a,toolName:l}:void 0}catch{return}}';

export const MCP_ENTRY_PARSER =
  '($ODentry)=>{let[$ODhead,...$ODtail]=$ODentry.trim().slice(4).split("/"),$ODtoolPart=$ODtail[0];' +
  'if(!$ODhead||$ODtail.length>1||$ODtoolPart==="")return;' +
  'try{let $ODserver=decodeURIComponent($ODhead);if(!$ODserver.trim())return;' +
  'if($ODtoolPart===void 0)return{serverName:$ODserver};' +
  'let $ODtoolName=decodeURIComponent($ODtoolPart);return $ODtoolName?{serverName:$ODserver,toolName:$ODtoolName}:void 0}catch{return}}';

const STOCK_READ_ONLY_CHECK =
  'static usesReadOnlyPolicy(e){return e==="read-only"}static isValidName(e)';

export const DROID_TOOLS_METHOD =
  'static $ODdroidTools($ODdroid,$ODmodel){' +
  'let $ODtools=$ODdroid.metadata.tools,' +
  '$ODlist=Array.isArray($ODtools)?$ODtools:typeof $ODtools==="string"&&$ODtools.includes(",")?$ODtools.split(","):void 0;' +
  'if(!$ODlist)return this.expandTools({tools:$ODtools,model:$ODmodel});' +
  `let $ODparse=${MCP_ENTRY_PARSER},` +
  '$ODall=Ye().getAllTools(),$ODid=mt,$ODknown=new Set($ODall.flatMap(($ODt)=>[$ODid($ODt),$ODt.llmId||$ODt.id])),' +
  '$ODlive=($ODname)=>J4($ODall,[{serverName:$ODname}]).length>0,' +
  '$ODplain=[],$ODextra=[],$ODunknown=[],$ODmalformed=[],$ODabsent=[];' +
  'for(let $ODraw of $ODlist){' +
  'let $ODname=String($ODraw).trim();if(!$ODname)continue;' +
  'if($ODname.toLowerCase().startsWith("mcp:")){' +
  'let $ODref=$ODparse($ODname);' +
  'if(!$ODref){$ODmalformed.push($ODname);continue}' +
  'if(!$ODlive($ODref.serverName))continue;' +
  'let $ODhit=J4($ODall,[$ODref]);' +
  'if($ODhit.length===0){$ODabsent.push($ODname);continue}' +
  '$ODextra.push(...$ODhit.map($ODid));continue}' +
  'let $ODcut=$ODname.indexOf("___");' +
  'if($ODcut>0&&!$ODknown.has($ODname)){if($ODlive($ODname.slice(0,$ODcut)))$ODabsent.push($ODname);continue}' +
  'if(this.normalizeTools([$ODname],$ODmodel).errors.some(($ODe)=>$ODe.startsWith("Invalid tools:"))){$ODunknown.push($ODname);continue}' +
  '$ODplain.push($ODname)}' +
  'let $ODproblems=[];' +
  'if($ODunknown.length)$ODproblems.push("tools that do not exist: "+$ODunknown.join(", "));' +
  'if($ODmalformed.length)$ODproblems.push("MCP entries it cannot read (write MCP:<server> or MCP:<server>/<tool>): "+$ODmalformed.join(", "));' +
  'if($ODabsent.length)$ODproblems.push("MCP tools their running server does not have: "+$ODabsent.join(", "));' +
  'if($ODproblems.length)throw Error(\'Droid "\'+$ODdroid.metadata.name+\'" lists \'+$ODproblems.join("; ")+".");' +
  'let $ODnormalized=this.normalizeTools($ODplain,$ODmodel),$ODservers=$ODdroid.metadata.mcpServers,' +
  '$ODmcp=$ODservers===void 0?$ODall.filter(($ODt)=>$ODt.isMcpTool).map($ODid):rn($ODservers),' +
  '$ODids=new Set([...$ODnormalized.resolved,...$ODmcp,...$ODextra]);' +
  'if($ODall.some(($ODt)=>$ODt.deferred&&$ODids.has($ODid($ODt))))$ODids.add("ToolSearch");' +
  'return{...$ODnormalized,resolved:[...$ODids]}}';

const FINAL_MODEL = '$ODtoolModel??(F||"inherit")';

const READONLY_TOOLS =
  '$ODfull=$ODselection.resolved,' +
  `$ODread=t.readonly===!0?vi.expandTools({tools:"read-only",model:${FINAL_MODEL}}).resolved:void 0,` +
  '_=!$ODread?$ODfull:R.metadata.tools===void 0?$ODread:$ODfull.filter(($ODid)=>$ODread.includes($ODid))';

const SKILL_NAME_FIELD = 'g={name:c.name,description:c.description,license:c.license,';

const AUTONOMY_CAP_LOOKUP = 'return r?Rs(h,"low"):h}';

const STOCK_RESUMED_AUTONOMY = 'me=ye?Rs(S.parentAutonomyLevel,"low"):S.parentAutonomyLevel';

export const subagentLaunchPatches: readonly Patch[] = [
  {
    name: 'skill-name-is-its-slug',
    find: SKILL_NAME_FIELD,
    lookups: ['let r=Lt(s.metadata.name);if(r&&f.has(r))continue;'],
    replace:
      'g={name:typeof c.name==="string"?Lt(c.name):c.name,description:c.description,license:c.license,',
  },
  {
    name: 'droid-skills-load-into-system-prompt',
    find: 'systemPrompt:wp(R.systemPrompt,',
    lookups: [SKILL_LOOKUP, SKILL_ESCAPE_LOOKUP],
    replace: `systemPrompt:wp(${SKILL_PROMPT_ARGUMENT},`,
  },
  {
    name: 'task-schema-readonly-field',
    find: TASK_RESUME_FIELD,
    lookups: ['block:p().default(!0).describe('],
    replace: `${TASK_RESUME_FIELD},readonly:p().optional().describe(${JSON.stringify(READONLY_FIELD_DESCRIPTION)})`,
  },
  {
    name: 'droid-tools-add-mcp-servers-and-reject-unknown-names',
    find: STOCK_READ_ONLY_CHECK,
    lookups: [
      'function rn(e){return J4(nn(),e.map((t)=>({serverName:t}))).map(mt)}',
      'function nn(){return Ye().getAllTools().filter((t)=>t.mcpIdentity)}',
    ],
    replace: `${DROID_TOOLS_METHOD}${STOCK_READ_ONLY_CHECK}`,
  },
  {
    name: 'task-launch-picks-model-then-expands-tools',
    find: `${STOCK_EXPAND_TOOLS}${STOCK_RESOLVE}`,
    lookups: PICK_LOOKUPS,
    replace: `${PICK_CALL},${TOOL_SELECTION}let ${READONLY_TOOLS}`,
  },
  {
    name: 'task-readonly-applies-read-only-policy',
    find: 'V=vi.usesReadOnlyPolicy(R.metadata.tools),q=Ie.resolveSubagentAutonomyLevel(o,V)',
    lookups: [TASK_CONFIG_LOOKUP, AUTONOMY_CAP_LOOKUP],
    replace:
      '$ODown=vi.usesReadOnlyPolicy(R.metadata.tools),V=$ODown||t.readonly===!0,' +
      '$ODlevel=Ie.resolveSubagentAutonomyLevel(o,$ODown),q=V?Rs($ODlevel,"medium"):$ODlevel',
  },
  {
    name: 'task-readonly-child-keeps-medium-autonomy',
    find: STOCK_RESUMED_AUTONOMY,
    replace: STOCK_RESUMED_AUTONOMY.replace('"low"', '"medium"'),
  },
  {
    name: 'task-readonly-restricts-enabled-tools',
    find: 'ye=R.metadata.tools!==void 0&&_.length>0',
    lookups: [TASK_CONFIG_LOOKUP],
    replace: 'ye=(R.metadata.tools!==void 0||t.readonly===!0)&&_.length>0',
  },
];
