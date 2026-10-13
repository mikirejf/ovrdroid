import { describe, expect, test } from 'bun:test';

import type {
  ActiveChatEvidence,
  ChatFiles,
  RewindEvidence,
  TaskRecord,
} from '../rewind-report.ts';
import { answerFor, describeRewind, readRewind, rewindVerdicts } from '../rewind-report.ts';

const OLD = 'old-chat';
const NEW = 'new-chat';
const CHECK_CALL = 'toolu_check';
const AFTER_CALL = 'toolu_after';
const AFTER_PROMPT = 'LAUNCH after';
const TITLE = 'Launch kept';

const TASK_TOOLS = [{ name: 'Task' }, { name: 'TaskOutput' }];

type Block = Record<string, string>;

interface Message {
  role: string;
  content: string | readonly Block[];
}

function user(content: string | readonly Block[]): Message {
  return { role: 'user', content };
}

describe('the stub model', () => {
  test('launches a task when the last prompt asks for one and the Task tool is offered', () => {
    const body = { tools: TASK_TOOLS, messages: [user([{ type: 'text', text: 'LAUNCH kept' }])] };
    expect(answerFor(body)).toEqual({ kind: 'launch', tag: 'kept' });
  });

  test('reads a plain string prompt too', () => {
    const body = { tools: TASK_TOOLS, messages: [user('LAUNCH cut')] };
    expect(answerFor(body)).toEqual({ kind: 'launch', tag: 'cut' });
  });

  test('answers with text once the tool result is back', () => {
    const body = {
      tools: TASK_TOOLS,
      messages: [
        user('LAUNCH kept'),
        { role: 'assistant', content: [{ type: 'tool_use', id: 'a' }] },
        user([{ type: 'tool_result', tool_use_id: 'a' }]),
      ],
    };
    expect(answerFor(body)).toEqual({ kind: 'text' });
  });

  test('asks TaskOutput about the named child, even with older launch prompts above', () => {
    const body = {
      tools: TASK_TOOLS,
      messages: [user('LAUNCH kept'), { role: 'assistant', content: 'ok' }, user('CHECK child-1')],
    };
    expect(answerFor(body)).toEqual({ kind: 'check', taskId: 'child-1' });
  });

  test('answers a title request with text, since it offers no Task tool', () => {
    expect(answerFor({ messages: [user('LAUNCH kept')] })).toEqual({ kind: 'text' });
  });

  test('recognises the subagent by its hold tag', () => {
    const body = { tools: TASK_TOOLS, messages: [user('hold:kept')] };
    expect(answerFor(body)).toEqual({ kind: 'child', tag: 'kept' });
  });

  test('answers a later parent prompt that is neither launch nor check with text', () => {
    const body = {
      tools: TASK_TOOLS,
      messages: [user('LAUNCH kept'), user('Background task completed.')],
    };
    expect(answerFor(body)).toEqual({ kind: 'text' });
  });
});

function line(message: Message): string {
  return JSON.stringify({ type: 'message', message });
}

function notice(child: string): string {
  return line(user([{ type: 'text', text: `Background task completed.\ntask_id: ${child}\n` }]));
}

function checkResult(content: string): string {
  return line(user([{ type: 'tool_result', tool_use_id: CHECK_CALL, content }]));
}

function sessionStart(fields: Record<string, string>): string {
  return JSON.stringify({ type: 'session_start', ...fields });
}

function afterTurn(): string {
  return [
    line(user(AFTER_PROMPT)),
    line({ role: 'assistant', content: [{ type: 'tool_use', id: AFTER_CALL }] }),
  ].join('\n');
}

function settingsWith(children: readonly string[]): string {
  return JSON.stringify({
    childInclusiveTokenUsageBySessionId: Object.fromEntries(children.map((child) => [child, {}])),
  });
}

function task(parent: string, child: string): TaskRecord {
  return { parentSessionId: parent, childSessionId: child, status: 'completed' };
}

interface Run {
  old: ChatFiles;
  fresh: ChatFiles;
  keptParent: string;
  footer: readonly string[];
  active?: Partial<ActiveChatEvidence>;
}

function evidence(run: Run): RewindEvidence {
  return {
    oldChat: OLD,
    newChat: NEW,
    chats: { old: run.old, new: run.fresh },
    tasks: {
      kept: task(run.keptParent, 'child-kept'),
      cut: task(OLD, 'child-cut'),
      after: task(NEW, 'child-after'),
    },
    childTagParents: { kept: run.keptParent, cut: OLD, after: NEW },
    footer: run.footer,
    checkCallId: CHECK_CALL,
    active: {
      prompt: AFTER_PROMPT,
      afterCallId: AFTER_CALL,
      keptChildTranscript: [sessionStart({ callingSessionId: OLD }), line(user('hold:kept'))].join(
        '\n',
      ),
      afterChildTranscript: sessionStart({ callingSessionId: NEW }),
      titleAtRewind: TITLE,
      titleAtEnd: TITLE,
      ...run.active,
    },
  };
}

const moved: Run = {
  old: { transcript: '', settings: '{}' },
  fresh: {
    transcript: [
      sessionStart({ title: TITLE }),
      checkResult('Task ID: child-kept\nStatus: running'),
      afterTurn(),
      notice('child-kept'),
      notice('child-after'),
    ].join('\n'),
    settings: settingsWith(['child-kept', 'child-after']),
  },
  keptParent: NEW,
  footer: ['', ' 1 background agent running', '╰──╯'],
};

const leftBehind: Run = {
  old: { transcript: notice('child-kept'), settings: settingsWith(['child-kept']) },
  fresh: {
    transcript: [
      sessionStart({ title: TITLE }),
      checkResult('Error: No task found with ID: child-kept.'),
      afterTurn(),
    ].join('\n'),
    settings: settingsWith(['child-after']),
  },
  keptParent: OLD,
  footer: ['╰──╯'],
};

describe('reading a rewind run', () => {
  test('a run where the agent moved passes every check', () => {
    const reading = readRewind(evidence(moved));
    expect(reading.footerAgents).toBe(1);
    expect(reading.taskOutput).toBe('found');
    expect(reading.tasks.kept).toEqual({
      started: true,
      storeParent: 'the new chat',
      tagParent: 'the new chat',
      notice: 'the new chat',
      tokens: 'the new chat',
    });
    expect(reading.tasks.cut.storeParent).toBe('the old chat');
    expect(rewindVerdicts(reading).every((verdict) => verdict.pass)).toBe(true);
  });

  test('a run where the agent stayed behind fails the footer, TaskOutput and hand-over checks', () => {
    const verdicts = rewindVerdicts(readRewind(evidence(leftBehind)));
    expect(verdicts.map((verdict) => verdict.pass)).toEqual([
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(describeRewind(verdicts)).toContain(
      'FAIL  the footer after the rewind shows no running agent, so the running agent was left behind in the old chat',
    );
    expect(describeRewind(verdicts)).toContain('sent its completion notice to the old chat');
  });

  test('reads that the new chat stayed active through the next prompt', () => {
    expect(readRewind(evidence(moved)).active).toEqual({
      promptInNewChat: true,
      promptInMovedAgent: false,
      callInNewChat: true,
      newAgentParent: 'the new chat',
      titleAtRewind: TITLE,
      titleAtEnd: TITLE,
    });
  });

  test('a switch to the moved agent fails with each sign of it', () => {
    const keptAgent = [
      sessionStart({ callingSessionId: NEW }),
      line(user(AFTER_PROMPT)),
      line({ role: 'assistant', content: [{ type: 'tool_use', id: AFTER_CALL }] }),
    ].join('\n');
    const run: Run = {
      ...moved,
      fresh: { ...moved.fresh, transcript: sessionStart({ title: TITLE }) },
      active: {
        keptChildTranscript: keptAgent,
        afterChildTranscript: sessionStart({ callingSessionId: 'child-kept' }),
        titleAtEnd: 'Ovrdroid-rewind-probe: rewind probe kept',
      },
    };
    const verdict = rewindVerdicts(readRewind(evidence(run))).find((each) =>
      each.text.includes('active session'),
    );
    expect(verdict?.pass).toBe(false);
    expect(verdict?.text).toBe(
      'after TaskOutput ran in the new chat, that chat stopped being the active session: ' +
        'the prompt sent after TaskOutput is missing from the new chat; ' +
        "the prompt landed in the moved agent's transcript; " +
        'the Task call it got is missing from the new chat; ' +
        'the agent it launched names the moved agent as its calling session; ' +
        'the chat title changed from "Launch kept" to "Ovrdroid-rewind-probe: rewind probe kept"',
    );
  });

  test('a TaskOutput call that never ran is reported as such', () => {
    const run = {
      ...moved,
      fresh: {
        ...moved.fresh,
        transcript: [sessionStart({ title: TITLE }), afterTurn()].join('\n'),
      },
    };
    expect(readRewind(evidence(run)).taskOutput).toBe('not run');
  });

  test('a cut agent whose notice reached the new chat fails', () => {
    const run = {
      ...moved,
      fresh: { ...moved.fresh, transcript: `${moved.fresh.transcript}\n${notice('child-cut')}` },
    };
    const verdicts = rewindVerdicts(readRewind(evidence(run)));
    expect(verdicts.at(-1)?.pass).toBe(false);
  });

  test('a run where the first agent never started says nothing was tested', () => {
    const { kept: _kept, ...tasks } = evidence(moved).tasks;
    const verdicts = rewindVerdicts(readRewind({ ...evidence(moved), tasks }));
    expect(verdicts).toEqual([
      {
        pass: false,
        text: 'the agent launched before the rewind never ran, so nothing was tested',
      },
    ]);
  });
});
