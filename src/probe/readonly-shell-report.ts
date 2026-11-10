import path from 'node:path';

import { entriesOf, fieldsOf, fieldsOfJson, resultText, worded } from './fields.ts';
import type { Fields } from './fields.ts';
import type { Verdict } from './stale-edit-cases.ts';
import { toolResultsIn } from './stale-edit-cases.ts';
import type { ToolCall } from './stub-model.ts';

const LAUNCH_WORD = 'READONLY-LAUNCH';
const RESUME_WORD = 'READONLY-RESUME';
const CHILD_WORD = 'readonly-child';
const TASK_TOOL = 'Task';
const READ_ONLY = 'read-only';
const SAID_TO_PARENT = 'ok';
const SAID_BY_CHILD = 'done';
const ANSWER_CHARS = 240;

const LAUNCH = new RegExp(`${LAUNCH_WORD} (?<child>\\w+)`, 'u');
const RESUME = new RegExp(`${RESUME_WORD} (?<child>\\w+) (?<session>\\S+)`, 'u');
const CHILD_PROMPT = new RegExp(`${CHILD_WORD}:(?<child>\\w+):(?<leg>\\w+)`, 'u');
const SESSION = /^session_id: (?<session>\S+)$/mu;
const NOTICE = /^Background task \w+\.\ntask_id: /mu;

export const LEGS = ['launch', 'resume'] as const;
export type Leg = (typeof LEGS)[number];
const STEPS = ['medium', 'high', 'create'] as const;
type Step = (typeof STEPS)[number];
type Outcome = 'ran' | 'refused' | 'no result';

export interface Child {
  name: string;
  droid: string;
  flagged: boolean;
  who: string;
  expected: Record<Step, Outcome>;
}

export const CHILDREN: readonly Child[] = [
  {
    name: 'flag',
    droid: 'ovrdroid-readonly-flag-probe',
    flagged: true,
    who: 'a sub-agent launched with readonly: true',
    expected: { medium: 'ran', high: 'refused', create: 'refused' },
  },
  {
    name: 'tools',
    droid: 'ovrdroid-readonly-tools-probe',
    flagged: false,
    who: 'a sub-agent whose droid file says tools: read-only',
    expected: { medium: 'refused', high: 'refused', create: 'refused' },
  },
];

const SAW: Record<Step, Record<Outcome, string>> = {
  medium: {
    ran: 'ran a medium-risk shell command',
    refused: 'was refused a medium-risk shell command',
    'no result': 'never reported back on a medium-risk shell command',
  },
  high: {
    ran: 'ran a high-risk shell command',
    refused: 'was refused a high-risk shell command',
    'no result': 'never reported back on a high-risk shell command',
  },
  create: {
    ran: 'wrote a file with Create',
    refused: 'was refused Create',
    'no result': 'never reported back on Create',
  },
};

export interface Plan {
  run: string;
  markers: string;
}

export interface ReadonlyEvidence {
  run: string;
  bodies: readonly unknown[];
  markers: readonly string[];
  settings: Readonly<Record<string, string>>;
}

export function droidFile(child: Child): string {
  const tools = child.flagged ? '' : `tools: ${READ_ONLY}\n`;
  return `---\nname: ${child.droid}\ndescription: Runs shell commands for a probe.\nmodel: inherit\n${tools}---\nDo what the prompt says.\n`;
}

export function launchPrompt(child: Child): string {
  return `${LAUNCH_WORD} ${child.name}`;
}

export function resumePrompt(child: Child, session: string): string {
  return `${RESUME_WORD} ${child.name} ${session}`;
}

export function legKey(child: Child, leg: Leg): string {
  return `${child.name}-${leg}`;
}

export function callId(run: string, child: Child, leg: Leg): string {
  return `toolu_ro${run}_${child.name}_${leg}`;
}

interface Turn {
  child: Child;
  leg: Leg;
}

function stepId(run: string, { child, leg }: Turn, step: Step): string {
  return `${callId(run, child, leg)}_${step}`;
}

function markerName(child: Child, leg: Leg, step: Step): string {
  return `${legKey(child, leg)}-${step}`;
}

function taskCall(plan: Plan, { child, leg }: Turn, extra: ToolCall['input']): ToolCall {
  return {
    id: callId(plan.run, child, leg),
    name: TASK_TOOL,
    input: {
      subagent_type: child.droid,
      description: `readonly probe ${child.name} ${leg}`,
      prompt: `${CHILD_WORD}:${child.name}:${leg}`,
      ...extra,
    },
  };
}

function stepCall(plan: Plan, turn: Turn, step: Step): ToolCall {
  const id = stepId(plan.run, turn, step);
  const file = path.join(plan.markers, markerName(turn.child, turn.leg, step));
  return step === 'create'
    ? { id, name: 'Create', input: { file_path: file, content: 'probe\n' } }
    : {
        id,
        name: 'Execute',
        input: { command: `touch ${file}`, summary: 'Write the probe marker', riskLevel: step },
      };
}

function hasRole(message: Fields, role: string): boolean {
  return worded(message, 'role') === role;
}

function blocksOfKind(messages: readonly Fields[], kind: string): Fields[] {
  return messages
    .flatMap((message) => entriesOf(message, 'content'))
    .filter((block) => worded(block, 'type') === kind);
}

function childNamed(name: string | undefined): Child | undefined {
  return CHILDREN.find((child) => child.name === name);
}

function childReply(prompt: Fields, since: readonly Fields[], plan: Plan): ToolCall | string {
  const groups = CHILD_PROMPT.exec(resultText(prompt))?.groups;
  const child = childNamed(groups?.['child']);
  const leg = LEGS.find((name) => name === groups?.['leg']);
  const answers = since.filter((message) => hasRole(message, 'assistant'));
  const step = STEPS[blocksOfKind(answers, 'tool_use').length];
  return child === undefined || leg === undefined || step === undefined
    ? SAID_BY_CHILD
    : stepCall(plan, { child, leg }, step);
}

function parentReply(request: Fields, last: Fields | undefined, plan: Plan): ToolCall | string {
  const offersTask = entriesOf(request, 'tools').some((tool) => worded(tool, 'name') === TASK_TOOL);
  if (
    !offersTask ||
    last === undefined ||
    !hasRole(last, 'user') ||
    blocksOfKind([last], 'tool_result').length > 0
  ) {
    return SAID_TO_PARENT;
  }
  const text = resultText(last);
  const resume = RESUME.exec(text)?.groups;
  const resumed = childNamed(resume?.['child']);
  if (resumed !== undefined) {
    return taskCall(plan, { child: resumed, leg: 'resume' }, { resume: resume?.['session'] ?? '' });
  }
  const launched = childNamed(LAUNCH.exec(text)?.groups?.['child']);
  if (launched === undefined) {
    return SAID_TO_PARENT;
  }
  return taskCall(
    plan,
    { child: launched, leg: 'launch' },
    launched.flagged ? { readonly: true } : {},
  );
}

export function replyFor(body: unknown, plan: Plan): ToolCall | string {
  const request = fieldsOf(body);
  const messages = entriesOf(request, 'messages');
  const prompt = messages.findLast(
    (message) => hasRole(message, 'user') && CHILD_PROMPT.test(resultText(message)),
  );
  return prompt === undefined
    ? parentReply(request, messages.at(-1), plan)
    : childReply(prompt, messages.slice(messages.lastIndexOf(prompt)), plan);
}

export function sessionOf(bodies: readonly unknown[], id: string): string | undefined {
  for (const body of bodies) {
    const session = SESSION.exec(toolResultsIn(body).get(id)?.text ?? '')?.groups?.['session'];
    if (session !== undefined) {
      return session;
    }
  }
  return undefined;
}

export function noticesIn(bodies: readonly unknown[]): number {
  return Math.max(
    0,
    ...bodies.map(
      (body) =>
        entriesOf(fieldsOf(body), 'messages').filter(
          (message) => hasRole(message, 'user') && NOTICE.test(resultText(message)),
        ).length,
    ),
  );
}

interface LegReading {
  child: Child;
  leg: Leg;
  level: string;
  tagged: boolean;
  outcomes: Record<Step, Outcome>;
  answers: Record<Step, string>;
}

function readLeg(evidence: ReadonlyEvidence, child: Child, leg: Leg): LegReading {
  const settings = fieldsOfJson(evidence.settings[legKey(child, leg)] ?? '');
  const results = new Map(evidence.bodies.flatMap((body) => [...toolResultsIn(body)]));
  const answer = (step: Step) => results.get(stepId(evidence.run, { child, leg }, step))?.text;
  const outcome = (step: Step): Outcome => {
    if (evidence.markers.includes(markerName(child, leg, step))) {
      return 'ran';
    }
    return answer(step) === undefined ? 'no result' : 'refused';
  };
  return {
    child,
    leg,
    level: worded(settings, 'autonomyLevel'),
    tagged: entriesOf(settings, 'tags').some((tag) => worded(tag, 'name') === READ_ONLY),
    outcomes: { medium: outcome('medium'), high: outcome('high'), create: outcome('create') },
    answers: {
      medium: answer('medium') ?? '',
      high: answer('high') ?? '',
      create: answer('create') ?? '',
    },
  };
}

function legVerdict({ child, leg, level, tagged, outcomes, answers }: LegReading): Verdict {
  const who = leg === 'launch' ? child.who : `${child.who}, once resumed,`;
  const saw = STEPS.map((step) => SAW[step][outcomes[step]]).join(', ');
  const session = `session autonomy ${level === '' ? 'unknown' : level}${tagged ? '' : `, no ${READ_ONLY} tag`}`;
  const text = `${who} ${saw} (${session})`;
  const off = STEPS.filter((step) => outcomes[step] !== child.expected[step]);
  if (off.length === 0) {
    return { pass: true, text };
  }
  const untested = off.some((step) => outcomes[step] === 'no result') ? 'not exercised: ' : '';
  const wanted = off.map((step) => SAW[step][child.expected[step]]).join(', ');
  const answer =
    off.map((step) => answers[step].split('\n', 1)[0] ?? '').find((line) => line !== '') ?? '';
  const said = answer === '' ? '' : `; Droid answered: ${answer.slice(0, ANSWER_CHARS)}`;
  return { pass: false, text: `${untested}${text}; expected instead: ${wanted}${said}` };
}

export function readonlyVerdicts(evidence: ReadonlyEvidence): Verdict[] {
  return CHILDREN.flatMap((child) => LEGS.map((leg) => legVerdict(readLeg(evidence, child, leg))));
}
