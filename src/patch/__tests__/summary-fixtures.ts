export const ADAPTIVE_STORED = [
  '## Role and assignment',
  '',
  'I am a `coder-medium` subagent. My parent asked me to fix the retry delay in `src/net/retry.ts`',
  'and to leave `src/net/client.ts` alone.',
  '',
  '## Session context',
  '',
  '- Repo `/work/example`, branch `fix/retry-delay`.',
  '- Read `retry.ts` and its test; the delay doubles from the second attempt, not the first.',
  '',
  '## Current state',
  '',
  '- `retry.ts` now starts the delay at 100ms. The test for the first attempt passes.',
  '- Two other tests in `retry.test.ts` still fail on the jitter bounds.',
  '',
  '## Remaining work',
  '',
  'Fix the jitter bounds, run `bun test src/net`, then report the diff to the parent.',
].join('\n');

export const ADAPTIVE_TAGGED = `<summary>\n${ADAPTIVE_STORED}\n</summary>`;

export const STORED_REFUSAL =
  "I won't write that summary. I'm still working on the grunt task, so here is where it stands.\n\nRuns 01 to 59 are read. Notes are saved in `/tmp/grunt-briefs/notes.md` through run 56. Next I'm reading run 60.";

export const STORED_REFUSAL_WITH_HEADINGS = [
  "I won't write out a summary of the session. The recon is done, so here is the report.",
  '',
  '## Findings',
  '',
  'The tick loop lives in `server/tick.ts`.',
  '',
  '## Open questions',
  '',
  'None.',
  '',
  '## Files read',
  '',
  '- `server/tick.ts`',
].join('\n');
