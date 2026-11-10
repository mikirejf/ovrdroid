import type { Command } from 'commander';

import { registerCutOffCommand } from './cut-off-command.ts';
import { registerEscapeCommand } from './escape-command.ts';
import { registerScopeLeakCommand } from './scope-leak-command.ts';
import { registerSkillCarryCommand } from './skill-carry-command.ts';

export function registerTurnCommands(program: Command): void {
  registerCutOffCommand(program);
  registerEscapeCommand(program);
  registerScopeLeakCommand(program);
  registerSkillCarryCommand(program);
}
