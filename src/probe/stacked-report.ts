export const TALLY = 'Read 2 files · Grep 1 search · Execute 2 commands, 1 failed';
export const TAIL_TALLY = 'Read 1 file';
export const TURN_REQUESTS = 8;
export const OLD_LINE = 'first-old-line';
export const NEW_LINE = 'first-new-line';
export const EDIT_FILE = 'a.txt';

export interface StackedCapture {
  served: number;
  screen: readonly string[];
  midRun?: readonly string[];
}

export interface Finding {
  pass: boolean;
  says: string;
}

interface Chain {
  text: string;
  start: number;
  end: number;
}

const TOOLS = '[A-Z][A-Za-z]+';
const NOUNS = 'other calls?|files?|searches|search|patterns?|directories|directory|URLs?|commands?';
const SEGMENT = `${TOOLS} \\d+ (?:${NOUNS})(?:, \\d+ failed)?`;
const CHAIN = new RegExp(`${SEGMENT}(?: · ${SEGMENT})*`, 'gu');
const STATS_LINE = /↳[^+]*\+\d+\D*-\d+/u;
const EDIT_STATS = /↳[^+]*\+1\b\D*-1\b/u;
const SUBTITLE_MARK = '↳';
const EXECUTE_HEADER = /\bExecute\s+(?:true|false)\b/u;
const EDIT_HEADER = new RegExp(`\\bEdit\\s+\\S*${EDIT_FILE.replace('.', '\\.')}`, 'gu');
const LATEST_CALL = /^\s*↳\s+false(?:\s|$)/u;

function flatten(lines: readonly string[]): string {
  return lines.join(' ').replaceAll(/\s+/gu, ' ');
}

function chainsIn(text: string): Chain[] {
  return [...text.matchAll(CHAIN)].map((hit) => ({
    text: hit[0],
    start: hit.index,
    end: hit.index + hit[0].length,
  }));
}

function offsetsOf(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((hit) => hit.index);
}

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

function count(total: number, thing: string): string {
  return `${total} ${thing}${total === 1 ? '' : 's'}`;
}

function readTally(chains: readonly Chain[], editAt: number): Finding {
  const before = chains.filter((chain) => chain.start < editAt && chain.text === TALLY);
  if (before.length === 1) {
    return { pass: true, says: 'the reads, the grep and both commands share one line' };
  }
  const found = chains.filter((chain) => chain.start < editAt).map((chain) => chain.text);
  return {
    pass: false,
    says:
      before.length === 0
        ? `no single line before the Edit reads '${TALLY}'; lines before the Edit that look like a tally: ${found.length === 0 ? 'none' : quoted(found)}`
        : `the full line '${TALLY}' appears ${count(before.length, 'time')} before the Edit, not once`,
  };
}

interface EditReading {
  finding: Finding;
  at: number;
}

function readEdit(text: string, lines: readonly string[]): EditReading {
  const headers = offsetsOf(text, EDIT_HEADER);
  const stats = lines.filter((line) => EDIT_STATS.test(line)).length;
  const old = text.split(OLD_LINE).length - 1;
  const fresh = text.split(NEW_LINE).length - 1;
  const [at = -1] = headers;
  const pass = headers.length === 1 && stats === 1 && old === 1 && fresh === 1;
  return {
    at,
    finding: pass
      ? { pass, says: 'the Edit shows once, inline, with its ↳ +1 -1 stats line and its diff' }
      : {
          pass,
          says: `the Edit block should show once with a ↳ line carrying +1 and -1 and its diff, but scrollback has ${count(headers.length, 'Edit header')}, ${count(stats, 'stats line')}, ${count(old, 'copy')} of the removed line and ${count(fresh, 'copy')} of the added line`,
        },
  };
}

function readAfterEdit(chains: readonly Chain[], editAt: number): Finding {
  const after = chains.filter((chain) => chain.start > editAt).map((chain) => chain.text);
  if (after.length === 1 && after[0] === TAIL_TALLY) {
    return { pass: true, says: `after the Edit, '${TAIL_TALLY}' starts a new line once` };
  }
  return {
    pass: false,
    says: `after the Edit scrollback should hold '${TAIL_TALLY}' once, and holds ${after.length === 0 ? 'no tally line' : quoted(after)}`,
  };
}

function readSubtitles(lines: readonly string[]): Finding {
  const left = lines
    .filter((line) => line.includes(SUBTITLE_MARK) && !STATS_LINE.test(line))
    .map((line) => line.trim());
  return left.length === 0
    ? { pass: true, says: 'no ↳ subtitle line outlives the run' }
    : {
        pass: false,
        says: `a ↳ subtitle line is still on screen after the turn ended: ${quoted(left)}`,
      };
}

function readExecuteBlocks(lines: readonly string[]): Finding {
  const blocks = lines.filter((line) => EXECUTE_HEADER.test(line)).map((line) => line.trim());
  return blocks.length === 0
    ? { pass: true, says: 'no Execute call is drawn as its own block' }
    : {
        pass: false,
        says: `Execute is drawn as its own block, with a header: ${quoted(blocks)}`,
      };
}

function readPartials(chains: readonly Chain[], editAt: number): Finding {
  const stale = chains
    .filter((chain) => chain.text !== TALLY && !(chain.start > editAt && chain.text === TAIL_TALLY))
    .map((chain) => chain.text);
  return stale.length === 0
    ? { pass: true, says: 'scrollback holds no stale partial copy of the line' }
    : {
        pass: false,
        says: `scrollback holds a stale partial copy of the line: ${quoted(stale)}`,
      };
}

export function readMidRun(frame: readonly string[]): Finding[] {
  const text = flatten(frame);
  const chains = chainsIn(text);
  const [last] = chains.slice(-1);
  if (last === undefined || last.text !== TALLY) {
    return [
      {
        pass: false,
        says: `mid-run, with the second command the latest call, the tally line should read '${TALLY}', and the frame shows ${chains.length === 0 ? 'no tally line' : quoted(chains.map((chain) => chain.text))}`,
      },
    ];
  }
  const subtitled = LATEST_CALL.test(text.slice(last.end).trimStart());
  return [
    chains.length === 1
      ? { pass: true, says: 'mid-run, the tally line shows the counts so far, once' }
      : {
          pass: false,
          says: `mid-run, the frame holds ${count(chains.length, 'tally line')}: ${quoted(chains.map((chain) => chain.text))}`,
        },
    subtitled
      ? { pass: true, says: "mid-run, '↳ false' sits under the tally line as the latest call" }
      : {
          pass: false,
          says: "mid-run, no '↳ false' line follows the tally line, though the second command is the latest call",
        },
  ];
}

function readCapture(capture: StackedCapture): Finding[] {
  const lines = capture.screen;
  const text = flatten(lines);
  const chains = chainsIn(text);
  const edit = readEdit(text, lines);
  const editAt = edit.at === -1 ? text.length : edit.at;
  return [
    readTally(chains, editAt),
    edit.finding,
    readAfterEdit(chains, editAt),
    readSubtitles(lines),
    readExecuteBlocks(lines),
    readPartials(chains, editAt),
  ];
}

export function readStacked(capture: StackedCapture): Finding[] {
  if (capture.served < TURN_REQUESTS) {
    return [
      {
        pass: false,
        says: `the turn never ran, so nothing was tested: the stub model answered ${capture.served} of ${TURN_REQUESTS} requests`,
      },
    ];
  }
  return [
    ...readCapture(capture),
    ...(capture.midRun === undefined
      ? [{ pass: false, says: 'no mid-run frame was captured, so the growing line was not tested' }]
      : readMidRun(capture.midRun)),
  ];
}

export function describeFindings(findings: readonly Finding[]): string {
  return findings.map((finding) => `${finding.pass ? 'ok  ' : 'FAIL'}  ${finding.says}`).join('\n');
}
