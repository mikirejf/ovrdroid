import type { Command } from 'commander';

import { registerRosterViewCommand } from './roster-view-command.ts';
import { registerSubagentInputCommand } from './subagent-input-command.ts';

export function registerDroidsViewCommands(program: Command): void {
  registerRosterViewCommand(program);
  registerSubagentInputCommand(program);
}
