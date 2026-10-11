import type { Command } from 'commander';

import { registerExecCommands } from './exec-commands.ts';
import { registerReleaseCommands } from './release-commands.ts';
import { registerRenderCommands } from './render-commands.ts';
import { registerSessionCommands } from './session-commands.ts';

export function registerCommands(program: Command): void {
  registerExecCommands(program);
  registerSessionCommands(program);
  registerReleaseCommands(program);
  registerRenderCommands(program);
}
