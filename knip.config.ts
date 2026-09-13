import config from '@arx1/devkit/dead-code';
import { defineConfig } from 'knip/config';

export default defineConfig({
  ...config,
  entry: ['src/index.ts', 'src/hook-execute.ts', 'src/hook-notify.ts'],
});
