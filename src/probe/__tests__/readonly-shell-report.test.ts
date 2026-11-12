import { describe, expect, test } from 'bun:test';

import type { ReadonlyEvidence } from '../readonly-shell-report.ts';
import {
  callId,
  CHILDREN,
  droidFile,
  launchPrompt,
  LEGS,
  noticesIn,
  readonlyVerdicts,
  replyFor,
  resumePrompt,
  sessionOf,
} from '../readonly-shell-report.ts';

const RUN = 'r1';
const PLAN = { run: RUN, markers: '/m' };
const STEPS = ['medium', 'high', 'create'];
const REFUSAL = 'Error: Tool blocked in delegated session: the command requires confirmation.';
const NOTICE = 'Background task completed.\ntask_id: s-1\noutput: done';

function childNamed(name: string) {
  const child = CHILDREN.find((candidate) => candidate.name === name);
  if (child === undefined) {
    throw new Error(`no child ${name}`);
  }
  return child;
}

const FLAG = childNamed('flag');
const TOOLS = childNamed('tools');

function user(text: string) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function calls(id: string) {
  return { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Execute', input: {} }] };
}

function result(id: string, text: string) {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] };
}

function parentAsks(...messages: object[]) {
  return { tools: [{ name: 'Task' }], messages };
}

function childAsks(...messages: object[]) {
  return { tools: [{ name: 'Script' }], messages };
}

function taskPrompt(name: string, leg: string): object {
  return user(`# Task Tool Invocation\n\n## Task\nreadonly-child:${name}:${leg}`);
}

function stepKey(name: string, leg: string, step: string): string {
  return `${name}-${leg}-${step}`;
}

function evidenceOf(ran: readonly string[], silent: readonly string[] = []): ReadonlyEvidence {
  const keys = CHILDREN.flatMap(({ name }) =>
    LEGS.flatMap((leg) => STEPS.map((step) => stepKey(name, leg, step))),
  );
  return {
    run: RUN,
    markers: ran,
    bodies: keys
      .filter((key) => !silent.includes(key))
      .map((key, index) =>
        childAsks(
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: `call_0123456789abcdef_${index}`,
                name: key.endsWith('-create') ? 'Create' : 'Execute',
                input: key.endsWith('-create')
                  ? { file_path: `/m/${key}` }
                  : { command: `touch /m/${key}` },
              },
            ],
          },
          result(`call_0123456789abcdef_${index}`, ran.includes(key) ? 'ok' : REFUSAL),
        ),
      ),
    settings: {
      'flag-launch': JSON.stringify({ autonomyLevel: 'medium', tags: [{ name: 'read-only' }] }),
      'flag-resume': JSON.stringify({ autonomyLevel: 'medium', tags: [{ name: 'read-only' }] }),
      'tools-launch': JSON.stringify({ autonomyLevel: 'low', tags: [{ name: 'read-only' }] }),
    },
  };
}

const SHIPPED = ['flag-launch-medium', 'flag-resume-medium'];

describe('replyFor', () => {
  test('launches the flagged child with readonly: true', () => {
    expect(replyFor(parentAsks(user(launchPrompt(FLAG))), PLAN)).toEqual({
      id: callId(RUN, FLAG, 'launch'),
      name: 'Task',
      input: {
        subagent_type: FLAG.droid,
        description: 'readonly probe flag launch',
        prompt: 'readonly-child:flag:launch',
        readonly: true,
      },
    });
  });

  test('launches the tools: read-only droid without the flag', () => {
    const reply = replyFor(parentAsks(user(launchPrompt(TOOLS))), PLAN);
    expect(reply).toMatchObject({ name: 'Task', input: { subagent_type: TOOLS.droid } });
    expect(JSON.stringify(reply)).not.toContain('readonly"');
  });

  test('resumes the session it is given, without the flag', () => {
    const reply = replyFor(parentAsks(user(resumePrompt(FLAG, 's-1'))), PLAN);
    expect(reply).toMatchObject({
      id: callId(RUN, FLAG, 'resume'),
      input: { resume: 's-1', prompt: 'readonly-child:flag:resume' },
    });
    expect(JSON.stringify(reply)).not.toContain('readonly"');
  });

  test('says ok to the parent after a tool result, a notice, and a request without the Task tool', () => {
    const id = callId(RUN, FLAG, 'launch');
    expect(
      replyFor(parentAsks(user(launchPrompt(FLAG)), calls(id), result(id, 'started')), PLAN),
    ).toBe('ok');
    expect(replyFor(parentAsks(user(launchPrompt(FLAG)), calls(id), user(NOTICE)), PLAN)).toBe(
      'ok',
    );
    expect(replyFor({ tools: [], messages: [user(launchPrompt(FLAG))] }, PLAN)).toBe('ok');
  });

  test('walks a child through the medium command, the high command, Create, then done', () => {
    const prompt = taskPrompt('flag', 'launch');
    expect(replyFor(childAsks(prompt), PLAN)).toEqual({
      id: 'toolu_ror1_flag_launch_medium',
      name: 'Execute',
      input: {
        command: 'touch /m/flag-launch-medium',
        summary: 'Write the probe marker',
        riskLevel: 'medium',
      },
    });
    expect(replyFor(childAsks(prompt, calls('a'), result('a', 'ok')), PLAN)).toMatchObject({
      name: 'Execute',
      input: { command: 'touch /m/flag-launch-high', riskLevel: 'high' },
    });
    expect(replyFor(childAsks(prompt, calls('a'), calls('b')), PLAN)).toEqual({
      id: 'toolu_ror1_flag_launch_create',
      name: 'Create',
      input: { file_path: '/m/flag-launch-create', content: 'probe\n' },
    });
    expect(replyFor(childAsks(prompt, calls('a'), calls('b'), calls('c')), PLAN)).toBe('done');
  });

  test('starts the steps again after the follow-up prompt of a resume', () => {
    const body = childAsks(
      taskPrompt('tools', 'launch'),
      calls('a'),
      calls('b'),
      calls('c'),
      taskPrompt('tools', 'resume'),
      calls('d'),
    );
    expect(replyFor(body, PLAN)).toMatchObject({
      id: 'toolu_ror1_tools_resume_high',
      input: { command: 'touch /m/tools-resume-high' },
    });
  });
});

describe('droidFile', () => {
  test('only the tools child gets tools: read-only', () => {
    expect(droidFile(TOOLS)).toContain('\ntools: read-only\n');
    expect(droidFile(FLAG)).not.toContain('tools:');
    expect(droidFile(FLAG)).toContain(`name: ${FLAG.droid}\n`);
  });
});

describe('sessionOf', () => {
  test('reads the child session through Droid-assigned call IDs, not the stub ID', () => {
    const id = 'call_0123456789abcdef_0';
    const body = parentAsks(
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id,
            name: 'Task',
            input: { prompt: 'readonly-child:flag:launch' },
          },
        ],
      },
      result(id, 'Task launched in background.\ntask_id: s-1\nsession_id: s-1\n'),
    );
    expect(sessionOf([parentAsks(), body], FLAG, 'launch')).toBe('s-1');
    expect(sessionOf([body], FLAG, 'resume')).toBeUndefined();
    expect(sessionOf([body], TOOLS, 'launch')).toBeUndefined();
  });
});

describe('noticesIn', () => {
  test('counts the completion notices in the longest conversation', () => {
    expect(noticesIn([])).toBe(0);
    expect(
      noticesIn([parentAsks(user(NOTICE)), parentAsks(user(NOTICE), user('next'), user(NOTICE))]),
    ).toBe(2);
    expect(noticesIn([parentAsks(user('Background task talk'), calls('a'))])).toBe(0);
  });
});

describe('readonlyVerdicts', () => {
  test('passes when the flagged child runs only the medium command and the tools child runs nothing', () => {
    const verdicts = readonlyVerdicts(evidenceOf(SHIPPED));
    expect(verdicts.map((verdict) => verdict.pass)).toEqual([true, true, true, true]);
    expect(verdicts[0]?.text).toBe(
      'a sub-agent launched with readonly: true ran a medium-risk shell command, was refused a high-risk shell command, was refused Create (session autonomy medium)',
    );
    expect(verdicts[1]?.text).toContain('readonly: true, once resumed, ran a medium-risk');
    expect(verdicts[2]?.text).toContain('(session autonomy low)');
    expect(verdicts[3]?.text).toContain('(session autonomy unknown, no read-only tag)');
  });

  test('fails when the flagged child is refused the medium command, and quotes the refusal', () => {
    const verdicts = readonlyVerdicts(evidenceOf(['flag-launch-medium']));
    expect(verdicts.map((verdict) => verdict.pass)).toEqual([true, false, true, true]);
    expect(verdicts[1]?.text).toEndWith(
      `; expected instead: ran a medium-risk shell command; Droid answered: ${REFUSAL}`,
    );
  });

  test('fails when a tools: read-only droid runs the medium command', () => {
    const verdicts = readonlyVerdicts(evidenceOf([...SHIPPED, 'tools-resume-medium']));
    expect(verdicts.map((verdict) => verdict.pass)).toEqual([true, true, true, false]);
    expect(verdicts[3]?.text).toContain(
      'expected instead: was refused a medium-risk shell command',
    );
  });

  test('fails when a high command runs or Create writes', () => {
    const verdicts = readonlyVerdicts(
      evidenceOf([...SHIPPED, 'flag-launch-high', 'flag-launch-create']),
    );
    expect(verdicts[0]?.pass).toBe(false);
    expect(verdicts[0]?.text).toContain(
      'expected instead: was refused a high-risk shell command, was refused Create',
    );
  });

  test('says not exercised when a step never reported back', () => {
    const verdicts = readonlyVerdicts(evidenceOf(SHIPPED, ['tools-launch-create']));
    expect(verdicts[2]?.pass).toBe(false);
    expect(verdicts[2]?.text).toStartWith('not exercised: ');
    expect(verdicts[2]?.text).toContain('never reported back on Create');
  });
});
