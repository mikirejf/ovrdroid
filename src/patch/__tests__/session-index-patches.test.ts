import { describe, expect, test } from 'bun:test';

import { PICKER_ROW_FACTOR, sessionIndexPatches } from '../session-index-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

test('the SQLite-only session index is always on', () => {
  const { replace } = patchNamed(sessionIndexPatches, 'session-index-only');
  expect(payloadFunction<[], () => boolean>([], `${replace};return w0`)()()).toBe(true);
});

interface Cap {
  limit: number;
  cwd?: string;
}

interface Visibility {
  airgapEnabled?: boolean;
  activeOrganizationId?: string;
  $ODcap?: Cap;
}

interface Row {
  id: number;
  session_id?: string;
}

interface Store {
  listSessions: (visibility: Visibility) => { row: Row }[];
}

interface Database {
  queries: unknown[][];
  statements: string[];
  version: number;
  answers?: Row[][];
}

const LIST_SESSIONS = patchNamed(sessionIndexPatches, 'session-list-cache').replace;

function storeOver(database: Database): Store {
  const all = (sql: string, parameters: unknown[]) => {
    database.queries.push(parameters);
    database.statements.push(sql);
    return database.answers?.[database.queries.length - 1] ?? [{ id: database.queries.length }];
  };
  return payloadFunction<
    [
      { all: typeof all },
      string,
      (dir: string, row: Row) => { row: Row },
      string,
      () => boolean,
      () => void,
      () => string,
    ],
    Store
  >(['t', 'zn', 'st', 'i', '_', 'o', 'g'], `return{${LIST_SESSIONS}return p}catch(e){throw e}}}`)(
    { all },
    'SELECT',
    (_dir, row) => ({ row }),
    '/sessions',
    () => false,
    () => {},
    () => String(database.version),
  );
}

describe('listSessions reuses its rows until the index changes', () => {
  test('a second call with the same visibility does not query again', () => {
    const database: Database = { queries: [], statements: [], version: 1 };
    const store = storeOver(database);
    const first = store.listSessions({ activeOrganizationId: 'org' });
    expect(store.listSessions({ activeOrganizationId: 'org' })).toBe(first);
    expect(database.queries).toHaveLength(1);
  });

  test('a change to the index queries again', () => {
    const database: Database = { queries: [], statements: [], version: 1 };
    const store = storeOver(database);
    const first = store.listSessions({ activeOrganizationId: 'org' });
    database.version = 2;
    expect(store.listSessions({ activeOrganizationId: 'org' })).not.toBe(first);
    expect(database.queries).toHaveLength(2);
  });

  test('another organization or airgap queries again', () => {
    const database: Database = { queries: [], statements: [], version: 1 };
    const store = storeOver(database);
    store.listSessions({ activeOrganizationId: 'org' });
    store.listSessions({ activeOrganizationId: 'other' });
    store.listSessions({ airgapEnabled: true });
    expect(database.queries).toEqual([['org'], ['other'], []]);
  });
});

const ROW_A: Row = { id: 1, session_id: 'a' };
const ROW_B: Row = { id: 2, session_id: 'b' };
const ROW_C: Row = { id: 3, session_id: 'c' };

describe('a capped listing reads only the newest rows and the current project', () => {
  test('it asks for the newest rows first and the current project second', () => {
    const database: Database = {
      queries: [],
      statements: [],
      version: 1,
      answers: [
        [ROW_A, ROW_B],
        [ROW_B, ROW_C],
      ],
    };
    const rows = storeOver(database).listSessions({
      activeOrganizationId: 'org',
      $ODcap: { limit: 2, cwd: '/work' },
    });
    expect(database.queries).toEqual([
      ['org', 2],
      ['org', '/work'],
    ]);
    expect(database.statements[0]).toContain('ORDER BY modified_time_ms DESC LIMIT ?');
    expect(database.statements[1]).toEndWith('AND cwd = ?');
    expect(rows.map((entry) => entry.row.session_id)).toEqual(['a', 'b', 'c']);
  });

  test('it leaves out empty sessions and ones with no visible message', () => {
    const database: Database = { queries: [], statements: [], version: 1 };
    storeOver(database).listSessions({ $ODcap: { limit: 5 } });
    expect(database.statements[0]).toContain('messages_count > 0');
    expect(database.statements[0]).toContain('has_user_visible_messages != 0');
  });

  test('without a current project it runs one query', () => {
    const database: Database = { queries: [], statements: [], version: 1 };
    storeOver(database).listSessions({ airgapEnabled: true, $ODcap: { limit: 5 } });
    expect(database.queries).toEqual([[5]]);
  });

  test('a capped and an uncapped listing both stay cached', () => {
    const database: Database = { queries: [], statements: [], version: 1 };
    const store = storeOver(database);
    const capped = store.listSessions({ $ODcap: { limit: 5 } });
    const full = store.listSessions({});
    expect(store.listSessions({ $ODcap: { limit: 5 } })).toBe(capped);
    expect(store.listSessions({})).toBe(full);
    expect(database.queries).toHaveLength(2);
  });

  test('an uncapped listing still reads every row', () => {
    const database: Database = { queries: [], statements: [], version: 1 };
    storeOver(database).listSessions({});
    expect(database.statements[0]).not.toContain('LIMIT');
  });
});

describe('the picker passes its row cap down to the store', () => {
  test('getSessionsForSelector asks for a multiple of the rows it keeps', () => {
    expect(patchNamed(sessionIndexPatches, 'session-list-cap-request').replace).toContain(
      `{...o,$ODcap:E4*${PICKER_ROW_FACTOR}}`,
    );
  });

  test('getCachedSessions turns the cap into a limit and the current project', () => {
    const { replace } = patchNamed(sessionIndexPatches, 'session-list-cap-options');
    expect(replace).toContain('$ODcap:t?.$ODcap?{limit:t.$ODcap,cwd:o}:void 0');
  });

  test('the listing hands the cap to the store request', () => {
    expect(patchNamed(sessionIndexPatches, 'session-list-cap-listing').replace).toContain(
      '_t(t,i.$ODcap)',
    );
    expect(patchNamed(sessionIndexPatches, 'session-list-cap-store').replace).toContain(
      'airgapEnabled:o.airgapEnabled===!0,$ODcap}',
    );
  });
});
