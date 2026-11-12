import { writeFileSync } from 'node:fs';

import { say } from '../cli.ts';
import { anyFailed, describeVerdicts } from './busy-signal-report.ts';
import { imageLinksVerdicts } from './image-links-report.ts';
import { captureImageLinks } from './image-links.ts';

export async function imageLinks(binary: string, options: { dump?: string }): Promise<void> {
  say(
    'Local stub only: checking the actual prompt and clickable image-file rendering, not model adherence.',
  );
  const evidence = await captureImageLinks(binary);
  if (options.dump !== undefined) {
    writeFileSync(`${options.dump}.json`, JSON.stringify(evidence, null, 2));
  }
  const verdicts = imageLinksVerdicts(evidence);
  say(describeVerdicts(verdicts));
  if (anyFailed(verdicts)) {
    process.exitCode = 1;
  }
}
