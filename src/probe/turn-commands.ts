import type { Command } from 'commander';

import { registerEscapeCommand } from './escape-command.ts';
import { registerScopeLeakCommand } from './scope-leak-command.ts';

export function registerTurnCommands(program: Command): void {
  registerEscapeCommand(program);
  registerScopeLeakCommand(program);
}
