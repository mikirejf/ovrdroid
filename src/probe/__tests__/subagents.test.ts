import { describe, expect, test } from 'bun:test';

import type { HeapRow } from '../heap.ts';
import type { Tick } from '../sampler.ts';
import { median } from '../series.ts';
import { formatCpu } from '../subagents-cpu.ts';
import {
  chooseType,
  DONE_WORD,
  formatRun,
  hasSettled,
  isFinished,
  objectText,
  parseDroidName,
  perSubagent,
  readHeapPhases,
  readRun,
  subagentPrompt,
} from '../subagents.ts';

const MB = 1024;

interface TickOptions {
  rssMb: number;
  cpuMs: number;
  threads?: number;
  footprintMb?: number;
}

function tick(atMs: number, options: TickOptions): Tick {
  return {
    atMs,
    root: 1,
    threads: options.threads ?? 20,
    processes: [
      {
        pid: 1,
        ppid: 0,
        cpuMs: options.cpuMs,
        rssKib: options.rssMb * MB,
        command: 'droid',
        ...(options.footprintMb !== undefined && { footprintKib: options.footprintMb * MB }),
      },
    ],
  };
}

const SEND = 20_000;
const DONE = 50_000;

function cpuRate(at: number): number {
  if (at >= SEND && at < SEND + 10_000) {
    return 900;
  }
  return at >= SEND + 10_000 && at < DONE ? 300 : 100;
}

function rssAt(at: number): number {
  if (at >= SEND && at < SEND + 10_000) {
    return 800;
  }
  if (at >= SEND + 10_000 && at < DONE) {
    return 500;
  }
  return at >= DONE ? 440 : 300;
}

function steadyTicks(): Tick[] {
  const ticks: Tick[] = [];
  let cpuMs = 0;
  for (let at = 0; at <= 90_000; at += 1000) {
    const running = at >= SEND + 10_000 && at < DONE;
    cpuMs += at === 0 ? 0 : cpuRate(at - 1000);
    ticks.push(
      tick(at, {
        rssMb: rssAt(at),
        cpuMs,
        threads: running ? 28 : 20,
        ...(at % 10_000 === 0 && { footprintMb: rssAt(at) - 100 }),
      }),
    );
  }
  return ticks;
}

describe('subagentPrompt asks for parallel Task calls', () => {
  const prompt = subagentPrompt({ count: 4, work: 'sleep', sleep: 30, files: [], type: 'grunt' });

  test('it states the count, the sleep and the type', () => {
    expect(prompt).toContain('exactly 4 Task tool calls');
    expect(prompt).toContain('`sleep 30`');
    expect(prompt).toContain('subagent_type "grunt"');
  });

  test('it asks for one message so the calls run in parallel', () => {
    expect(prompt).toContain('in ONE message');
  });

  test('the finish word is spelled out, so the echo of the prompt never matches', () => {
    expect(isFinished(prompt)).toBe(false);
    expect(DONE_WORD).toBe('ALLDONE');
  });
});

describe('subagentPrompt in read mode names the files and asks for a summary', () => {
  const files = ['/repo/src/a.ts', '/repo/src/b.ts'];
  const prompt = subagentPrompt({ count: 2, work: 'read', sleep: 0, files, type: 'grunt' });

  test('every subagent gets the same files, to read in full with the Read tool', () => {
    expect(prompt).toContain(
      'Use the Read tool to read these files in full: /repo/src/a.ts, /repo/src/b.ts.',
    );
  });

  test('it asks for a 150-word summary and then DONE', () => {
    expect(prompt).toContain('reply with a 150-word summary of what they do, then the word DONE');
  });

  test('it still launches them in parallel and asks the parent for ALLDONE', () => {
    expect(prompt).toContain('exactly 2 Task tool calls');
    expect(prompt).toContain('in ONE message');
    expect(prompt).toContain('"reader 1" to "reader 2"');
    expect(prompt).not.toContain('sleep');
  });

  test('the finish word is not in the prompt', () => {
    expect(isFinished(prompt)).toBe(false);
  });
});

describe('isFinished reads the final reply from the screen', () => {
  test('the reply word is found', () => {
    expect(isFinished('some text\n● ALLDONE\n')).toBe(true);
  });

  test('a subagent that only said DONE does not end the run', () => {
    expect(isFinished('Task sleeper 1: DONE')).toBe(false);
  });
});

describe('the subagent type is checked against what is offered', () => {
  test('a name is read from the front matter', () => {
    expect(parseDroidName('---\nname: grunt\ndescription: x\n---\n# Grunt')).toBe('grunt');
  });

  test('a name below the front matter does not count', () => {
    expect(parseDroidName('---\ndescription: x\n---\nname: grunt')).toBeUndefined();
  });

  test('an offered type is used as asked', () => {
    expect(chooseType('grunt', ['grunt', 'worker'], 'worker')).toEqual({
      type: 'grunt',
      wanted: 'grunt',
      fellBack: false,
    });
  });

  test('a missing type falls back and says so', () => {
    expect(chooseType('grunt', ['worker', 'other'], 'worker')).toEqual({
      type: 'worker',
      wanted: 'grunt',
      fellBack: true,
    });
  });

  test('with no fallback on offer, the first offered type is used', () => {
    expect(chooseType('grunt', ['other'], 'worker').type).toBe('other');
  });
});

describe('hasSettled waits until memory is back near the target', () => {
  test('still inflated is not settled', () => {
    expect(hasSettled([900, 900, 900, 900, 900, 900], 300)).toBe(false);
  });

  test('a short series is not settled', () => {
    expect(hasSettled([300, 300, 300], 300)).toBe(false);
  });

  test('six quiet ticks in a row are settled', () => {
    expect(hasSettled([900, 800, 310, 305, 300, 320, 310, 300], 300)).toBe(true);
  });

  test('one late spike resets it', () => {
    expect(hasSettled([300, 300, 300, 300, 300, 900], 300)).toBe(false);
  });
});

describe('median', () => {
  test('odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe('readRun splits a run into baseline, peak, running and after', () => {
  const timeline = {
    sendMs: SEND,
    doneMs: DONE,
    running: { fromMs: SEND, toMs: DONE },
    excluded: [],
  };
  const reading = readRun(steadyTicks(), timeline, 4);

  test('baseline is the quiet time before sending', () => {
    expect(reading.rss?.baseline).toBe(300 * MB);
  });

  test('peak is the highest tick after sending', () => {
    expect(reading.rss?.peak).toBe(800 * MB);
  });

  test('running is the middle value once the spawn is over', () => {
    expect(reading.rss?.running).toBe(500 * MB);
  });

  test('after is read well past the final reply', () => {
    expect(reading.rss?.after).toBe(440 * MB);
  });

  test('threads follow the same phases', () => {
    expect(reading.threads?.running).toBe(28);
  });

  test('the footprint uses only the ticks that carry one', () => {
    expect(reading.footprint?.baseline).toBe(200 * MB);
  });

  test('cpu in the spawn window is counted in cpu-seconds', () => {
    expect(reading.cpu.parent.spawnSeconds).toBeCloseTo(9, 5);
  });

  test('cpu while running is a rate, next to the idle rate', () => {
    expect(reading.cpu.parent.idleCores).toBeCloseTo(0.1, 5);
    expect(reading.cpu.parent.runningCores).toBeCloseTo(0.3, 5);
  });

  test('the words give a figure per subagent', () => {
    const text = formatRun(reading, 'sleep');
    expect(text).toContain('+500.0 MB over baseline, +125.0 MB per subagent');
    expect(text).toContain('+200.0 MB over baseline, +50.0 MB per subagent');
    expect(text).toContain('+140.0 MB over baseline, +35.0 MB per subagent');
    expect(text).toContain('per subagent per minute');
  });
});

describe('child processes are costed apart from the parent', () => {
  const withChildren = steadyTicks().map((entry) => {
    if (entry.atMs >= SEND + 5000 && entry.atMs < DONE) {
      entry.processes.push(
        { pid: 2, ppid: 1, cpuMs: 0, rssKib: 100 * MB, command: 'droid exec' },
        { pid: 3, ppid: 1, cpuMs: 0, rssKib: 100 * MB, command: 'droid exec' },
      );
    }
    return entry;
  });
  const reading = readRun(
    withChildren,
    { sendMs: SEND, doneMs: DONE, running: { fromMs: SEND, toMs: DONE }, excluded: [] },
    2,
  );

  test('before sending there are no children', () => {
    expect(reading.childRss?.baseline).toBe(0);
  });

  test('the children add up per tick', () => {
    expect(reading.childRss?.peak).toBe(200 * MB);
    expect(reading.childRss?.running).toBe(200 * MB);
  });

  test('the words give a figure per subagent', () => {
    expect(formatRun(reading, 'sleep')).toContain(
      '+200.0 MB over baseline, +100.0 MB per subagent',
    );
  });

  test('the children have their own cpu, apart from the parent', () => {
    expect(reading.cpu.children.spawnSeconds).toBe(0);
    expect(reading.cpu.parent.spawnSeconds).toBeCloseTo(9, 5);
    expect(reading.cpu.children.runningCores).toBe(0);
  });

  test('the words label the parent and the children', () => {
    const text = formatRun(reading, 'sleep');
    expect(text).toContain('cpu of the parent process');
    expect(text).toContain(
      'cpu of the child processes (every descendant, shell commands included)',
    );
  });

  test('footprint of children is read only where the parent has one', () => {
    expect(reading.childFootprint?.baseline).toBe(0);
  });
});

describe('a snapshot window is left out of every figure', () => {
  const noisy = steadyTicks().map((entry) =>
    entry.atMs >= 30_000 && entry.atMs <= 33_000
      ? tick(entry.atMs, { rssMb: 2000, cpuMs: 0 })
      : entry,
  );
  const timeline = {
    sendMs: SEND,
    doneMs: DONE,
    running: { fromMs: SEND, toMs: DONE },
    excluded: [{ fromMs: 30_000, toMs: 33_000 }],
  };

  test('the spike does not become the peak', () => {
    expect(readRun(noisy, timeline, 4).rss?.peak).toBe(800 * MB);
  });
});

describe('edge cases', () => {
  test('subagents that finish inside the spawn window leave no running rate', () => {
    const reading = readRun(
      steadyTicks(),
      {
        sendMs: SEND,
        doneMs: SEND + 5000,
        running: { fromMs: SEND, toMs: SEND + 5000 },
        excluded: [],
      },
      2,
    );
    expect(reading.cpu.parent.runningCores).toBeUndefined();
    expect(formatCpu(reading.cpu, 2)).toContain('finished within the spawn window');
  });

  test('without samples before sending there is no memory phase', () => {
    expect(
      readRun(
        [tick(SEND + 1, { rssMb: 500, cpuMs: 0 })],
        { sendMs: SEND, doneMs: DONE, running: { fromMs: SEND, toMs: DONE }, excluded: [] },
        1,
      ).rss,
    ).toBeUndefined();
  });
});

describe('object counts are whole numbers', () => {
  test('a mean is rounded', () => {
    expect(objectText(887_969.8)).toBe('887,970');
  });
});

describe('heap phases and growth per subagent', () => {
  const rows: HeapRow[] = [0, 10_000, 25_000, 40_000, 60_000, 75_000].map((t, index) => ({
    t,
    pid: 1,
    rss: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
    jscHeap: (100 + index * 40) * 1_000_000,
    jscCapacity: undefined,
    jscExtra: undefined,
    objects: 1000 * (index + 1),
    top: undefined,
    costMs: undefined,
  }));
  const phases = readHeapPhases(rows, {
    sendMs: 20_000,
    doneMs: 50_000,
    running: { fromMs: 20_000, toMs: 50_000 },
    excluded: [],
  });

  test('the js heap has its own baseline and peak', () => {
    expect(phases.jsHeap?.baseline).toBe(120_000_000);
    expect(phases.jsHeap?.peak).toBe(220_000_000);
  });

  test('a sparse series is read at its last value inside the after span', () => {
    const sparse = rows.filter((row) => row.t !== 75_000);
    const timeline = {
      sendMs: 20_000,
      doneMs: 50_000,
      running: { fromMs: 20_000, toMs: 50_000 },
      excluded: [],
    };
    expect(readHeapPhases(sparse, timeline).objects?.after).toBe(5000);
  });

  test('growth is shared out between the subagents', () => {
    const text = perSubagent([{ type: 'string', from: 100, to: 500, delta: 400 }], 4);
    expect(text).toContain('+      100 per subagent');
    expect(text).toContain('+400 in all');
  });

  test('no growth is said in words', () => {
    expect(perSubagent([], 4)).toContain('no object type grew');
  });
});
