import type { Command } from 'commander';

import { registerDenylistCommand } from './denylist.ts';
import { registerDotenvLeakCommand } from './dotenv-leak.ts';
import { registerPaintCommand } from './paint.ts';
import { registerStackedCommand } from './stacked.ts';
import { registerStaleEditCommand } from './stale-edit.ts';
import { registerTypingStartCommand } from './typing-start-command.ts';

export function registerPaintCommands(program: Command): void {
  registerPaintCommand(program);
  registerDenylistCommand(program);
  registerStaleEditCommand(program);
  registerStackedCommand(program);
  registerTypingStartCommand(program);
  registerDotenvLeakCommand(program);
}
