import type { Command } from 'commander';

import { registerDeferredLoadCommand } from './deferred-load.ts';
import { registerTaskAbCommands } from './task-ab-command.ts';
import { registerToolErrorsCommand } from './tool-errors-command.ts';
import { registerToolSurfaceCommand } from './tool-surface.ts';

export function registerToolSurfaceCommands(program: Command): void {
  registerToolSurfaceCommand(program);
  registerToolErrorsCommand(program);
  registerTaskAbCommands(program);
  registerDeferredLoadCommand(program);
}
