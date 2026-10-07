import type { Patch } from './patches.ts';

const ASK_USER_DEFINITION_TAIL =
  'describe("A plain-text list of questions and the selected answers.")},streamingSchemas:{result:{content:e()}},' +
  'isVisibleToUser:!0,isTopLevelTool:!0,requiresConfirmation:!0,sideEffects:[],toolkit:"Base",';

export const askUserTextPatches: readonly Patch[] = [
  {
    name: 'exit-spec-description-asks-in-text',
    find: 'then call AskUser with a short questionnaire so the user picks one, and pass only the chosen approach to ExitSpecMode.',
    replace:
      'then request in plain text that the user picks one, and finish your turn; after their answer, pass only the chosen approach to ExitSpecMode.',
  },
  {
    name: 'exit-spec-plan-asks-in-text',
    find: 'use AskUser first so the user chooses one option, then put only the selected approach in this plan.',
    replace:
      'request in plain text that the user chooses one option first, then put only the chosen approach in this plan.',
  },
  {
    name: 'exit-spec-rejection-asks-in-text',
    find: 'Call AskUser first so the user can choose one option, then call ExitSpecMode with a single concrete plan based on that choice.',
    replace:
      'Request in plain text that the user choose one option, then finish your turn; once they reply, call ExitSpecMode again with only the chosen approach.',
  },
  {
    name: 'harness-clarifies-in-text',
    find: '- You use your AskUser tool for blocking clarification instead of asking a plain-text question.',
    replace: '- Blocking clarification: write a plain-text question, then finish your turn.',
  },
  {
    name: 'stage-settings-asks-in-text',
    find: 'use AskUser to identify the exact setting or section before calling this tool.',
    replace:
      'request in plain text that the user identify the exact setting or section before calling this tool.',
  },
  {
    name: 'send-message-asks-in-text',
    find: 'Use AskUser for questions only the human can answer.',
    replace: 'Pose questions only the human can answer in plain text.',
  },
  {
    name: 'mission-scope-review-asks-in-text',
    find: '6. Use AskUser after the explanation so the user can decide how to proceed.',
    replace:
      '6. Request direction from the user through plain text after explaining. Finish your turn.',
  },
  {
    name: 'mission-orchestrator-asks-in-text',
    find: 'ask them with AskUser when a decision is theirs',
    replace: 'ask them in plain text when a decision is theirs',
  },
  {
    name: 'mission-agent-asks-in-text',
    find: 'Use AskUser only for questions the human alone can answer.',
    replace: 'Pose questions only the human alone can answer in plain text.',
  },
  {
    name: 'remote-computer-asks-in-text',
    find: 'use AskUser to confirm which computer to use before launching.',
    replace: 'confirm in plain text which computer to use before launching.',
  },
  {
    name: 'readiness-pick-category-asks-in-text',
    find: 'Ask the user which category they want to fix using the AskUser tool.',
    replace: 'Ask the user in plain text which category they want to fix.',
  },
  {
    name: 'readiness-pick-signal-asks-in-text',
    find: 'in a single AskUser call.',
    replace: 'in a single plain-text question.',
  },
  {
    name: 'readiness-report-asks-in-text',
    find: 'via the AskUser tool for selection',
    replace: 'in plain text for selection',
  },
  {
    name: 'readiness-catalog-category-asks-in-text',
    find: 'Ask the user which category to fix using the AskUser tool:',
    replace: 'Ask the user in plain text which category to fix:',
  },
  {
    name: 'readiness-catalog-signal-asks-in-text',
    find: 'in a single AskUser call with one question.',
    replace: 'in one plain-text question.',
  },
  {
    name: 'readiness-catalog-drops-option-limit',
    find: ' IMPORTANT: The AskUser tool has a hard limit of 10 options per question.',
    replace: '',
  },
  {
    name: 'readiness-first-step-asks-in-text',
    find: 'Ask the user using the AskUser tool:',
    replace: 'Ask the user in plain text:',
  },
];

export const askUserPatches: readonly Patch[] = [
  {
    name: 'ask-user-tool-never-enabled',
    find: `${ASK_USER_DEFINITION_TAIL}isToolEnabled:({cliDroidMode:t,askUserToolEnabled:o})=>o===!0&&(t==="terminal-ui"||t==="interactive-cli")`,
    replace: `${ASK_USER_DEFINITION_TAIL}isToolEnabled:!1`,
  },
  {
    name: 'spec-reminder-without-ask-user',
    find: 'isAskUserEnabled:!je().isAcpMode()',
    replace: 'isAskUserEnabled:!1',
  },
  ...askUserTextPatches,
];
