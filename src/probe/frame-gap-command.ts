import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { DEFAULT_FRAME_GAP_TIMEOUT_S, frameGap } from './frame-gap.ts';

export function registerFrameGapCommand(program: Command): void {
  program
    .command('frame-gap')
    .description(
      'does the screen stay anchored to the bottom when the frame shrinks: turn ends, a background droid finishes? Also checks that scrollback keeps every reply line once',
    )
    .argument('<binary>')
    .option(
      '--timeout <seconds>',
      'how long to wait for each step',
      count,
      DEFAULT_FRAME_GAP_TIMEOUT_S,
    )
    .action(guard(frameGap));
}
