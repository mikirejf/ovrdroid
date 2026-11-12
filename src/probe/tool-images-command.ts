import { writeFileSync } from 'node:fs';

import { say } from '../cli.ts';
import { anyFailed, describeVerdicts } from './busy-signal-report.ts';
import { toolImagesVerdicts } from './tool-images-report.ts';
import { captureToolImages } from './tool-images.ts';

export async function toolImages(binary: string, options: { dump?: string }): Promise<void> {
  say(
    'Local stub only: real Read and Script image results, inlineImages on/off/inherited, graphics and file links.',
  );
  const evidence = await captureToolImages(binary);
  if (options.dump !== undefined) {
    writeFileSync(`${options.dump}.json`, JSON.stringify(evidence, null, 2));
  }
  const verdicts = toolImagesVerdicts(evidence);
  say(describeVerdicts(verdicts));
  if (anyFailed(verdicts)) {
    process.exitCode = 1;
  }
}
