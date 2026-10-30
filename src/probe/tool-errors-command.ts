import type { Command } from 'commander';

import { choice, guard } from '../cli.ts';
import {
  DEFAULT_TOOL_ERRORS_DAYS,
  DEFAULT_TOOL_ERRORS_SESSIONS,
  toolErrors,
} from './tool-errors-report.ts';
import { MODES, parseMoment } from './tool-errors.ts';

function moment(raw: string): number {
  return parseMoment(raw, Date.now());
}

export function registerToolErrorsCommand(program: Command): void {
  program
    .command('tool-errors')
    .description(
      'which tool calls failed in past Droid sessions, and why? Per model and tool mode: calls that named a tool the session did not offer ("Not found"), arguments of the wrong type, missing files, files that changed since they were read, and the rest, split into top-level calls and calls made inside a Script, with counts per 1,000 top-level requests and per day. Categories are literal readings of the error text, not a verdict on who caused them',
    )
    .option(
      '--since <date|Nd>',
      `only calls at or after this date such as 2026-10-23, or N days ago such as 7d (default: ${DEFAULT_TOOL_ERRORS_DAYS}d)`,
      moment,
    )
    .option(
      '--until <date|Nd>',
      'only calls before this date (UTC midnight, so adjacent windows do not overlap), or N days ago (default: now)',
      moment,
    )
    .option(
      '--model <substring>',
      "only sessions whose settings model contains this, ignoring case; sessions with no settings file count as model 'unknown'",
    )
    .option('--mode <mode>', 'only sessions in this toolExecutionMode', choice(MODES))
    .option(
      '--tool <name>',
      'only calls to this tool, by the name the model used or by its base name (the part after the last __, minus a lowercase word prefix); requests are then those that called it',
    )
    .option(
      '--sessions <dir>',
      'where Droid keeps its session transcripts',
      DEFAULT_TOOL_ERRORS_SESSIONS,
    )
    .action(guard(toolErrors));
}
