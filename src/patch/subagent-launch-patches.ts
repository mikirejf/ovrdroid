import type { Patch } from './patches.ts';
import {
  PICK_CALL,
  PICK_LOOKUPS,
  STOCK_RESOLVE,
  TASK_CONFIG_LOOKUP,
} from './subagent-model-patches.ts';

const READONLY_FIELD_DESCRIPTION =
  'Optional. Set true to make this subagent unable to change anything. It loses its Edit, Create, and Apply Patch tools, ' +
  'and its shell runs only read-only commands. A subagent whose droid already limits its tools keeps only the read-only tools it had. ' +
  'These are the same limits the explorer agent has. Leave it out or set false for the normal tools.';

const TASK_RESUME_FIELD =
  'resume:e().optional().describe("Task ID (session ID) from a previous invocation to resume with full context preserved")';

const SKILL_LOOKUP = 'let l=await vT(),c=Lt(a),p=l.find((v)=>Lt(v.metadata.name)===c)';

const SKILL_ESCAPE_LOOKUP = 'E=ap(p.metadata.name),T=ap(p.filePath);yield{type:"result"';

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

const STOCK_EXPAND_TOOLS = '_=vi.expandTools({tools:R.metadata.tools,model:F||"inherit"}),';

export const STOCK_MCP_ENTRY_PARSER =
  'function lr(e){let[t,...o]=e.trim().slice(4).split("/"),r=o[0];if(!t||o.length>1||r==="")return;' +
  'let a=decodeURIComponent(t);if(!a.trim())return;if(r===void 0)return{serverName:a};' +
  'let l=decodeURIComponent(r);return l?{serverName:a,toolName:l}:void 0}';

export const MCP_ENTRY_PARSER =
  '($ODentry)=>{let[$ODhead,...$ODtail]=$ODentry.trim().slice(4).split("/"),$ODtoolPart=$ODtail[0];' +
  'if(!$ODhead||$ODtail.length>1||$ODtoolPart==="")return;' +
  'let $ODserver=decodeURIComponent($ODhead);if(!$ODserver.trim())return;' +
  'if($ODtoolPart===void 0)return{serverName:$ODserver};' +
  'let $ODtoolName=decodeURIComponent($ODtoolPart);return $ODtoolName?{serverName:$ODserver,toolName:$ODtoolName}:void 0}';

const STOCK_READ_ONLY_CHECK =
  'static usesReadOnlyPolicy(e){return e==="read-only"}static isValidName(e)';

export const DROID_TOOLS_METHOD =
  'static $ODdroidTools($ODdroid,$ODmodel){' +
  'let $ODtools=$ODdroid.metadata.tools,' +
  '$ODlist=Array.isArray($ODtools)?$ODtools:typeof $ODtools==="string"&&$ODtools.includes(",")?$ODtools.split(","):void 0;' +
  'if(!$ODlist)return this.expandTools({tools:$ODtools,model:$ODmodel});' +
  `let $ODparse=${MCP_ENTRY_PARSER},` +
  '$ODall=Ye().getAllTools(),$ODid=($ODt)=>$ODt.llmId||$ODt.id,$ODknown=new Set($ODall.map($ODid)),' +
  '$ODlive=($ODname)=>J4($ODall,[{serverName:$ODname}]).length>0,' +
  '$ODplain=[],$ODextra=[],$ODunknown=[],$ODmalformed=[],$ODabsent=[];' +
  'for(let $ODraw of $ODlist){' +
  'let $ODname=String($ODraw).trim();if(!$ODname)continue;' +
  'if($ODname.toLowerCase().startsWith("mcp:")){' +
  'let $ODref;try{$ODref=$ODparse($ODname)}catch{}' +
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
  'let $ODservers=$ODdroid.metadata.mcpServers,' +
  '$ODmcp=$ODservers===void 0?$ODall.filter(($ODt)=>$ODt.isMcpTool).map($ODid):rn($ODservers),' +
  '$ODids=new Set([...this.normalizeTools($ODplain,$ODmodel).resolved,...$ODmcp,...$ODextra]);' +
  'if($ODall.some(($ODt)=>$ODt.deferred&&$ODids.has($ODid($ODt))))$ODids.add(Tr.llmId);' +
  'return[...$ODids]}';

const FINAL_MODEL = '$ODtoolModel??(F||"inherit")';

const READONLY_TOOLS =
  `$ODfull=vi.$ODdroidTools(R,${FINAL_MODEL}),` +
  `$ODread=t.readonly===!0?vi.expandTools({tools:"read-only",model:${FINAL_MODEL}}):void 0,` +
  '_=!$ODread?$ODfull:R.metadata.tools===void 0?$ODread:$ODfull.filter(($ODid)=>$ODread.includes($ODid))';

const SKILL_NAME_FIELD = 'g={name:c.name,description:c.description,license:c.license,';

export const subagentLaunchPatches: readonly Patch[] = [
  {
    name: 'skill-name-is-its-slug',
    find: SKILL_NAME_FIELD,
    lookups: ['!Lt(t.name))a.push("Skill name must contain at least one letter or number")'],
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
    lookups: ['await:p().default(!1).describe(Vt)'],
    replace: `${TASK_RESUME_FIELD},readonly:p().optional().describe(${JSON.stringify(READONLY_FIELD_DESCRIPTION)})`,
  },
  {
    name: 'droid-tools-add-mcp-servers-and-reject-unknown-names',
    find: STOCK_READ_ONLY_CHECK,
    lookups: [
      'function rn(e){let r=Ye();return J4(r.getAllTools(),e.map((t)=>({serverName:t}))).map((t)=>t.llmId||t.id)}',
      'r.add(Ul.id),r.add(ea.id),r.add(Wo.id),r.add(Tr.id),r.add(Cu.id),r.delete(no.id)',
    ],
    replace: `${DROID_TOOLS_METHOD}${STOCK_READ_ONLY_CHECK}`,
  },
  {
    name: 'task-launch-picks-model-then-expands-tools',
    find: `${STOCK_EXPAND_TOOLS}${STOCK_RESOLVE}`,
    lookups: PICK_LOOKUPS,
    replace: `${PICK_CALL},${READONLY_TOOLS}`,
  },
  {
    name: 'task-readonly-applies-read-only-policy',
    find: 'V=vi.usesReadOnlyPolicy(R.metadata.tools)',
    lookups: [TASK_CONFIG_LOOKUP],
    replace: 'V=vi.usesReadOnlyPolicy(R.metadata.tools)||t.readonly===!0',
  },
  {
    name: 'task-readonly-restricts-enabled-tools',
    find: 'ye=R.metadata.tools!==void 0&&_.length>0',
    lookups: [TASK_CONFIG_LOOKUP],
    replace: 'ye=(R.metadata.tools!==void 0||t.readonly===!0)&&_.length>0',
  },
];
