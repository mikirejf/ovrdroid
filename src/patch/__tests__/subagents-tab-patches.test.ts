import { describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { SUBAGENT_ROWS, SUBAGENT_TAB_ID, subagentsTabPatches } from '../subagents-tab-patches.ts';
import { closureOf } from './module-closure.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(subagentsTabPatches);

interface Row {
  id: string;
  title: string;
  modifiedTime: Date;
  isSubagent?: boolean;
  archivedAt?: string;
  callingSessionId?: string;
  $ODhead?: boolean;
}

interface Partition {
  listed: Row[];
  subagentsByCaller: Map<string, Row[]>;
  subagentCounts: Map<string, number>;
}

type Rows = (all: Row[], filter: (row: Row) => boolean, needle: string) => Partition;

const rows = payloadFunction<[], Rows>([], `${SUBAGENT_ROWS};return $ODsubagentRows`)();
const tab = patchNamed(subagentsTabPatches, 'subagent-tab-def');
const filter = payloadFunction<[], Parameters<Rows>[1]>(
  [],
  `return (${tab.replace.split('filter:').at(-1)?.split('}')[0]})`,
)();

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

function view(all: Row[], needle = ''): string[] {
  const { listed, subagentsByCaller } = rows(all, filter, needle);
  return listed.flatMap((row) => {
    const head = `${row.$ODhead === true ? '*' : ''}${row.title}`;
    return [head].concat((subagentsByCaller.get(row.id) ?? []).map((child) => `  ${child.title}`));
  });
}

const PARENT_A = plain('a', 'Delegate A', 5);
const PARENT_B = plain('b', 'Portrait skill', 20);
const CHILD = under('a', helper('a1', 'One', 1));

describe('the Subagents tab draws helpers under their parent', () => {
  test('a head row, then its helpers newest first', () => {
    const all = [
      PARENT_A,
      under('a', helper('a1', 'Older', 4)),
      under('a', helper('a2', 'Newer', 1)),
      under('a', helper('a3', 'Oldest', 6)),
    ];
    expect(view(all)).toEqual(['*Delegate A', '  Newer', '  Older', '  Oldest']);
  });

  test('the head is flagged, helpers are not', () => {
    const { listed, subagentsByCaller } = rows([PARENT_A, CHILD], filter, '');
    expect(listed[0]?.$ODhead).toBe(true);
    expect(subagentsByCaller.get('a')?.[0]?.$ODhead).toBeUndefined();
  });

  test('groups go newest first by their newest helper, not by the parent', () => {
    const all = [
      PARENT_A,
      PARENT_B,
      under('a', helper('a1', 'A helper', 8)),
      under('b', helper('b1', 'B helper', 2)),
    ];
    expect(view(all)).toEqual(['*Portrait skill', '  B helper', '*Delegate A', '  A helper']);
  });

  test('a helper whose parent is not loaded is a plain top-level row', () => {
    const all = [under('gone', helper('o1', 'Orphan', 1)), helper('o2', 'No parent id', 2)];
    expect(view(all)).toEqual(['Orphan', 'No parent id']);
  });

  test('an archived helper is not shown', () => {
    const all = [
      PARENT_A,
      { ...under('a', helper('a1', 'Archived helper', 3)), archivedAt: '2026-10-31' },
      under('a', helper('a2', 'Visible helper', 1)),
    ];
    expect(view(all)).toEqual(['*Delegate A', '  Visible helper']);
  });

  test('no helpers shows no rows', () => {
    expect(view([PARENT_A])).toEqual([]);
  });

  test('parent ids match whatever their case', () => {
    const all = [PARENT_A, under('A', helper('a1', 'One', 1))];
    expect(view(all)).toEqual(['*Delegate A', '  One']);
  });
});

describe('searching the Subagents tab', () => {
  const all = [
    PARENT_A,
    PARENT_B,
    under('a', helper('a1', 'Recon picker', 3)),
    under('a', helper('a2', 'Fetch checklist', 2)),
    under('b', helper('b1', 'Other', 4)),
  ];

  test('a title that matches only the parent keeps every helper under it', () => {
    expect(view(all, 'delegate')).toEqual(['*Delegate A', '  Fetch checklist', '  Recon picker']);
  });

  test('a helper title that matches leaves its siblings out', () => {
    expect(view(all, 'recon')).toEqual(['*Delegate A', '  Recon picker']);
  });

  test('no match shows nothing', () => {
    expect(view(all, 'zzz')).toEqual([]);
  });
});

describe('session picker tab membership', () => {
  const { replace } = patchNamed(subagentsTabPatches, 'subagent-tab-exclude-from-primary-tabs');
  const sourceForTab = payloadFunction<[Row[], string], Row[]>(
    ['g', 'S2'],
    `let A2,T1=new Map,nqe=($ODsessions)=>$ODsessions,UEe=()=>({});${replace}`,
  );

  test.each(['currentFolder', 'all', 'exec'])('%s omits helpers before grouping', (id) => {
    expect(sourceForTab([PARENT_A, CHILD], id)).toEqual([PARENT_A]);
  });

  test.each(['favorites', 'archived'])('%s leaves membership to stock grouping', (id) => {
    expect(sourceForTab([PARENT_A, CHILD], id)).toEqual([PARENT_A, CHILD]);
  });
});

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  const { patchedText, rebasedNamed } = shipped(subagentsTabPatches);

  describe('applies', () => {
    test.each(subagentsTabPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      expect(applies(rebasedNamed(name))).toBe(true);
    });

    test('the Subagents tab comes last, after Archived', () => {
      expect(patchedText).toMatch(
        new RegExp(
          `labelKey:"sessions.tabs.archived",showPath:!0,filter:[\\w$]+\\},\\{id:"${SUBAGENT_TAB_ID}"`,
          'u',
        ),
      );
    });
  });

  test('the picker still flattens the dedicated partition into native branch rows', () => {
    const flattenPattern =
      /function (?<name>[\w$]+)\([\w$]+,\{subagentsByCaller:[\w$]+,subagentCounts:[\w$]+\},[\w$]+\)/u;
    const prefixPattern =
      /function (?<name>[\w$]+)\([\w$]+\)\{let [\w$]+="";for\(let [\w$]+=0;[\w$]+<[\w$]+\.indent;[\w$]+\+\+\)if\([\w$]+\.showConnector/u;
    const source = stockDroid?.find(({ text }) => flattenPattern.test(text))?.text ?? '';
    const flatten = flattenPattern.exec(source)?.groups?.['name'];
    const prefix = prefixPattern.exec(source)?.groups?.['name'];
    if (flatten === undefined || prefix === undefined) {
      throw new Error(
        'the stock picker no longer exposes the branch projection and connector helpers',
      );
    }
    const { replace, renames } = rebasedNamed('subagent-tab-shows-all-matching-branches');
    const renamed = (name: string) => renames[name] ?? name;
    const project = payloadFunction<[Partition, string], string[]>(
      [renamed('c1'), renamed('we')],
      `${closureOf(source, [flatten, prefix])};` +
        `let ${renamed('Y1')}=${renamed('c1')}.listed,${renamed('y')}=($ODdraw)=>$ODdraw(),` +
        `${renamed('p2')}=new Set,${renamed('T2')}=new Set,${renamed('G2')}=Boolean,${replace};` +
        `return ${renamed('a2')}.map(($ODbranch)=>${prefix}($ODbranch)+$ODbranch.session.title)`,
    );
    const partition = rows([PARENT_A, CHILD, under('a', helper('a2', 'Two', 2))], filter, '');
    expect(project(partition, SUBAGENT_TAB_ID)).toEqual(['Delegate A', '├─ One', '└─ Two']);
    expect(project(partition, 'favorites')).toEqual(['Delegate A']);

    const legacyNested = rows([PARENT_A, CHILD, under('a1', helper('a2', 'Two', 2))], filter, '');
    expect(project(legacyNested, SUBAGENT_TAB_ID)).toEqual(['Delegate A', '└─ One', '   └─ Two']);
  });
});
