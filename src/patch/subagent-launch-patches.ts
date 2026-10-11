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

const FINAL_MODEL = '$ODtoolModel??(F||"inherit")';

const READONLY_TOOLS =
  `$ODfull=vi.expandTools({tools:R.metadata.tools,model:${FINAL_MODEL}}),` +
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
