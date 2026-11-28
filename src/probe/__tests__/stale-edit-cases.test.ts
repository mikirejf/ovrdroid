import { describe, expect, test } from 'bun:test';

import type { Observed, StaleCase, ToolResult } from '../stale-edit-cases.ts';
import {
  caseVerdict,
  describeVerdicts,
  INITIAL,
  outcomeOf,
  plannedResultsIn,
  staleEditCases,
  toolNamesIn,
  toolResultsIn,
  turnsOf,
} from '../stale-edit-cases.ts';

const FILE = '/scratch/target.txt';
const CHANGED = 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 40\n';

function caseNamed(start: string): StaleCase {
  const found = staleEditCases().find((entry) => entry.what.startsWith(start));
  if (found === undefined) {
    throw new TypeError(`no case starts with ${start}`);
  }
  return found;
}

const TOLERATED_CASE = caseNamed('an outside change elsewhere');
const REFUSED_CASE = caseNamed('an outside change removed');
const PARALLEL_CASE = caseNamed('two Edits');
const SCRIPT_CASE = caseNamed('an Edit made inside a Script');
const FOLLOW_UP_CASE = caseNamed('a second Edit');

function idOf(turn: number): string {
  return `call${turn}`;
}

function observe(results: Record<string, ToolResult>, extra: Partial<Observed> = {}): Observed {
  return {
    results: new Map(Object.entries(results)),
    outsideWrites: 1,
    finalText: TOLERATED_CASE.final,
    offered: ['Read', 'Edit', 'Script'],
    ...extra,
  };
}

const SUCCESS = `The file ${FILE} has been updated successfully.`;
const WARNING =
  "This file's modification time changed after you last read it, so its contents may differ from that Read. old_str still matched exactly once in the current contents, so the edit was applied there. Read the file again before an edit that depends on its other contents.";
const APPLIED: ToolResult = { text: SUCCESS, isError: false };
const NOTED: ToolResult = {
  text: `${SUCCESS}\n\n<system-reminder>${WARNING}</system-reminder>`,
  isError: false,
};
const REFUSED: ToolResult = {
  text: `Error: File "${FILE}" has been modified externally since it was last read. Please use the Read tool to get the latest version before editing.`,
  isError: true,
};
const NOT_FOUND: ToolResult = {
  text: 'Error: The text to replace was not found in the file. Please ensure the old_str parameter matches the exact text in the file, including whitespace and line breaks.',
  isError: true,
};
const SCRIPT_STATUS =
  '[Script completed · 0.1 s elapsed · 1 call · log: /scratch/call_de7ffbfb92ac4905_0.log]';
const SCRIPT_CONTENT = [
  { type: 'text', text: `EDIT-REPLY ${SUCCESS}` },
  {
    type: 'text',
    text: `<system-reminder>\nNested results this Script received carried guidance for you, not the program:\nr2 Edit target.txt: ${WARNING}\n</system-reminder>`,
  },
  { type: 'text', text: SCRIPT_STATUS },
];

describe('plannedResultsIn', () => {
  test('uses echoed call inputs and rewritten IDs to join parallel results', () => {
    const planned = turnsOf(PARALLEL_CASE, FILE, idOf)[1]?.calls ?? [];
    const body = {
      messages: [
        { role: 'user', content: 'Edit the file.' },
        {
          role: 'assistant',
          content: planned.map((call, index) => ({
            ...call,
            type: 'tool_use',
            id: `call_df4350f45a527fec_${index}`,
          })),
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_df4350f45a527fec_1',
              content: REFUSED.text,
              is_error: true,
            },
            { type: 'tool_result', tool_use_id: 'unrelated', content: 'ignored' },
            {
              type: 'tool_result',
              tool_use_id: 'call_df4350f45a527fec_0',
              content: NOTED.text,
            },
          ],
        },
      ],
    };
    expect(plannedResultsIn(body, planned)).toEqual(
      new Map([
        ['call1_0', NOTED],
        ['call1_1', REFUSED],
      ]),
    );
  });

  test('reads the Script result with its nested Edit warning in a separate text block', () => {
    const turns = turnsOf(SCRIPT_CASE, FILE, idOf);
    const planned = turns[1]?.calls ?? [];
    const id = 'call_de7ffbfb92ac4905_0';
    const body = {
      messages: [
        {
          role: 'assistant',
          content: planned.map((call) => ({ ...call, type: 'tool_use', id })),
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: SCRIPT_CONTENT }],
        },
      ],
    };
    const results = plannedResultsIn(body, planned);
    expect(results.get('call1')).toEqual({
      text: SCRIPT_CONTENT.map((block) => block.text).join('\n'),
      isError: false,
    });
    expect(caseVerdict(SCRIPT_CASE, turns, observe(Object.fromEntries(results))).pass).toBe(true);
  });

  test('a result with no matching call is ignored', () => {
    const body = {
      messages: [
        { content: [{ type: 'tool_result', tool_use_id: 'call_1', content: APPLIED.text }] },
      ],
    };
    expect(plannedResultsIn(body, turnsOf(TOLERATED_CASE, FILE, idOf)[1]?.calls ?? []).size).toBe(
      0,
    );
  });
});

describe('toolResultsIn', () => {
  test('a body with no messages has no results', () => {
    expect(toolResultsIn({ model: 'x' }).size).toBe(0);
  });
});

describe('toolNamesIn', () => {
  test('lists the tools the request offers', () => {
    expect(toolNamesIn({ tools: [{ name: 'Read' }, { name: 'Edit' }] })).toEqual(['Read', 'Edit']);
  });

  test('a request without tools offers none, like the title request', () => {
    expect(toolNamesIn({ messages: [] })).toEqual([]);
  });
});

describe('outcomeOf', () => {
  test.each([
    ['no result', undefined],
    ['refused-stale', REFUSED],
    ['tolerated', NOTED],
    ['applied', APPLIED],
    ['failed', NOT_FOUND],
    ['failed', { text: SCRIPT_STATUS, isError: false }],
  ] as const)('%s', (outcome, result) => {
    expect(outcomeOf(result)).toBe(outcome);
  });

  test('a Script whose nested Edit threw is failed', () => {
    expect(outcomeOf({ text: `EDIT-FAILED ${NOT_FOUND.text}`, isError: false })).toBe('failed');
  });

  test('a Script whose nested Edit was refused is refused', () => {
    expect(outcomeOf({ text: `EDIT-FAILED ${REFUSED.text}`, isError: false })).toBe(
      'refused-stale',
    );
  });
});

describe('turnsOf', () => {
  test('reads first, then edits after the outside change', () => {
    const turns = turnsOf(TOLERATED_CASE, FILE, idOf);
    expect(turns.map((turn) => turn.calls.map((call) => call.name))).toEqual([['Read'], ['Edit']]);
    expect(turns[1]?.outside).toBe(CHANGED);
    expect(turns[0]?.outside).toBeUndefined();
    expect(turns[1]?.calls[0]?.input).toEqual({
      file_path: FILE,
      old_str: 'alpha = 1',
      new_str: 'alpha = 10',
    });
  });

  test('two Edits of one step go out in one message under separate ids', () => {
    const [, edits] = turnsOf(PARALLEL_CASE, FILE, idOf);
    expect(edits?.calls.map((call) => call.id)).toEqual(['call1_0', 'call1_1']);
    expect(edits?.editCallIds).toEqual(['call1_0', 'call1_1']);
  });

  test('a Script case reads and edits through Script calls whose code names the file', () => {
    const turns = turnsOf(SCRIPT_CASE, FILE, idOf);
    expect(turns.map((turn) => turn.calls.map((call) => call.name))).toEqual([
      ['Script'],
      ['Script'],
    ]);
    expect(turns[0]?.calls[0]?.input['script']).toContain('tools.Read');
    expect(turns[1]?.calls[0]?.input['script']).toContain('tools.Edit');
    expect(turns[1]?.calls[0]?.input['script']).toContain(FILE);
  });

  test('the step after a tolerated one has no outside change', () => {
    const turns = turnsOf(FOLLOW_UP_CASE, FILE, idOf);
    expect(turns[2]?.outside).toBeUndefined();
  });
});

describe('caseVerdict', () => {
  const turns = turnsOf(TOLERATED_CASE, FILE, idOf);

  test('a tolerated edit with the note and the merged file passes', () => {
    expect(caseVerdict(TOLERATED_CASE, turns, observe({ call1_0: NOTED })).pass).toBe(true);
  });

  test('the stale refusal on an edit that was safe is the bug, and says so', () => {
    const verdict = caseVerdict(
      TOLERATED_CASE,
      turns,
      observe({ call1_0: REFUSED }, { finalText: CHANGED }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('although old_str still matched once');
  });

  test('an edit that applied with no note and no refusal was not exercised', () => {
    const verdict = caseVerdict(TOLERATED_CASE, turns, observe({ call1_0: APPLIED }));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('not exercised');
  });

  test('no outside change means not exercised, whatever else was seen', () => {
    const verdict = caseVerdict(
      TOLERATED_CASE,
      turns,
      observe({ call1_0: NOTED }, { outsideWrites: 0 }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('not exercised: the file was changed from outside 0 of 1 times');
  });

  test('a missing Edit result is not exercised', () => {
    const verdict = caseVerdict(TOLERATED_CASE, turns, observe({}));
    expect(verdict.text).toContain('Droid never reported a result');
  });

  test('a refused case passes on the stale refusal with the outside file untouched', () => {
    const refusedTurns = turnsOf(REFUSED_CASE, FILE, idOf);
    const verdict = caseVerdict(
      REFUSED_CASE,
      refusedTurns,
      observe({ call1_0: REFUSED }, { finalText: REFUSED_CASE.final }),
    );
    expect(verdict.pass).toBe(true);
  });

  test('a refused case that failed for another reason did not reach the stale branch', () => {
    const refusedTurns = turnsOf(REFUSED_CASE, FILE, idOf);
    const verdict = caseVerdict(
      REFUSED_CASE,
      refusedTurns,
      observe({ call1_0: NOT_FOUND }, { finalText: REFUSED_CASE.final }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('not exercised');
  });

  test('a refused case that applied the edit fails', () => {
    const refusedTurns = turnsOf(REFUSED_CASE, FILE, idOf);
    const verdict = caseVerdict(
      REFUSED_CASE,
      refusedTurns,
      observe({ call1_0: NOTED }, { finalText: TOLERATED_CASE.final }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('should refuse');
  });

  test('parallel edits need both to land and at least one to carry the note', () => {
    const parallel = turnsOf(PARALLEL_CASE, FILE, idOf);
    const landed = observe(
      { call1_0: NOTED, call1_1: APPLIED },
      { finalText: PARALLEL_CASE.final },
    );
    expect(caseVerdict(PARALLEL_CASE, parallel, landed).pass).toBe(true);

    const noNote = observe(
      { call1_0: APPLIED, call1_1: APPLIED },
      { finalText: PARALLEL_CASE.final },
    );
    expect(caseVerdict(PARALLEL_CASE, parallel, noNote).pass).toBe(false);
  });

  test('a lost parallel edit shows in the final file', () => {
    const parallel = turnsOf(PARALLEL_CASE, FILE, idOf);
    const lost = observe(
      { call1_0: NOTED, call1_1: NOTED },
      { finalText: 'alpha = 10\nbeta = 2\ngamma = 3\ndelta = 40\n' },
    );
    const verdict = caseVerdict(PARALLEL_CASE, parallel, lost);
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('the final file is');
  });

  test('a Script case fails as not exercised when Droid never offered Script', () => {
    const scriptTurns = turnsOf(SCRIPT_CASE, FILE, idOf);
    const verdict = caseVerdict(
      SCRIPT_CASE,
      scriptTurns,
      observe({ call1: NOTED }, { offered: ['Read', 'Edit'] }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('did not offer the Script tool');
  });

  test('a second edit that carries the note again fails', () => {
    const followUp = turnsOf(FOLLOW_UP_CASE, FILE, idOf);
    const verdict = caseVerdict(
      FOLLOW_UP_CASE,
      followUp,
      observe({ call1_0: NOTED, call2_0: NOTED }, { finalText: FOLLOW_UP_CASE.final }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('although nothing changed since the last Edit');
  });
});

describe('describeVerdicts', () => {
  test('marks each line ok or FAIL', () => {
    expect(
      describeVerdicts([
        { pass: true, text: 'one' },
        { pass: false, text: 'two' },
      ]),
    ).toBe('ok    one\nFAIL  two');
  });
});

describe('staleEditCases', () => {
  test('start from the one file every case reads and every outside change keeps its first line', () => {
    expect(INITIAL).toContain('alpha = 1');
    for (const staleCase of staleEditCases()) {
      for (const step of staleCase.steps) {
        expect(step.outside === undefined || step.outside !== INITIAL).toBe(true);
      }
    }
  });
});
