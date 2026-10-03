import { afterEach, describe, expect, test } from 'bun:test';

import {
  ASK_ID_PREFIX,
  compactionPatches,
  REUSE_GLOBAL,
  SUMMARIZE_LINE,
} from '../compaction-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Block {
  type: string;
  text: string;
  cache_control?: { type: string };
}

interface Message {
  id: string;
  role: string;
  content: Block[];
}

interface Snapshot {
  preparedHistory: Message[];
  odExtend: (ask: Message) => Message[];
}

type Extension = Message[] | string;

interface Published {
  snapshot: (sessionId: string) => Snapshot | undefined;
  send: () => string;
  extend: (snapshot: Snapshot, unseen: readonly Message[], text: string) => Extension;
}

const EXPORTS = patchNamed(compactionPatches, 'compaction-reuse-exports').replace;
const EXTENDER = patchNamed(compactionPatches, 'compaction-reuse-extender').replace;
const INSTRUCTION = `You are the summarizer.\n\n${SUMMARIZE_LINE}`;
const BREAKPOINT = { type: 'ephemeral' };

function textMessage(id: string, role = 'user', text = id): Message {
  return { id, role, content: [{ type: 'text', text }] };
}

function cachedMessage(id: string): Message {
  return { id, role: 'user', content: [{ type: 'text', text: id, cache_control: BREAKPOINT }] };
}

function withoutBreakpoints(message: Message): Message {
  return { ...message, content: message.content.map(({ type, text }) => ({ type, text })) };
}

const LAST_REPLY = textMessage('last-reply', 'assistant');

function publish(): Published {
  return payloadFunction<[], Published>(
    [],
    `var zh=new Map,eN=240000;function Jte(){return"sender"}${EXPORTS}return globalThis.${REUSE_GLOBAL}`,
  )();
}

interface Rebuild {
  asks: Message[];
  snapshot: Snapshot;
}

function rebuildingSnapshot(build: (ask: Message) => Message[]): Rebuild {
  const asks: Message[] = [];
  return {
    asks,
    snapshot: {
      preparedHistory: [cachedMessage('turn-1'), cachedMessage('turn-2')],
      odExtend: (ask) => {
        asks.push(ask);
        return build(ask);
      },
    },
  };
}

function nextRequest(ask: Message): Message[] {
  return [
    cachedMessage('turn-1'),
    textMessage('turn-2'),
    LAST_REPLY,
    { ...ask, content: ask.content.map((block) => ({ ...block, cache_control: BREAKPOINT })) },
  ];
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, REUSE_GLOBAL);
});

describe('compaction-reuse-exports', () => {
  test('publishes the snapshot reader and the one-shot sender', () => {
    const published = publish();
    expect(published.snapshot('none')).toBeUndefined();
    expect(published.send()).toBe('sender');
  });

  test('extends the snapshot history with every message the snapshot missed', () => {
    const { asks, snapshot } = rebuildingSnapshot(nextRequest);
    const history = publish().extend(snapshot, [LAST_REPLY], INSTRUCTION);
    expect(history).toEqual([...snapshot.preparedHistory, LAST_REPLY]);
    expect(Array.isArray(history) && history[1]).toBe(snapshot.preparedHistory[1]);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.role).toBe('user');
    expect(asks[0]?.id.startsWith(ASK_ID_PREFIX)).toBe(true);
    expect(asks[0]?.content).toEqual([{ type: 'text', text: INSTRUCTION }]);
  });

  test('accepts a rebuilt prefix that differs from the snapshot only in cache breakpoints', () => {
    const { snapshot } = rebuildingSnapshot((ask) => [
      ...nextRequest(ask)
        .slice(0, 2)
        .map((message) => withoutBreakpoints(message)),
      ...nextRequest(ask).slice(2),
    ]);
    expect(publish().extend(snapshot, [LAST_REPLY], INSTRUCTION)).toEqual([
      ...snapshot.preparedHistory,
      LAST_REPLY,
    ]);
  });

  test('refuses a rebuilt prefix whose content differs from the snapshot', () => {
    const { snapshot } = rebuildingSnapshot((ask) => [
      cachedMessage('turn-1'),
      textMessage('turn-2', 'user', 'turn-2 with an image dropped'),
      ...nextRequest(ask).slice(2),
    ]);
    expect(publish().extend(snapshot, [LAST_REPLY], INSTRUCTION)).toBe('prefix-mismatch');
  });

  test('refuses a rebuild that is not longer than the snapshot', () => {
    const { snapshot } = rebuildingSnapshot((ask) => [cachedMessage('turn-1'), ask]);
    expect(publish().extend(snapshot, [LAST_REPLY], INSTRUCTION)).toBe('prefix-mismatch');
  });

  test('refuses a rebuild that does not end with the summary request', () => {
    const { snapshot } = rebuildingSnapshot((ask) => nextRequest(ask).slice(0, 3));
    expect(publish().extend(snapshot, [LAST_REPLY], INSTRUCTION)).toBe('prefix-mismatch');
  });

  test('refuses a rebuild that leaves out a message the snapshot missed', () => {
    const { snapshot } = rebuildingSnapshot(nextRequest);
    const dropped = textMessage('interrupted-tool-result');
    expect(publish().extend(snapshot, [LAST_REPLY, dropped], INSTRUCTION)).toBe('unseen-messages');
  });
});

interface Conversion {
  rawHistory: Message[];
  lastSummary: string;
  reminders: string[];
}

interface Converted {
  converted: Conversion;
}

interface Prepared {
  prepared: Converted;
}

interface LoopState {
  llmCore: { prepareMessagesWithCaching: (messages: Converted) => Prepared };
  params: { getConversationHistory: () => Message[] };
  lastSummaryRef: string;
}

interface Stored {
  sessionId: string;
  odExtend: (ask: Message) => Prepared;
}

describe('compaction-reuse-extender', () => {
  test('rebuilds the next request from the live history with the reminders and summary of the snapshot', () => {
    const history = [textMessage('turn-1')];
    const loop: LoopState = {
      llmCore: { prepareMessagesWithCaching: (messages) => ({ prepared: messages }) },
      params: { getConversationHistory: () => history },
      lastSummaryRef: 'summary at snapshot',
    };
    const stored: Stored[] = [];
    const capture = payloadFunction<unknown[], Stored>(
      ['un', 'Rt', 'qo', 'bt', 'DJ'],
      `let jn={sessionId:"s",${EXTENDER}return jn`,
    );
    const snapshot = capture.call(
      loop,
      (input: Conversion): Converted => ({ converted: input }),
      'tool catalog',
      'spec reminder',
      'todo reminder',
      (entry: Stored) => {
        stored.push(entry);
      },
    );

    expect(stored).toEqual([snapshot]);
    loop.lastSummaryRef = 'summary written later';
    history.push(LAST_REPLY);
    const ask = textMessage('ask');
    expect(snapshot.odExtend(ask)).toEqual({
      prepared: {
        converted: {
          rawHistory: [textMessage('turn-1'), LAST_REPLY, ask],
          lastSummary: 'summary at snapshot',
          reminders: ['tool catalog', 'spec reminder', 'todo reminder'],
        },
      },
    });
  });
});
