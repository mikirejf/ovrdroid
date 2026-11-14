import { describe, expect, test } from 'bun:test';

import { WARM_MESSAGE_ID_PREFIX } from '../../patch/warmer-patches.ts';
import type { BodyRow, JsonObject } from '../bodies.ts';
import { compareBodies } from '../bodies.ts';
import type { SwitchOutcomes, TurnUsage } from '../effort-switch-verdict.ts';
import {
  bodyRecord,
  findRequests,
  switchRuling,
  switchVerdict,
  turnLines,
  turnUsage,
} from '../effort-switch-verdict.ts';
import type { UsageLine } from '../logs.ts';

const MODEL = 'custom:droidproxy:sonnet-5-5';
const CONTROL_END = '2026-10-15T10:00:20.000Z';
const CONTROL_END_MS = Date.parse(CONTROL_END);

function turn(cacheRead: number, cacheWrite: number): TurnUsage {
  return { input: 3, cacheRead, cacheWrite };
}

function controlBody(): JsonObject {
  return {
    model: 'm',
    tools: [{ name: 'Read' }],
    system: [{ type: 'text', text: 'be brief' }],
    messages: [{ role: 'user', content: 'say two' }],
    output_config: { effort: 'high' },
  };
}

function switchedBody(changes: JsonObject = {}): JsonObject {
  return {
    ...controlBody(),
    messages: [
      { role: 'user', content: 'say two' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'say three' },
    ],
    output_config: { effort: 'medium' },
    ...changes,
  };
}

function row(t: number, body: JsonObject, assistantMessageId = 'msg'): BodyRow {
  return { t, sessionId: 's', assistantMessageId, route: 'anthropic', body };
}

function compared(switched: JsonObject = switchedBody()) {
  return compareBodies(controlBody(), switched);
}

function outcomes(overrides: Partial<SwitchOutcomes> = {}): SwitchOutcomes {
  return {
    efforts: { seed: 'high', control: 'high', switched: 'medium' },
    seed: turn(13_594, 10_015),
    seedCacheRead: 13_594,
    control: turn(20_965, 2666),
    switched: turn(23_631, 23),
    busts: [],
    body: compared(),
    ...overrides,
  };
}

function usageLine(modelId: string, at: string, cacheRead = 0): UsageLine {
  return {
    kind: 'usage',
    at,
    sessionId: 's',
    modelId,
    version: '0.242.0',
    subagent: false,
    attempt: 1,
    reason: 'stop',
    inputTokens: 3,
    cacheReadInputTokens: cacheRead,
    totalInputTokens: cacheRead + 3,
    reasoningTokens: 0,
    outputTokens: 5,
    cachedTokensWritten: 7,
  };
}

describe('switchRuling reads the request bodies and the cache numbers', () => {
  test('the usual history pattern is kept and carries no note', () => {
    const ruling = switchRuling(outcomes());
    expect(ruling.kind).toBe('kept');
    expect(ruling.text.split('\n')).toEqual([
      'switching effort from "high" to "medium" did not bust the cache: the switched request extended the control request with only the effort changed',
      'control turn read 20,965 and wrote 2,666; switched turn read 23,631 and wrote 23',
    ]);
  });

  test('a loss outside the request is kept, and says Droid is not the cause', () => {
    const shifted = outcomes({
      seed: turn(13_594, 9991),
      control: turn(23_585, 94),
      switched: turn(20_941, 2765),
    });
    const ruling = switchRuling(shifted);
    expect(ruling.kind).toBe('kept');
    expect(ruling.text.split('\n')[2]).toBe(
      "the switched turn read 20,941 of the 23,679 the control turn had cached: Droid's request extended the previous one unchanged, so the 2,765 tokens it re-wrote were lost outside Droid's request. In most runs the same one-time loss lands on the control turn",
    );
  });

  test('a cold seed is kept but says the dropped-conversation check could not run', () => {
    const cold = outcomes({
      seed: turn(20_000, 4000),
      seedCacheRead: 0,
      control: turn(21_814, 2744),
    });
    const ruling = switchRuling({ ...cold, switched: turn(24_558, 25) });
    expect(ruling.kind).toBe('kept');
    expect(ruling.text.split('\n').at(-1)).toBe(
      "the seed turn's first request read nothing from the cache (a cold start), so the check that the switched turn read the conversation could not run",
    );
  });

  test('a request that changed an earlier message is busted and names where', () => {
    const edited = switchedBody({
      messages: [
        { role: 'user', content: 'say TWO' },
        { role: 'assistant', content: 'two' },
      ],
    });
    const ruling = switchRuling(outcomes({ body: compared(edited) }));
    expect(ruling.kind).toBe('busted');
    expect(ruling.text).toContain(
      'the switched request does not extend the control request: it changed messages[0] (user item), at messages[0].content;',
    );
    expect(ruling.text).toContain('say two');
    expect(ruling.text).toContain('say TWO');
  });

  test('a setting other than the effort changing is busted and lists it', () => {
    const ruling = switchRuling(outcomes({ body: compared(switchedBody({ temperature: 0.5 })) }));
    expect(ruling.kind).toBe('busted');
    expect(ruling.text).toContain(
      'the switched request changed a setting besides the effort (output_config): temperature',
    );
  });

  test('the effort alone changing in output_config is not a bust', () => {
    expect(compared().settings).toEqual(['output_config']);
    expect(switchRuling(outcomes()).kind).toBe('kept');
  });

  test('a not-append-only warning on the switched turn is busted and says what Droid saw', () => {
    const warned = outcomes({
      busts: [{ turn: 'switched', region: 'tools', kind: 'removed', index: 2 }],
    });
    const ruling = switchRuling(warned);
    expect(ruling.kind).toBe('busted');
    expect(ruling.text).toContain(
      'Droid warned on the switched turn that the request was not append-only: mismatch in tools, kind removed, first at index 2',
    );
  });

  test('a warning on the output_config segment alone is the effort itself and is kept', () => {
    const effortOnly = outcomes({
      busts: [{ turn: 'switched', region: 'output_config', kind: 'segment_changed', index: 0 }],
    });
    const ruling = switchRuling(effortOnly);
    expect(ruling.kind).toBe('kept');
    expect(ruling.text.split('\n').at(-1)).toBe(
      'Droid flagged its output_config segment as changed on the switched turn: that segment is the effort itself, and the request bodies show nothing else changed',
    );
    expect(switchVerdict(effortOnly)).toBe(ruling.text);
  });

  test('an output_config warning beside another change still busts', () => {
    const both = outcomes({
      body: compared(switchedBody({ temperature: 0.5 })),
      busts: [{ turn: 'switched', region: 'output_config', kind: 'segment_changed', index: 0 }],
    });
    const ruling = switchRuling(both);
    expect(ruling.kind).toBe('busted');
    expect(ruling.text).not.toContain('mismatch in output_config');
  });

  test('a warning on an earlier turn does not bust the switch', () => {
    const earlier = outcomes({
      busts: [{ turn: 'seed', region: 'tools', kind: 'removed', index: 2 }],
    });
    expect(switchRuling(earlier).kind).toBe('kept');
  });

  test('a seed tool round-trip does not make a partially cached conversation look busted', () => {
    const requests = [
      { ...usageLine(MODEL, 't1', 14_603), reason: 'tool_use' },
      usageLine(MODEL, 't2', 26_144),
    ];
    const { first, last } = turnLines(requests, MODEL, 'seed');
    const measured = outcomes({
      seed: turnUsage(last),
      seedCacheRead: first.cacheReadInputTokens,
      control: turn(26_238, 25),
      switched: turn(22_657, 3631),
    });
    expect(measured.seed.cacheRead).toBe(26_144);
    expect(measured.seedCacheRead).toBe(14_603);
    const ruling = switchRuling(measured);
    expect(ruling.kind).toBe('kept');
    expect(ruling.text).not.toContain('read none of the conversation');
    expect(ruling.text).toContain(
      'control turn read 26,238 and wrote 25; switched turn read 22,657 and wrote 3,631',
    );
  });

  test('a switched turn that read no more than the first seed request lost the conversation', () => {
    const dropped = outcomes({
      seed: turn(13_594, 10_015),
      control: turn(20_965, 2666),
      switched: turn(13_594, 10_037),
    });
    const ruling = switchRuling(dropped);
    expect(ruling.kind).toBe('busted');
    expect(ruling.text).toContain(
      "the switched turn read none of the conversation from the cache: it read 13,594, no more than the 13,594 the seed turn's first request read",
    );
  });

  test('every reason shows, one per line', () => {
    const everything = outcomes({
      body: compared(
        switchedBody({ temperature: 0.5, messages: [{ role: 'user', content: 'x' }] }),
      ),
      busts: [{ turn: 'switched', region: 'tools', kind: 'removed', index: 2 }],
      switched: turn(100, 24_000),
    });
    const lines = switchRuling(everything).text.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('switching effort from "high" to "medium" busted the cache:');
  });

  test('no request pair is undecided and says how to get one', () => {
    const ruling = switchRuling({ ...outcomes(), body: undefined });
    expect(ruling.kind).toBe('undecided');
    expect(ruling.text).toContain('probe build --bodies');
    expect(ruling.text).toContain('$OD_BODIES');
  });

  test('efforts that did not change are undecided, whatever the bodies say', () => {
    const stuck = outcomes({ efforts: { seed: 'high', control: 'high', switched: 'high' } });
    const ruling = switchRuling(stuck);
    expect(ruling.kind).toBe('undecided');
    expect(ruling.text).toBe(
      'the effort did not change as intended: the seed turn ran at "high", the control turn at "high", the switched turn at "high", so the run cannot judge the switch',
    );
  });

  test('a seed and control at different efforts are undecided', () => {
    const drifted = outcomes({ efforts: { seed: 'medium', control: 'high', switched: 'low' } });
    expect(switchRuling(drifted).text).toContain(
      'the seed turn ran at "medium", the control turn at "high", the switched turn at "low"',
    );
    expect(switchRuling(drifted).kind).toBe('undecided');
  });

  test('the efforts in the ruling are the transcript values', () => {
    const low = outcomes({ efforts: { seed: 'xhigh', control: 'xhigh', switched: 'low' } });
    expect(switchRuling(low).text).toContain('from "xhigh" to "low"');
  });
});

describe('switchVerdict lists every warning once', () => {
  test('a switched-turn warning already in the ruling is not repeated', () => {
    const warned = outcomes({
      busts: [{ turn: 'switched', region: 'system', kind: 'content-changed', index: 4 }],
    });
    const lines = switchVerdict(warned).split('\n');
    expect(lines.filter((line) => line.includes('not append-only'))).toHaveLength(1);
  });

  test('a warning on an earlier turn follows the ruling', () => {
    const earlier = outcomes({
      busts: [{ turn: 'seed', region: 'tools', kind: 'removed', index: 2 }],
    });
    const lines = switchVerdict(earlier).split('\n');
    expect(lines.at(-1)).toBe(
      'Droid warned on the seed turn that the request was not append-only: mismatch in tools, kind removed, first at index 2',
    );
  });

  test('a warning still shows when the run cannot judge the switch', () => {
    const stuck = outcomes({
      efforts: { seed: 'high', control: 'high', switched: 'high' },
      busts: [{ turn: 'switched', region: 'tools', kind: 'removed', index: 2 }],
    });
    expect(switchVerdict(stuck).split('\n')).toHaveLength(2);
  });
});

describe('findRequests picks the control request and the one after it', () => {
  const control = row(CONTROL_END_MS - 5000, controlBody());
  const switched = row(CONTROL_END_MS + 8000, switchedBody());

  test('the control is the last request at or before the control turn ended', () => {
    const seed = row(CONTROL_END_MS - 20_000, controlBody());
    expect(findRequests([seed, control, switched], CONTROL_END)).toEqual({ control, switched });
  });

  test('a request at the very moment the control turn ended is the control', () => {
    const atEnd = row(CONTROL_END_MS, controlBody());
    expect(findRequests([control, atEnd, switched], CONTROL_END)?.control).toBe(atEnd);
  });

  test('one-shot and warm rows are skipped on both sides', () => {
    const oneShot = row(CONTROL_END_MS - 1000, controlBody(), 'oneshot-title');
    const warm = row(CONTROL_END_MS + 1000, controlBody(), `${WARM_MESSAGE_ID_PREFIX}1`);
    expect(findRequests([control, oneShot, warm, switched], CONTROL_END)).toEqual({
      control,
      switched,
    });
  });

  test('no request after the control turn means no pair', () => {
    expect(findRequests([control], CONTROL_END)).toBeUndefined();
  });

  test('no request at or before the control turn means no pair', () => {
    expect(findRequests([switched], CONTROL_END)).toBeUndefined();
  });

  test('an empty bodies file means no pair', () => {
    expect(findRequests([], CONTROL_END)).toBeUndefined();
  });
});

describe('bodyRecord writes what the bodies showed', () => {
  test('an extending request with only the effort changed', () => {
    expect(bodyRecord(compared())).toEqual({ extends: true, settings: ['output_config'] });
  });

  test('a request that changed the prompt', () => {
    const edited = switchedBody({ messages: [{ role: 'user', content: 'x' }] });
    expect(bodyRecord(compared(edited))?.extends).toBe(false);
  });

  test('no pair writes null', () => {
    expect(bodyRecord()).toBeNull();
  });
});

describe('turnLines keeps the initial request and the turn completion separate', () => {
  test('it takes the first and last lines logged by the session model', () => {
    const first = usageLine(MODEL, 't1', 10);
    const last = usageLine(MODEL, 't2', 20);
    expect(turnLines([first, last], MODEL, 'seed')).toEqual({ first, last });
  });

  test('it skips lines from another model', () => {
    const line = usageLine(MODEL, 't1', 10);
    const added = [usageLine('other-model', 't0', 99), line, usageLine('other-model', 't2', 99)];
    expect(turnLines(added, MODEL, 'seed')).toEqual({ first: line, last: line });
  });

  test('it throws and names the models logged when none matches', () => {
    expect(() => turnLines([usageLine('other-model', 't1')], MODEL, 'control')).toThrow(
      `the control turn logged no usage line for ${MODEL}; models logged: other-model`,
    );
  });

  test('turnUsage maps the log fields to read, write and input', () => {
    expect(turnUsage(usageLine(MODEL, 't1', 50))).toEqual({
      input: 3,
      cacheRead: 50,
      cacheWrite: 7,
    });
  });
});
