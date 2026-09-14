import config from '@arx1/devkit/dead-code';
import { defineConfig } from 'knip/config';

export default defineConfig({
  ...config,
  entry: ['src/index.ts', 'src/hooks/hook-execute.ts', 'src/hooks/hook-notify.ts'],
});
