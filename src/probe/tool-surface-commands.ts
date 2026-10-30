import type { Command } from 'commander';

import { registerTaskAbCommands } from './task-ab-command.ts';
import { registerToolErrorsCommand } from './tool-errors-command.ts';
import { registerToolSurfaceCommand } from './tool-surface.ts';

export function registerToolSurfaceCommands(program: Command): void {
  registerToolSurfaceCommand(program);
  registerToolErrorsCommand(program);
  registerTaskAbCommands(program);
}
