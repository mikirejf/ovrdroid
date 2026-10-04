import { describe, expect, test } from 'bun:test';

import { sessionIndexPatches } from '../session-index-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

test('the SQLite-only session index is always on', () => {
  const { replace } = patchNamed(sessionIndexPatches, 'session-index-only');
  expect(payloadFunction<[], () => boolean>([], `${replace};return w0`)()()).toBe(true);
});

interface Visibility {
  airgapEnabled?: boolean;
  activeOrganizationId?: string;
}

interface Row {
  id: number;
}

interface Store {
  listSessions: (visibility: Visibility) => { row: Row }[];
}

interface Database {
  queries: unknown[][];
  version: number;
}

const LIST_SESSIONS = patchNamed(sessionIndexPatches, 'session-list-cache').replace;

function storeOver(database: Database): Store {
  const all = (_sql: string, parameters: unknown[]) => {
    database.queries.push(parameters);
    return [{ id: database.queries.length }];
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
    const database: Database = { queries: [], version: 1 };
    const store = storeOver(database);
    const first = store.listSessions({ activeOrganizationId: 'org' });
    expect(store.listSessions({ activeOrganizationId: 'org' })).toBe(first);
    expect(database.queries).toHaveLength(1);
  });

  test('a change to the index queries again', () => {
    const database: Database = { queries: [], version: 1 };
    const store = storeOver(database);
    const first = store.listSessions({ activeOrganizationId: 'org' });
    database.version = 2;
    expect(store.listSessions({ activeOrganizationId: 'org' })).not.toBe(first);
    expect(database.queries).toHaveLength(2);
  });

  test('another organization or airgap queries again', () => {
    const database: Database = { queries: [], version: 1 };
    const store = storeOver(database);
    store.listSessions({ activeOrganizationId: 'org' });
    store.listSessions({ activeOrganizationId: 'other' });
    store.listSessions({ airgapEnabled: true });
    expect(database.queries).toEqual([['org'], ['other'], []]);
  });
});
