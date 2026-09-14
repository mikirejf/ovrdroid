#!/usr/bin/env bun
import { Command } from 'commander';

import { modules, trace } from './capture-report.ts';
import { count, guard } from './cli.ts';
import { cpu } from './cpu-report.ts';
import { DEFAULT_CHARS, DEFAULT_GAP_MS, DEFAULT_TRIALS } from './keys.ts';
import { backupPath, INSTALLED_DROID } from './paths.ts';
import { buildProbe } from './probe-build.ts';
import { ab, keys } from './speed-report.ts';

const DEFAULT_STOCK = backupPath(INSTALLED_DROID);
const AB_RUNS = 30;
const KEYS_RUNS = 3;
const TOP_MODULES = 20;

const program = new Command().name('probe').description('Startup probe tooling for Droid');

program
  .command('build')
  .description('build a probe binary from the stock one')
  .option('-t, --target <path>', 'stock binary to patch', DEFAULT_STOCK)
  .option('-e, --extra <patches.json>', 'extra patches to include')
  .option('--trace', 'include the tracing patches')
  .option('--modules', 'include the module timing patches')
  .option('--dev-react', "keep React's development build for full DevTools diagnostics", false)
  .requiredOption('-o, --out <path>', 'where to write the built binary')
  .action(guard(buildProbe));

program
  .command('trace')
  .description('run a traced binary and print its startup timeline')
  .argument('<binary>')
  .option('-r, --runs <n>', 'number of runs', count, 1)
  .action(guard(trace));

program
  .command('modules')
  .description('run a module-timed binary and print the costliest module bodies')
  .argument('<binary>')
  .option('-n, --top <n>', 'how many modules to print', count, TOP_MODULES)
  .action(guard(modules));

program
  .command('ab')
  .description('interleaved A/B of paint time across binaries')
  .argument('<binaries...>')
  .option('-r, --runs <n>', 'number of runs', count, AB_RUNS)
  .action(guard(ab));

program
  .command('keys')
  .description('interleaved A/B of keystroke echo latency and typing lag across binaries')
  .argument('<binaries...>')
  .option('-r, --runs <n>', 'number of runs', count, KEYS_RUNS)
  .option('-n, --trials <n>', 'keypresses timed per run', count, DEFAULT_TRIALS)
  .option('-c, --chars <n>', 'keys in the sustained burst', count, DEFAULT_CHARS)
  .option('-g, --gap <ms>', 'gap between burst keys', count, DEFAULT_GAP_MS)
  .action(guard(keys));

program
  .command('cpu')
  .description('record a CPU profile of startup and print the costliest self-time')
  .argument('<binary>')
  .requiredOption('-o, --out <dir>', 'where to write the profile')
  .action(guard(cpu));

await program.parseAsync();
