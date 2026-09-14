import config from '@arx1/devkit/linting';
import { defineConfig } from 'oxlint';

export default defineConfig({
  ...config,
  jsPlugins: [...config.jsPlugins, { name: 'no-comments', specifier: '@arx1/devkit/comments' }],
  rules: {
    ...config.rules,
    'no-comments/no-comments': ['error', { ownRepo: 'mikirejf/overdroid' }],
    // Bun maps writable even with { shared: false }, and on macOS a writable mapping
    // permanently invalidates a signed binary: it is SIGKILLed on every later launch.
    'no-restricted-properties': [
      'error',
      {
        object: 'Bun',
        property: 'mmap',
        message: 'Bun.mmap invalidates a signed binary. Read it with readFileSync instead.',
      },
    ],
  },
  overrides: [
    ...config.overrides,
    {
      // A rule setting has nowhere else to carry why it is on, off, or downgraded.
      files: ['*.config.{js,cjs,mjs,ts,mts,cts}'],
      rules: { 'no-comments/no-comments': 'off' },
    },
  ],
});
