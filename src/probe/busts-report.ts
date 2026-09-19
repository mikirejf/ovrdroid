import { isoDate, say } from '../cli.ts';
import { OVRDROID_LOGS } from '../paths.ts';
import type { QuotaRate } from './busts.ts';
import { joinBusts, summariseBusts } from './busts.ts';
import { readPreservedLogs } from './logs-report.ts';
import { measuredRate, parseRuns } from './quota.ts';

export const DEFAULT_BUST_SOURCE = OVRDROID_LOGS;

const OPUS_MARK = 'opus';

export interface BustsOptions {
  from: string;
  runs: string;
}

async function readQuotaRate(file: string): Promise<QuotaRate | undefined> {
  const body = await Bun.file(file)
    .text()
    .catch(() => '');
  const rate = measuredRate(parseRuns(body), (model) => model.includes(OPUS_MARK));
  if (rate === undefined) {
    return undefined;
  }
  return {
    tokensPerPercent: rate.tokensPerPercent,
    provenance: `measured ${isoDate(rate.at)} on ${rate.model} over ${rate.sends} sends`,
  };
}

export async function busts(options: BustsOptions): Promise<void> {
  const [{ records, files }, quota] = await Promise.all([
    readPreservedLogs(options.from),
    readQuotaRate(options.runs),
  ]);

  if (files.length === 0) {
    say(`${options.from} holds no preserved log files`);
    say('run probe logs first: it copies them out of rotation before Droid overwrites them');
    return;
  }

  const { joined, unjoinable } = joinBusts(records);
  say(`${options.from}: ${files.length} files, ${records.usage.length} usage lines`);
  say('');
  say(summariseBusts(joined, unjoinable, quota));
}
