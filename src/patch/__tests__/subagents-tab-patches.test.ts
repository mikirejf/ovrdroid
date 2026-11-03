import { describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { SUBAGENT_ROWS, SUBAGENT_TAB_ID, subagentsTabPatches } from '../subagents-tab-patches.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';
import { shipped, stockDroid, stockText } from './stock-scanner.ts';

describeStrayNames(subagentsTabPatches);

interface Row {
  id: string;
  title: string;
  modifiedTime: Date;
  isSubagent?: boolean;
  callingSessionId?: string;
  $ODhead?: boolean;
  $ODprefix?: string;
}

type Rows = (shown: Row[], all: Row[], needle: string) => Row[];

const rows = payloadFunction<[], Rows>([], `${SUBAGENT_ROWS};return $ODsubagentRows`)();

function plain(id: string, title: string, hours: number): Row {
  return {
    id,
    title,
    modifiedTime: new Date(Date.UTC(2026, 9, 31, 12) - hours * 3_600_000),
  };
}

function helper(id: string, title: string, hours: number): Row {
  return { ...plain(id, title, hours), isSubagent: true };
}

function under(parent: string, row: Row): Row {
  return { ...row, callingSessionId: parent };
}

function drawn(list: Row[]): string[] {
  return list.map((row) => `${row.$ODhead === true ? '*' : ''}${row.$ODprefix ?? ''}${row.title}`);
}

function view(all: Row[], needle = '', archived: string[] = []): string[] {
  return drawn(
    rows(
      all.filter((row) => row.isSubagent === true && !archived.includes(row.id)),
      all,
      needle,
    ),
  );
}

const PARENT_A = plain('a', 'Delegate A', 5);
const PARENT_B = plain('b', 'Portrait skill', 20);
const CHILD = under('a', helper('a1', 'One', 1));

describe('the Subagents tab draws helpers under their parent', () => {
  test('a head row, then its helpers newest first, the last one closing the branch', () => {
    const all = [
      PARENT_A,
      under('a', helper('a1', 'Older', 4)),
      under('a', helper('a2', 'Newer', 1)),
      under('a', helper('a3', 'Oldest', 6)),
    ];
    expect(view(all)).toEqual([
      '*Delegate A',
      '  \u251C Newer',
      '  \u251C Older',
      '  \u2514 Oldest',
    ]);
  });

  test('the head is flagged, helpers are not', () => {
    const list = rows(
      [under('a', helper('a1', 'One', 1))],
      [PARENT_A, under('a', helper('a1', 'One', 1))],
      '',
    );
    expect(list.map((row) => row.$ODhead === true)).toEqual([true, false]);
  });

  test('groups go newest first by their newest helper, not by the parent', () => {
    const all = [
      PARENT_A,
      PARENT_B,
      under('a', helper('a1', 'A helper', 8)),
      under('b', helper('b1', 'B helper', 2)),
    ];
    expect(view(all)).toEqual([
      '*Portrait skill',
      '  \u2514 B helper',
      '*Delegate A',
      '  \u2514 A helper',
    ]);
  });

  test('a helper of a helper nests one level deeper and a continuing branch draws a bar', () => {
    const all = [
      PARENT_A,
      under('a', helper('a1', 'First', 3)),
      under('a', helper('a2', 'Second', 1)),
      under('a2', helper('x1', 'Deep under second', 0)),
      under('a1', helper('x2', 'Deep under first', 2)),
    ];
    expect(view(all)).toEqual([
      '*Delegate A',
      '  \u251C Second',
      '  \u2502 \u2514 Deep under second',
      '  \u2514 First',
      '    \u2514 Deep under first',
    ]);
  });

  test('a helper whose parent is not loaded is a plain top-level row', () => {
    const all = [under('gone', helper('o1', 'Orphan', 1)), helper('o2', 'No parent id', 2)];
    expect(view(all)).toEqual(['Orphan', 'No parent id']);
  });

  test('an orphan keeps its own helpers under it', () => {
    const all = [under('gone', helper('o1', 'Orphan', 2)), under('o1', helper('o2', 'Child', 1))];
    expect(view(all)).toEqual(['Orphan', '  \u2514 Child']);
  });

  test('an archived helper is not shown, and its helpers attach to the next ancestor', () => {
    const all = [
      PARENT_A,
      under('a', helper('a1', 'Archived middle', 3)),
      under('a1', helper('a2', 'Child of archived', 1)),
    ];
    expect(view(all, '', ['a1'])).toEqual(['*Delegate A', '  \u2514 Child of archived']);
  });

  test('no helpers shows no rows', () => {
    expect(view([PARENT_A])).toEqual([]);
  });

  test('parent ids match whatever their case', () => {
    const all = [PARENT_A, under('A', helper('a1', 'One', 1))];
    expect(view(all)).toEqual(['*Delegate A', '  \u2514 One']);
  });

  test('a head that is the current session still draws as a head', () => {
    const [head] = rows([CHILD], [PARENT_A, CHILD], '');
    expect(head?.id).toBe('a');
    expect(head?.$ODhead).toBe(true);
  });
});

describe('searching the Subagents tab', () => {
  const all = [
    PARENT_A,
    PARENT_B,
    under('a', helper('a1', 'Recon picker', 3)),
    under('a', helper('a2', 'Fetch checklist', 2)),
    under('a2', helper('x1', 'Deep owasp', 1)),
    under('b', helper('b1', 'Other', 4)),
  ];

  test('a title that matches only the parent keeps every helper under it', () => {
    expect(view(all, 'delegate')).toEqual([
      '*Delegate A',
      '  \u251C Fetch checklist',
      '  \u2502 \u2514 Deep owasp',
      '  \u2514 Recon picker',
    ]);
  });

  test('a title that matches only a deep helper keeps the parents needed to draw it', () => {
    expect(view(all, 'owasp')).toEqual([
      '*Delegate A',
      '  \u2514 Fetch checklist',
      '    \u2514 Deep owasp',
    ]);
  });

  test('a helper title that matches leaves its siblings out', () => {
    expect(view(all, 'recon')).toEqual(['*Delegate A', '  \u2514 Recon picker']);
  });

  test('no match shows nothing', () => {
    expect(view(all, 'zzz')).toEqual([]);
  });
});

function helpersLeftOut(text: string): number {
  return text.match(/\.archivedAt&&![\w$]+\.isSubagent\b/gu)?.length ?? 0;
}

describe('the shipped binary', () => {
  const { patchedText, rebasedNamed } = shipped(subagentsTabPatches);

  describe.skipIf(stockDroid === undefined)('applies', () => {
    test.each(subagentsTabPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      expect(applies(rebasedNamed(name))).toBe(true);
    });

    test('the Subagents tab comes last, after Archived', () => {
      expect(patchedText).toMatch(
        new RegExp(
          `labelKey:"sessions.tabs.archived",showPath:!0,filter:\\w+\\},\\{id:"${SUBAGENT_TAB_ID}"`,
          'u',
        ),
      );
    });

    test('every list tab but Favorites and Archived leaves helpers out', () => {
      expect(helpersLeftOut(patchedText) - helpersLeftOut(stockText)).toBe(3);
    });
  });
});
