import { PROBE_MODEL } from './launch.ts';

export const DIGEST_READER = 'ovrdroid-digest-reader';

export const DIGEST_READER_FILE = [
  '---',
  `name: ${DIGEST_READER}`,
  'description: Reads the digest files for the ovrdroid digest-run probe and answers questions about them.',
  `model: ${PROBE_MODEL}`,
  'reasoningEffort: medium',
  '---',
  'Do the task your prompt gives you, exactly as it says. Your parent reads only your final reply, so the final reply carries every finding, including the ones from before a compaction.',
  '',
].join('\n');

export const DIGEST_PARENT_PROMPT = [
  `Call the Task tool exactly once, with subagent_type "${DIGEST_READER}", description "Digests read test", and as its prompt the text after the line PROMPT below, word for word. Do no other work and call no other tool. When the subagent returns, reply with its reply word for word.`,
  '',
  'PROMPT',
  '',
  'Read-only lookup. Do not edit any file outside /tmp.',
  '',
  'Folder: /Users/andrej/dev/delegation-study/grunt-haiku/digests-haiku/ (84 files, 01-*.md to 84-*.md). List the folder once to learn the file names. Then read every file in full with the Read tool, one file per call, in number order, so that the whole text of each file comes back to you. Do not use grep, rg, sed, head, or any code that parses, filters, or summarises the files: the point is to read each file yourself and answer from what you read.',
  '',
  'Answer all six items:',
  '',
  '1. How many of the 84 runs have `compactions=` greater than 0 in their header line?',
  '2. Which run has the highest `toolCalls=` value? Give its number, title, and the value.',
  '3. List every run whose `## Report` section is exactly `NOT FOUND`, by number and title, or say none.',
  '4. List every run whose title mentions a browser, a page, or a screenshot, by number and title.',
  '5. Which run has the highest `outTokens=` value? Give its number and the value.',
  '6. For runs 82, 83, and 84: quote the first sentence of the `## Brief` section of each.',
  '',
  'Report each item under its own number.',
].join('\n');
