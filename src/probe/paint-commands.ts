import type { Command } from 'commander';

import { registerDenylistCommand } from './denylist.ts';
import { registerPaintCommand } from './paint.ts';
import { registerTypingStartCommand } from './typing-start-command.ts';

export function registerPaintCommands(program: Command): void {
  registerPaintCommand(program);
  registerDenylistCommand(program);
  registerTypingStartCommand(program);
}
