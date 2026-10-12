import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import type { SnapshotCause } from '../../probe/renders.ts';
import {
  ACTIVITY,
  CAUSE_RING,
  FIRST_CAUSE,
  MESSAGE_CAUSES,
  STREAM_CAUSE,
  TYPING_MS,
} from '../render-profile-patches.ts';
import { payloadFunction } from './payload.ts';

interface Causes {
  cause: (store: Store, type: string) => void;
  snapshot: (messages: readonly Message[], store: Store) => void;
  explain: (previous: unknown, next: unknown) => SnapshotCause | undefined;
}

interface SessionManager {
  session: string;
}

interface Activity {
  typed: () => void;
  working: (manager: SessionManager, state: string) => void;
  current: () => string;
}

interface Block {
  type: string;
  text?: string;
}

interface Message {
  id: string;
  content: readonly Block[];
}

class Store {
  version = 0;
  streamingVersion = 0;
  private readonly causes: Causes;

  constructor(causes: Causes) {
    this.causes = causes;
  }

  getVersion(): number {
    return this.version;
  }

  getStreamingVersion(): number {
    return this.streamingVersion;
  }

  notify(type: string): void {
    this.version += 1;
    this.causes.cause(this, type);
  }

  snapshot(messages: readonly Message[]): readonly Message[] {
    const copy = [...messages];
    this.causes.snapshot(copy, this);
    return copy;
  }
}

function newCauses(): Causes {
  return payloadFunction<[], () => Causes>([], `return ${MESSAGE_CAUSES}`)()();
}

function newActivity(): Activity {
  return payloadFunction<[], () => Activity>([], `return ${ACTIVITY}`)()();
}

const HELLO: Message = { id: 'a', content: [{ type: 'text', text: 'hello' }] };
const REPLY: Message = { id: 'b', content: [{ type: 'text', text: 'hi' }] };

describe('what changed the message snapshot', () => {
  test('names every store event since the snapshot before, sorted and joined', () => {
    const causes = newCauses();
    const store = new Store(causes);
    const before = store.snapshot([HELLO]);
    store.notify('todo_list_updated');
    store.notify('metadata_updated');
    store.notify('todo_list_updated');
    const after = store.snapshot([HELLO]);
    expect(causes.explain(before, after)).toEqual(['metadata_updated+todo_list_updated', 1]);
  });

  test('reply text that arrived is a stream delta, even with no store event', () => {
    const causes = newCauses();
    const store = new Store(causes);
    const before = store.snapshot([HELLO]);
    store.streamingVersion += 1;
    const after = store.snapshot([HELLO, REPLY]);
    expect(causes.explain(before, after)).toEqual([STREAM_CAUSE, 0]);
  });

  test('with a message event it skips the sameness check', () => {
    const causes = newCauses();
    const store = new Store(causes);
    const before = store.snapshot([HELLO]);
    store.notify('message_thread_updated');
    expect(causes.explain(before, store.snapshot([HELLO]))).toEqual(['message_thread_updated', 0]);
  });

  test('without a message event, a changed block or message count is not the same', () => {
    const causes = newCauses();
    const store = new Store(causes);
    const before = store.snapshot([HELLO]);
    store.notify('settings_updated');
    const longer = { ...HELLO, content: [{ type: 'text', text: 'hello there' }] };
    expect(causes.explain(before, store.snapshot([longer]))).toEqual(['settings_updated', 0]);
    expect(causes.explain(before, store.snapshot([HELLO, REPLY]))).toEqual(['settings_updated', 0]);
  });

  test('a rebuilt copy with equal ids and equal text lengths counts as the same', () => {
    const causes = newCauses();
    const store = new Store(causes);
    const before = store.snapshot([HELLO]);
    store.notify('working_state_changed');
    const copy = { ...HELLO, content: [{ type: 'text', text: 'HELLO' }] };
    expect(causes.explain(before, store.snapshot([copy]))).toEqual(['working_state_changed', 1]);
  });

  test('a snapshot with no known one before it, or from another store, is a first', () => {
    const causes = newCauses();
    const store = new Store(causes);
    const other = new Store(causes);
    const after = store.snapshot([HELLO]);
    expect(causes.explain([], after)).toEqual([FIRST_CAUSE, 0]);
    expect(causes.explain(other.snapshot([HELLO]), after)).toEqual([FIRST_CAUSE, 0]);
  });

  test('a value that is not a message snapshot is not explained', () => {
    const causes = newCauses();
    expect(causes.explain(1, 2)).toBeUndefined();
  });

  test('events older than the ring are dropped, the newest are kept', () => {
    const causes = newCauses();
    const store = new Store(causes);
    const before = store.snapshot([HELLO]);
    store.notify('mcp_status_changed');
    for (let index = 0; index < CAUSE_RING; index++) {
      store.notify('terminal_output');
    }
    expect(causes.explain(before, store.snapshot([HELLO]))?.[0]).toBe('terminal_output');
  });
});

describe('what Droid was doing at a commit', () => {
  afterEach(() => {
    mock.restore();
  });

  test('a key in the last half second is typing, whatever else is going on', () => {
    const now = spyOn(performance, 'now').mockReturnValue(1000);
    const activity = newActivity();
    activity.working({ session: 'main' }, 'streaming_assistant_message');
    activity.typed();
    now.mockReturnValue(1000 + TYPING_MS - 1);
    expect(activity.current()).toBe('typing');
    now.mockReturnValue(1000 + TYPING_MS);
    expect(activity.current()).toBe('streaming');
  });

  test('streaming wins over a tool, a tool over other work, and nothing busy is idle', () => {
    const activity = newActivity();
    const main = { session: 'main' };
    const subagent = { session: 'subagent' };
    expect(activity.current()).toBe('idle');
    activity.working(main, 'thinking');
    expect(activity.current()).toBe('working');
    activity.working(subagent, 'waiting_for_tool_confirmation');
    expect(activity.current()).toBe('tool');
    activity.working(main, 'streaming_assistant_message');
    expect(activity.current()).toBe('streaming');
    activity.working(main, 'idle');
    activity.working(subagent, 'executing_tool');
    expect(activity.current()).toBe('tool');
    activity.working(subagent, 'idle');
    expect(activity.current()).toBe('idle');
  });
});
