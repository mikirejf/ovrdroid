import type { Patch } from './patches.ts';

const SURFACE_GATE =
  '{toolName:e,surface:o,policy:t}){if(o==="direct")return t.mode!=="script_only"||';

const SCRIPT_MODEL_GATE = 'if(!(r?.some((u)=>u===t.modelId||u===i)??!1))return"direct_only";';

const SCRIPT_ONLY_SECTION =
  '"# Script-only tool execution\\n- Guidance elsewhere that tells you to call a Script-bound tool directly, or to issue independent calls together in one message, applies to its `tools.<Name>(input)` binding: put the calls in one Script and start independent ones together."';

const SCRIPT_ONLY_SECTION_STEERED = [
  '"# Script-only tool execution',
  '- Your top-level tools are exactly the ones in your tool list. Read, Grep, Glob, LS, Execute, Edit, Create and every other tool exist only as `tools.<Name>(input)` inside a Script; never call them top level.',
  '- Guidance elsewhere that tells you to call a tool directly, or to issue independent calls together in one message, applies to its binding: put the calls in one Script and start independent ones together.',
  '- When each step needs the result of the one before, such as following a chain of files, loop inside one Script instead of spending a turn per call."',
].join('\\n');

const TODO_BATCH_RULE = [
  `TodoWrite MUST go out in the SAME message as at least one action tool \${RF} whenever a next action exists. Never spend a turn on TodoWrite alone.`,
  '- Starting work: emit the list AND your first exploration or action tool together, in one message.',
].join('\n');

const TODO_BATCH_RULE_NEUTRAL = [
  'TodoWrite MUST go out in the SAME message as at least one other tool call that does the next action (in script mode, a Script) whenever a next action exists. Never spend a turn on TodoWrite alone.',
  '- Starting work: emit the list AND your first exploration or action call together, in one message.',
].join('\n');

export const toolSurfacePatches: readonly Patch[] = [
  {
    name: 'script-mode-every-model',
    find: SCRIPT_MODEL_GATE,
    replace: '',
  },
  {
    name: 'todo-write-direct',
    find: SURFACE_GATE,
    replace: `${SURFACE_GATE}e==="TodoWrite"||`,
  },
  {
    name: 'script-only-section-steers-to-scripts',
    find: SCRIPT_ONLY_SECTION,
    replace: SCRIPT_ONLY_SECTION_STEERED,
  },
  {
    name: 'todo-write-batch-rule-tool-neutral',
    find: TODO_BATCH_RULE,
    replace: TODO_BATCH_RULE_NEUTRAL,
  },
];
