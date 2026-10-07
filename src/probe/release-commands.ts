import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { hooks } from './hooks.ts';
import { anchors, builds, extract, grep, hub, names } from './release-report.ts';

const CONTEXT_SPAN = 200;

export function registerReleaseCommands(program: Command): void {
  program
    .command('extract')
    .description('write every app module of a binary to a directory, one file each, for grepping')
    .argument('<binary>')
    .requiredOption('-o, --out <dir>', 'where to write the modules')
    .action(guard(extract));

  program
    .command('anchors')
    .description('re-find every patch anchor in a new Droid release by identifier shape')
    .argument('<binary>')
    .option('--json', 'print the rebased patches as JSON', false)
    .action(guard(anchors));

  program
    .command('builds')
    .description(
      'does the patch set apply to the newest Droid release on every platform we support? Run it before pushing a patch change',
    )
    .option('--version <v>', 'release to check instead of the newest one')
    .action(guard(builds));

  program
    .command('grep')
    .description('count where a literal occurs across the app: can it anchor a patch on its own?')
    .argument('<binary>')
    .argument('<needle>')
    .option('-s, --span <chars>', 'characters of surrounding code to print', count, CONTEXT_SPAN)
    .option('-q, --quiet', 'print only the verdict, not the surrounding code', false)
    .action(guard(grep));

  program
    .command('hub')
    .description(
      'is the MCP hub test fixture still stock code, names aside? For each method upstream changed, show the change and the new method in fixture names',
    )
    .argument('<binary>', 'a stock build: a .orig backup or a probe builds download')
    .action(guard(hub));

  program
    .command('names')
    .description('resolve the free names a patch body uses, in the module its anchor sits in')
    .argument('<binary>')
    .argument('<anchor>')
    .argument('<names...>')
    .action(guard(names));

  program
    .command('hooks')
    .description(
      'which minified name is which React hook (useState, useEffect, …)? With an anchor, the names the module it sits in uses',
    )
    .argument('<binary>')
    .argument('[anchor]')
    .action(guard(hooks));
}
