import { existsSync, readFileSync } from 'node:fs';

import type { Command } from 'commander';

import { guard, say } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { describeGrade, gradeReply } from './digest-grade.ts';
import { DEFAULT_DIGEST_FOLDER, describeKey, digestKey, readDigestFolder } from './digest-key.ts';
import { finalReply, transcriptFileOf } from './live-transcript.ts';

const TRANSCRIPT_SUFFIX = '.jsonl';

interface DigestGradeOptions {
  folder: string;
}

function transcriptReply(file: string): string {
  const reply = finalReply(readFileSync(file, 'utf-8'));
  if (reply === '') {
    throw new Error(`transcript ${file} has no assistant text`);
  }
  return reply;
}

function replyText(source: string): string {
  if (existsSync(source)) {
    return source.endsWith(TRANSCRIPT_SUFFIX)
      ? transcriptReply(source)
      : readFileSync(source, 'utf-8');
  }
  const transcript = transcriptFileOf(source);
  if (transcript === undefined) {
    throw new Error(`${source} is neither a file nor a session id under ${FACTORY_SESSIONS}`);
  }
  return transcriptReply(transcript);
}

function digestGrade(source: string, options: DigestGradeOptions): void {
  const key = digestKey(readDigestFolder(options.folder));
  say(describeKey(key));
  say('');
  say(describeGrade(gradeReply(key, replyText(source))));
}

export function registerDigestCommands(program: Command): void {
  program
    .command('digest-grade')
    .description(
      'compute the answer key for the 84-file digest task from the files, and grade a helper reply against it',
    )
    .argument(
      '<reply>',
      'a file holding the reply text, a saved .jsonl transcript, or a Droid session id',
    )
    .option('--folder <dir>', 'folder holding the digest files', DEFAULT_DIGEST_FOLDER)
    .action(guard(digestGrade));
}
