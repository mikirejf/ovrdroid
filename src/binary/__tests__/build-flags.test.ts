import { describe, expect, test } from 'bun:test';

import { BUILD_FLAGS } from '../build-flags.ts';

describe('BUILD_FLAGS', () => {
  test('keeps the launch directory .env files out of the environment Droid hands its children', () => {
    expect(BUILD_FLAGS).toContain('--no-compile-autoload-dotenv');
  });

  test('keeps the launch directory bunfig.toml from reconfiguring the runtime', () => {
    expect(BUILD_FLAGS).toContain('--no-compile-autoload-bunfig');
  });

  test('starts the runtime with the same execArgv as the stock binary', () => {
    expect(BUILD_FLAGS).toContain('--compile-exec-argv=--use-system-ca');
  });
});
