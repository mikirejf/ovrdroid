import { describe, expect, test } from 'bun:test';

import { compactionPatches } from '../compaction-patches.ts';
import { PARENT_BRIEF_LEAD, PARENT_NOTE } from '../summary-format.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Block {
  type: string;
  text?: string;
}

interface MessageEvent {
  type: 'message';
  message: { role: string; content: Block[] };
}

interface SessionService {
  getCallingSessionId: (sessionId: string) => string | undefined;
  getAllMessageEvents: (sessionId: string) => Promise<MessageEvent[]>;
}

type Log = (message: string, fields: { length: number }) => void;

const SUMMARY = '<summary>\n1. Primary Request and Intent\nFix it.\n</summary>\n\n- [ ] todo one';
const SESSION = 'child';
const BRIEF = [
  '# Task Tool Invocation',
  '',
  'Subagent type: coder',
  '',
  '---BEGIN TASK FROM PARENT AGENT---',
  'Fix the bug in `a.ts`.',
  '  Keep   the spacing.',
  '---END TASK FROM PARENT AGENT---',
].join('\n');

const PATCH = patchNamed(compactionPatches, 'compaction-parent-brief');
const BODY = PATCH.replace.slice(0, -1);

const finish = payloadFunction<[Log, string, SessionService, string], Promise<string>>(
  ['s', 'ae', 'J', 'a'],
  `return (async()=>{${BODY})()`,
);

function post(role: string, ...blocks: Block[]): MessageEvent {
  return { type: 'message', message: { role, content: blocks } };
}

function text(value: string): Block {
  return { type: 'text', text: value };
}

const SUBAGENT_EVENTS = [
  post('user'),
  post(
    'user',
    text('<system-reminder>\nskills\n</system-reminder>'),
    text('<system-reminder>\ninfo\n</system-reminder>'),
  ),
  post('user', text(BRIEF)),
  post('assistant', { type: 'tool_use' }),
  post('user', text('a later user message')),
];

function service(events: () => Promise<MessageEvent[]>, callingSessionId?: string): SessionService {
  return {
    getCallingSessionId: () => callingSessionId,
    getAllMessageEvents: events,
  };
}

async function finishWith(session: SessionService): Promise<{ summary: string; logged: number[] }> {
  const logged: number[] = [];
  const summary = await finish(
    (_message, fields) => {
      logged.push(fields.length);
    },
    SUMMARY,
    session,
    SESSION,
  );
  return { summary, logged };
}

describe('compaction-parent-brief', () => {
  test('a subagent summary ends with the parent brief word for word and the note', async () => {
    const { summary, logged } = await finishWith(
      service(async () => await Promise.resolve(SUBAGENT_EVENTS), 'parent'),
    );
    expect(summary).toBe(`${SUMMARY}\n\n${PARENT_BRIEF_LEAD}\n\n${BRIEF}\n\n${PARENT_NOTE}`);
    expect(logged).toEqual([summary.length]);
  });

  test('skips an empty user message and a message of reminders only', async () => {
    const events = [post('user'), post('user', text('')), ...SUBAGENT_EVENTS.slice(1)];
    const { summary } = await finishWith(
      service(async () => await Promise.resolve(events), 'parent'),
    );
    expect(summary).toContain(`${PARENT_BRIEF_LEAD}\n\n${BRIEF}\n\n`);
    expect(summary).not.toContain('skills');
    expect(summary).not.toContain('a later user message');
  });

  test('takes the brief from a user message that mixes reminders and the brief', async () => {
    const events = [post('user', text('<system-reminder>\nx\n</system-reminder>'), text(BRIEF))];
    const { summary } = await finishWith(
      service(async () => await Promise.resolve(events), 'parent'),
    );
    expect(summary).toBe(`${SUMMARY}\n\n${PARENT_BRIEF_LEAD}\n\n${BRIEF}\n\n${PARENT_NOTE}`);
  });

  test('ignores assistant messages when it looks for the brief', async () => {
    const events = [post('assistant', text('assistant words')), post('user', text(BRIEF))];
    const { summary } = await finishWith(
      service(async () => await Promise.resolve(events), 'parent'),
    );
    expect(summary).toBe(`${SUMMARY}\n\n${PARENT_BRIEF_LEAD}\n\n${BRIEF}\n\n${PARENT_NOTE}`);
  });

  test('a subagent without a brief gets the note alone', async () => {
    const events = [post('user'), post('user', text('<system-reminder>\nx\n</system-reminder>'))];
    const { summary } = await finishWith(
      service(async () => await Promise.resolve(events), 'parent'),
    );
    expect(summary).toBe(`${SUMMARY}\n\n${PARENT_NOTE}`);
  });

  test('a main session summary is returned as stock returns it', async () => {
    let reads = 0;
    const { summary, logged } = await finishWith(
      service(async () => {
        reads += 1;
        return await Promise.resolve(SUBAGENT_EVENTS);
      }),
    );
    expect(summary).toBe(SUMMARY);
    expect(reads).toBe(0);
    expect(logged).toEqual([SUMMARY.length]);
  });

  test('a session that cannot be read leaves the summary unchanged', async () => {
    const { summary } = await finishWith(
      service(async () => await Promise.reject(new Error('disk gone')), 'parent'),
    );
    expect(summary).toBe(SUMMARY);
  });

  test('a session header that cannot be read leaves the summary unchanged', async () => {
    const session: SessionService = {
      getCallingSessionId: () => {
        throw new Error('header gone');
      },
      getAllMessageEvents: async () => await Promise.resolve(SUBAGENT_EVENTS),
    };
    const { summary } = await finishWith(session);
    expect(summary).toBe(SUMMARY);
  });

  test('asks about the session being compacted', async () => {
    const asked: string[] = [];
    await finishWith({
      getCallingSessionId: (sessionId) => {
        asked.push(sessionId);
        return 'parent';
      },
      getAllMessageEvents: async (sessionId) => {
        asked.push(sessionId);
        return await Promise.resolve(SUBAGENT_EVENTS);
      },
    });
    expect(asked).toEqual([SESSION, SESSION]);
  });
});
