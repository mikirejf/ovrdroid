import type { Command } from 'commander';

import { registerCensusCommand } from './census-command.ts';
import { registerCompactionLiveCommands } from './compaction-live-commands.ts';
import { registerDigestCommands } from './digest-commands.ts';
import { registerExecCommands } from './exec-commands.ts';
import { registerReleaseCommands } from './release-commands.ts';
import { registerRenderCommands } from './render-commands.ts';
import { registerResourceCommands } from './resource-commands.ts';
import { registerSessionCommands } from './session-commands.ts';

export function registerCommands(program: Command): void {
  registerExecCommands(program);
  registerSessionCommands(program);
  registerReleaseCommands(program);
  registerRenderCommands(program);
  registerResourceCommands(program);
  registerCensusCommand(program);
  registerDigestCommands(program);
  registerCompactionLiveCommands(program);
}
