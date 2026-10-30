import type { Command } from 'commander';

import { registerCensusCommand } from './census-command.ts';
import { registerCompactionLiveCommands } from './compaction-live-commands.ts';
import { registerDigestCommands } from './digest-commands.ts';
import { registerDroidsViewCommands } from './droids-view-commands.ts';
import { registerExecCommands } from './exec-commands.ts';
import { registerPaintCommands } from './paint-commands.ts';
import { registerReleaseCommands } from './release-commands.ts';
import { registerRenderCommands } from './render-commands.ts';
import { registerResourceCommands } from './resource-commands.ts';
import { registerSessionCommands } from './session-commands.ts';
import { registerToolSurfaceCommands } from './tool-surface-commands.ts';
import { registerTypingCommand } from './typing-command.ts';

export function registerCommands(program: Command): void {
  registerExecCommands(program);
  registerSessionCommands(program);
  registerDroidsViewCommands(program);
  registerReleaseCommands(program);
  registerRenderCommands(program);
  registerResourceCommands(program);
  registerCensusCommand(program);
  registerDigestCommands(program);
  registerCompactionLiveCommands(program);
  registerTypingCommand(program);
  registerToolSurfaceCommands(program);
  registerPaintCommands(program);
}
