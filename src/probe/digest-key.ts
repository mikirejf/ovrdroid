import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_DIGEST_FOLDER = '/Users/andrej/dev/delegation-study/grunt-haiku/digests-haiku';
export const BRIEF_RUNS: readonly number[] = [82, 83, 84];

const TITLE_LINE = /^# Run (?<run>\d+): (?<title>.+)$/mu;
const BRIEF_HEADING = '\n## Brief\n';
const REPORT_HEADING = '\n## Report\n';
const REACTION_HEADING = '\n## Parent reaction (next turns)';
const NOT_FOUND = 'NOT FOUND';
const BROWSER_TITLE = /browser|page|screenshot/iu;
const SENTENCE_END = /\.(?=\s|$)/u;
const PARAGRAPH_END = '\n\n';

export interface RunRef {
  run: number;
  title: string;
}

export interface DigestKey {
  compacted: number;
  mostToolCalls: RunRef & { value: number };
  notFound: RunRef[];
  browserTitles: RunRef[];
  mostOutTokens: { run: number; value: number };
  briefs: { run: number; sentence: string }[];
}

interface Run extends RunRef {
  toolCalls: number;
  outTokens: number;
  compactions: number;
  brief: string;
  report: string;
}

function headerNumber(header: string, name: string, file: string): number {
  const found = new RegExp(`\\b${name}=(?<value>\\d+)`, 'u').exec(header)?.groups?.['value'];
  if (found === undefined) {
    throw new Error(`${file}: header has no ${name}=`);
  }
  return Number(found);
}

export function firstSentence(brief: string): string {
  const paragraph = brief.trimStart().split(PARAGRAPH_END)[0] ?? '';
  const end = SENTENCE_END.exec(paragraph);
  return (end === null ? paragraph : paragraph.slice(0, end.index + 1)).trim();
}

export function parseRun(text: string, file: string): Run {
  const title = TITLE_LINE.exec(text)?.groups;
  const briefStart = text.indexOf(BRIEF_HEADING);
  const reactionStart = text.indexOf(REACTION_HEADING);
  const reportStart = text.lastIndexOf(REPORT_HEADING, reactionStart);
  if (
    title === undefined ||
    briefStart === -1 ||
    reactionStart === -1 ||
    reportStart < briefStart
  ) {
    throw new Error(`${file}: not a run digest`);
  }
  const header = text.slice(0, briefStart);
  return {
    run: Number(title['run']),
    title: title['title'] ?? '',
    toolCalls: headerNumber(header, 'toolCalls', file),
    outTokens: headerNumber(header, 'outTokens', file),
    compactions: headerNumber(header, 'compactions', file),
    brief: text.slice(briefStart + BRIEF_HEADING.length, reportStart),
    report: text.slice(reportStart + REPORT_HEADING.length, reactionStart).trim(),
  };
}

function highest(runs: readonly Run[], field: 'toolCalls' | 'outTokens'): Run {
  const [best] = runs.toSorted((a, b) => b[field] - a[field]);
  if (best === undefined) {
    throw new Error('no run digests');
  }
  return best;
}

export function digestKey(texts: ReadonlyMap<string, string>): DigestKey {
  const runs = [...texts].map(([file, text]) => parseRun(text, file));
  const mostToolCalls = highest(runs, 'toolCalls');
  const mostOutTokens = highest(runs, 'outTokens');
  return {
    compacted: runs.filter((run) => run.compactions > 0).length,
    mostToolCalls: {
      run: mostToolCalls.run,
      title: mostToolCalls.title,
      value: mostToolCalls.toolCalls,
    },
    notFound: runs
      .filter((run) => run.report === NOT_FOUND)
      .map(({ run, title }) => ({ run, title })),
    browserTitles: runs
      .filter((run) => BROWSER_TITLE.test(run.title))
      .map(({ run, title }) => ({ run, title })),
    mostOutTokens: { run: mostOutTokens.run, value: mostOutTokens.outTokens },
    briefs: BRIEF_RUNS.map((run) => {
      const found = runs.find((candidate) => candidate.run === run);
      if (found === undefined) {
        throw new Error(`run ${run} is not in the folder`);
      }
      return { run, sentence: firstSentence(found.brief) };
    }),
  };
}

export function readDigestFolder(folder: string): Map<string, string> {
  const files = readdirSync(folder)
    .filter((name) => /^\d+-.*\.md$/u.test(name))
    .toSorted();
  return new Map(files.map((name) => [name, readFileSync(path.join(folder, name), 'utf-8')]));
}

function listRuns(runs: readonly RunRef[]): string {
  return runs.length === 0
    ? '  none'
    : runs.map(({ run, title }) => `  ${run}  ${title}`).join('\n');
}

export function describeKey(key: DigestKey): string {
  const { mostToolCalls, mostOutTokens } = key;
  return [
    `1. runs with compactions > 0: ${key.compacted}`,
    `2. most toolCalls: run ${mostToolCalls.run}, ${mostToolCalls.title}, ${mostToolCalls.value}`,
    `3. Report is exactly NOT FOUND:\n${listRuns(key.notFound)}`,
    `4. title mentions browser, page or screenshot:\n${listRuns(key.browserTitles)}`,
    `5. most outTokens: run ${mostOutTokens.run}, ${mostOutTokens.value}`,
    `6. first sentence of the Brief:\n${key.briefs.map(({ run, sentence }) => `  ${run}  ${sentence}`).join('\n')}`,
  ].join('\n');
}
