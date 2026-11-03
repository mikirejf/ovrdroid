import type { Command } from 'commander';

import { registerHistoryPreviewCommand } from './history-preview-command.ts';
import { registerRosterViewCommand } from './roster-view-command.ts';
import { registerSubagentInputCommand } from './subagent-input-command.ts';

export function registerDroidsViewCommands(program: Command): void {
  registerHistoryPreviewCommand(program);
  registerRosterViewCommand(program);
  registerSubagentInputCommand(program);
}
