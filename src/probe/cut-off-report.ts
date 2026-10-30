import type { Verdict } from './escape-report.ts';
import type { ServedReply } from './stub-model.ts';
import { STUB_END } from './stub-model.ts';

export interface CutOffReading {
  served: readonly ServedReply[];
  finished: boolean;
}

export function readCutOff(
  served: readonly ServedReply[],
  screens: readonly string[],
): CutOffReading {
  return {
    served: served.filter((kind) => kind !== 'title'),
    finished: screens.some((screen) => screen.includes(STUB_END)),
  };
}

export function cutOffVerdict(reading: CutOffReading): Verdict {
  const { served, finished } = reading;
  const [first] = served;
  if (first === undefined) {
    return {
      pass: false,
      reason: 'Droid never asked the stub model for a reply, so nothing was tested',
    };
  }
  if (first !== 'cut') {
    return {
      pass: false,
      reason: 'the first stream ended cleanly, so this run did not exercise a cut-off reply',
    };
  }
  if (served.length < 2) {
    return {
      pass: false,
      reason: finished
        ? 'Droid asked once and the full reply showed, which the stub never sent'
        : 'Droid asked once and kept the half reply: the stream ended before its terminal event and was not retried',
    };
  }
  if (!finished) {
    return {
      pass: false,
      reason: `Droid asked ${served.length} times but the full reply (ending "${STUB_END}") never showed`,
    };
  }
  return {
    pass: true,
    reason: `the stream ended before its terminal event, Droid asked again (${served.length} requests) and the full reply showed`,
  };
}

export function describeRequests(served: readonly ServedReply[]): string {
  return `the stub received ${served.length} request${served.length === 1 ? '' : 's'}: ${served.join(', ') || 'none'}`;
}
