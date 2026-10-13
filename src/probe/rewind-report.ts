import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, fieldsOfJson, worded } from './fields.ts';

export const TASK_TAGS = ['kept', 'cut', 'after'] as const;
export type TaskTag = (typeof TASK_TAGS)[number];

export const LAUNCH_WORD = 'LAUNCH';
export const CHECK_WORD = 'CHECK';
export const HOLD_WORD = 'hold:';

const LAUNCH = new RegExp(`${LAUNCH_WORD} (?<tag>\\w+)`, 'gu');
const CHECK = new RegExp(`${CHECK_WORD} (?<id>\\S+)`, 'gu');
const HOLD = new RegExp(`${HOLD_WORD}(?<tag>\\w+)`, 'u');
const FOOTER_AGENTS = /(?<count>\d+) background agents? running/gu;
const NOTICE_START = 'Background task';
const NOT_FOUND = 'No task found';
const TASK_TOOL = 'Task';
const TOOL_RESULT = 'tool_result';

export type StubAnswer =
  | { kind: 'text' }
  | { kind: 'launch'; tag: string }
  | { kind: 'check'; taskId: string }
  | { kind: 'child'; tag: string };

function blocksOf(message: Fields): Fields[] {
  const content = message.get('content');
  return typeof content === 'string'
    ? [
        new Map<string, unknown>([
          ['type', 'text'],
          ['text', content],
        ]),
      ]
    : entriesOf(message, 'content');
}

function textOf(message: Fields): string {
  return blocksOf(message)
    .filter((block) => worded(block, 'type') === 'text')
    .map((block) => worded(block, 'text'))
    .join('\n');
}

function lastGroup(pattern: RegExp, text: string, group: string): string | undefined {
  return [...text.matchAll(pattern)].at(-1)?.groups?.[group];
}

export function answerFor(body: unknown): StubAnswer {
  const raw = JSON.stringify(body);
  const request = fieldsOf(body);
  if (!raw.includes(`${LAUNCH_WORD} `)) {
    const tag = HOLD.exec(raw)?.groups?.['tag'];
    return tag === undefined ? { kind: 'text' } : { kind: 'child', tag };
  }
  const tools = entriesOf(request, 'tools').map((tool) => worded(tool, 'name'));
  const last = entriesOf(request, 'messages').at(-1);
  if (!tools.includes(TASK_TOOL) || last === undefined || worded(last, 'role') !== 'user') {
    return { kind: 'text' };
  }
  if (blocksOf(last).some((block) => worded(block, 'type') === TOOL_RESULT)) {
    return { kind: 'text' };
  }
  const text = textOf(last);
  const taskId = lastGroup(CHECK, text, 'id');
  if (taskId !== undefined) {
    return { kind: 'check', taskId };
  }
  const tag = lastGroup(LAUNCH, text, 'tag');
  return tag === undefined ? { kind: 'text' } : { kind: 'launch', tag };
}

export interface ChatFiles {
  transcript: string;
  settings: string;
}

export interface TaskRecord {
  parentSessionId: string;
  childSessionId: string;
  status: string;
}

export interface RewindEvidence {
  oldChat: string;
  newChat: string;
  chats: { old: ChatFiles; new: ChatFiles };
  tasks: Partial<Record<TaskTag, TaskRecord>>;
  childTagParents: Partial<Record<TaskTag, string>>;
  footer: readonly string[];
  checkCallId: string;
  active: ActiveChatEvidence;
}

export interface ActiveChatEvidence {
  prompt: string;
  afterCallId: string;
  keptChildTranscript: string;
  afterChildTranscript: string;
  titleAtRewind: string;
  titleAtEnd: string;
}

export type Owner =
  | 'the new chat'
  | 'the old chat'
  | 'the moved agent'
  | 'another chat'
  | 'no chat';
export type Landing = 'the new chat' | 'the old chat' | 'both chats' | 'neither chat';
export type TaskOutputResult = 'found' | 'not found' | 'not run';

export interface TaskReading {
  started: boolean;
  storeParent: Owner;
  tagParent: Owner;
  notice: Landing;
  tokens: Landing;
}

export interface ActiveReading {
  promptInNewChat: boolean;
  promptInMovedAgent: boolean;
  callInNewChat: boolean;
  newAgentParent: Owner;
  titleAtRewind: string;
  titleAtEnd: string;
}

export interface RewindReading {
  footerAgents: number;
  taskOutput: TaskOutputResult;
  tasks: Record<TaskTag, TaskReading>;
  active: ActiveReading;
}

function messagesIn(transcript: string): Fields[] {
  return transcript
    .split('\n')
    .map((line) => fieldsOf(fieldsOfJson(line).get('message')))
    .filter((message) => message.size > 0);
}

function hasNotice(transcript: string, child: string): boolean {
  return messagesIn(transcript).some((message) => {
    const text = textOf(message);
    return text.includes(NOTICE_START) && text.includes(`task_id: ${child}`);
  });
}

function hasTokens(settings: string, child: string): boolean {
  const usage = fieldsOf(fieldsOfJson(settings).get('childInclusiveTokenUsageBySessionId'));
  return usage.has(child);
}

function landing(inOld: boolean, inNew: boolean): Landing {
  if (inOld && inNew) {
    return 'both chats';
  }
  if (inNew) {
    return 'the new chat';
  }
  return inOld ? 'the old chat' : 'neither chat';
}

function ownerOf(evidence: RewindEvidence, id: string | undefined): Owner {
  if (id === undefined || id === '') {
    return 'no chat';
  }
  if (id === evidence.newChat) {
    return 'the new chat';
  }
  if (id === evidence.tasks.kept?.childSessionId) {
    return 'the moved agent';
  }
  return id === evidence.oldChat ? 'the old chat' : 'another chat';
}

function readTask(evidence: RewindEvidence, tag: TaskTag): TaskReading {
  const task = evidence.tasks[tag];
  if (task === undefined) {
    return {
      started: false,
      storeParent: 'no chat',
      tagParent: 'no chat',
      notice: 'neither chat',
      tokens: 'neither chat',
    };
  }
  const { old, new: fresh } = evidence.chats;
  const child = task.childSessionId;
  return {
    started: true,
    storeParent: ownerOf(evidence, task.parentSessionId),
    tagParent: ownerOf(evidence, evidence.childTagParents[tag]),
    notice: landing(hasNotice(old.transcript, child), hasNotice(fresh.transcript, child)),
    tokens: landing(hasTokens(old.settings, child), hasTokens(fresh.settings, child)),
  };
}

function readTaskOutput(transcript: string, callId: string): TaskOutputResult {
  for (const message of messagesIn(transcript)) {
    const result = blocksOf(message).find(
      (block) => worded(block, 'type') === TOOL_RESULT && worded(block, 'tool_use_id') === callId,
    );
    if (result !== undefined) {
      return JSON.stringify(Object.fromEntries(result)).includes(NOT_FOUND) ? 'not found' : 'found';
    }
  }
  return 'not run';
}

function sessionStart(transcript: string): Fields {
  const [first = ''] = transcript.split('\n', 1);
  return fieldsOfJson(first);
}

export function titleOf(transcript: string): string {
  return worded(sessionStart(transcript), 'title');
}

function hasText(transcript: string, role: string, text: string): boolean {
  return messagesIn(transcript).some(
    (message) => worded(message, 'role') === role && textOf(message).includes(text),
  );
}

function hasCall(transcript: string, callId: string): boolean {
  return messagesIn(transcript).some((message) =>
    blocksOf(message).some(
      (block) => worded(block, 'type') === 'tool_use' && worded(block, 'id') === callId,
    ),
  );
}

function readActive(evidence: RewindEvidence): ActiveReading {
  const { active } = evidence;
  const fresh = evidence.chats.new.transcript;
  return {
    promptInNewChat: hasText(fresh, 'user', active.prompt),
    promptInMovedAgent: hasText(active.keptChildTranscript, 'user', active.prompt),
    callInNewChat: hasCall(fresh, active.afterCallId),
    newAgentParent: ownerOf(
      evidence,
      worded(sessionStart(active.afterChildTranscript), 'callingSessionId'),
    ),
    titleAtRewind: active.titleAtRewind,
    titleAtEnd: active.titleAtEnd,
  };
}

export function readRewind(evidence: RewindEvidence): RewindReading {
  const count = lastGroup(FOOTER_AGENTS, evidence.footer.join('\n'), 'count');
  return {
    footerAgents: count === undefined ? 0 : Number(count),
    taskOutput: readTaskOutput(evidence.chats.new.transcript, evidence.checkCallId),
    tasks: {
      kept: readTask(evidence, 'kept'),
      cut: readTask(evidence, 'cut'),
      after: readTask(evidence, 'after'),
    },
    active: readActive(evidence),
  };
}

export interface Verdict {
  pass: boolean;
  text: string;
}

function afterVerdict(task: TaskReading): Verdict {
  if (!task.started) {
    return { pass: false, text: 'the agent started after the rewind never ran' };
  }
  const pass = task.storeParent === 'the new chat' && task.tagParent === 'the new chat';
  return {
    pass,
    text: pass
      ? 'an agent started after the rewind belongs to the new chat'
      : `an agent started after the rewind belongs to ${task.storeParent} (its tag names ${task.tagParent})`,
  };
}

function footerVerdict(count: number): Verdict {
  return count > 0
    ? {
        pass: true,
        text: `the footer after the rewind shows ${count} running agent(s), so the running agent moved to the new chat`,
      }
    : {
        pass: false,
        text: 'the footer after the rewind shows no running agent, so the running agent was left behind in the old chat',
      };
}

function taskOutputVerdict(result: TaskOutputResult): Verdict {
  if (result === 'found') {
    return { pass: true, text: 'TaskOutput in the new chat found the running agent' };
  }
  return {
    pass: false,
    text:
      result === 'not found'
        ? 'TaskOutput in the new chat said "No task found", so the agent still belongs to the old chat'
        : 'TaskOutput never ran in the new chat',
  };
}

function keptVerdict(task: TaskReading): Verdict {
  const pass =
    task.notice === 'the new chat' &&
    task.tokens === 'the new chat' &&
    task.storeParent === 'the new chat' &&
    task.tagParent === 'the new chat';
  return {
    pass,
    text: [
      `the agent whose call the rewind kept sent its completion notice to ${task.notice}`,
      `its token count rolled up into ${task.tokens}`,
      `the task store names ${task.storeParent} as its parent and its tag names ${task.tagParent}`,
    ].join('; '),
  };
}

function cutVerdict(task: TaskReading): Verdict {
  if (!task.started) {
    return { pass: false, text: 'the agent whose call the rewind cut away never ran' };
  }
  const pass =
    task.storeParent === 'the old chat' &&
    task.tagParent === 'the old chat' &&
    task.notice !== 'the new chat';
  return {
    pass,
    text: pass
      ? `the agent whose call the rewind cut away stayed with the old chat (its completion notice went to ${task.notice})`
      : `the agent whose call the rewind cut away belongs to ${task.storeParent} and sent its completion notice to ${task.notice}`,
  };
}

function activeVerdict(active: ActiveReading): Verdict {
  const problems = [
    ...(active.promptInNewChat
      ? []
      : ['the prompt sent after TaskOutput is missing from the new chat']),
    ...(active.promptInMovedAgent ? ["the prompt landed in the moved agent's transcript"] : []),
    ...(active.callInNewChat ? [] : ['the Task call it got is missing from the new chat']),
    ...(active.newAgentParent === 'the new chat'
      ? []
      : [`the agent it launched names ${active.newAgentParent} as its calling session`]),
    ...(active.titleAtEnd === active.titleAtRewind
      ? []
      : [`the chat title changed from "${active.titleAtRewind}" to "${active.titleAtEnd}"`]),
  ];
  return problems.length === 0
    ? {
        pass: true,
        text: `after TaskOutput ran in the new chat, that chat stayed the active session: the next prompt and its Task call landed there, the agent it launched names it as its calling session, and the title stayed "${active.titleAtEnd}"`,
      }
    : {
        pass: false,
        text: `after TaskOutput ran in the new chat, that chat stopped being the active session: ${problems.join('; ')}`,
      };
}

export function rewindVerdicts(reading: RewindReading): Verdict[] {
  if (!reading.tasks.kept.started) {
    return [
      {
        pass: false,
        text: 'the agent launched before the rewind never ran, so nothing was tested',
      },
    ];
  }
  return [
    afterVerdict(reading.tasks.after),
    footerVerdict(reading.footerAgents),
    taskOutputVerdict(reading.taskOutput),
    activeVerdict(reading.active),
    keptVerdict(reading.tasks.kept),
    cutVerdict(reading.tasks.cut),
  ];
}

export function describeRewind(verdicts: readonly Verdict[]): string {
  return verdicts.map((verdict) => `${verdict.pass ? 'ok  ' : 'FAIL'}  ${verdict.text}`).join('\n');
}
