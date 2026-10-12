import type { RunOptions } from '../cli.ts';
import { say } from '../cli.ts';
import { RENDERS_VARIABLE } from '../patch/render-profile-patches.ts';
import type { Recorder } from './counter-file.ts';
import { fileRecorder } from './counter-file.ts';
import { DEFAULT_KEYS, measureTyping } from './counters-run.ts';
import { busiestProcess } from './counters.ts';
import { DEFAULT_PENDING, measurePending } from './pending.ts';
import { parseRenders } from './renders-parse.ts';
import { ACTIVITY_MEANING, formatWindow, placeShown } from './renders-print.ts';
import type { RenderWindow } from './renders.ts';
import { renderWindows, summariseWindows } from './renders.ts';
import { DEFAULT_TURNS } from './resume-fixture.ts';
import { measureResume } from './resume.ts';
import { DEFAULT_PLAN, measureStream } from './stream.ts';

export const DEFAULT_TOP = 15;

const RENDERS_FILE = 'renders.jsonl';

interface Rendered {
  windows: Record<string, RenderWindow>;
}

const renderRecorder: Recorder<Rendered> = fileRecorder(
  RENDERS_VARIABLE,
  RENDERS_FILE,
  (text, spans) => {
    const lines = busiestProcess(parseRenders(text));
    if (lines.length === 0) {
      throw new Error(
        'wrote no renders: this binary lacks the render-profile patch, so apply the shipped patch set to it',
      );
    }
    return { windows: renderWindows(lines, spans) };
  },
);

interface Scenario {
  describe: string;
  measure: (binary: string) => Promise<Rendered>;
}

const SCENARIOS = {
  stream: {
    describe: `stream: a ${DEFAULT_PLAN.chars}-char markdown reply from a local stub model`,
    measure: async (binary) => await measureStream(binary, DEFAULT_PLAN, renderRecorder),
  },
  resume: {
    describe: `resume: reopening a ${DEFAULT_TURNS}-turn session, then the resize that follows it`,
    measure: async (binary) =>
      await measureResume(binary, { turns: DEFAULT_TURNS }, renderRecorder),
  },
  typing: {
    describe: `typing: 2s idle, ${DEFAULT_KEYS} typed keys, then the slash menu`,
    measure: async (binary) => await measureTyping(binary, DEFAULT_KEYS, renderRecorder),
  },
  tool: {
    describe: `tool: a tool call that stays pending, after ${DEFAULT_PENDING.leadInMs}ms, for ${DEFAULT_PENDING.windowMs}ms`,
    measure: async (binary) => await measurePending(binary, DEFAULT_PENDING, renderRecorder),
  },
} satisfies Record<string, Scenario>;

type MeasuredScenario = keyof typeof SCENARIOS;
type RenderScenario = MeasuredScenario | 'all';

function isMeasured(name: string): name is MeasuredScenario {
  return name in SCENARIOS;
}

const MEASURED = Object.keys(SCENARIOS).filter((name) => isMeasured(name));

export const RENDER_SCENARIOS: readonly RenderScenario[] = [...MEASURED, 'all'];

export interface RendersOptions extends RunOptions {
  scenario: RenderScenario;
  top: number;
}

export async function renders(binary: string, options: RendersOptions): Promise<void> {
  const scenarios = options.scenario === 'all' ? MEASURED : [options.scenario];
  say(
    `each run records every React commit; ${scenarios.map((name) => SCENARIOS[name].describe).join('; ')}`,
  );
  say(
    'self time is what React measured inside a component minus its children, on the profiling React build, so it is slower than stock; compare components with each other, not with other probes',
  );

  const windows = new Map<string, RenderWindow[]>();
  for (const scenario of scenarios) {
    for (let run = 1; run <= options.runs; run++) {
      say(`${scenario} run ${run} of ${options.runs}`);
      // oxlint-disable-next-line no-await-in-loop
      const rendered = await SCENARIOS[scenario].measure(binary);
      for (const [name, window] of Object.entries(rendered.windows)) {
        windows.set(name, [...(windows.get(name) ?? []), window]);
      }
    }
  }

  const summaries = [...windows].map(([name, runs]) => summariseWindows(name, runs));
  const places = placeShown(
    binary,
    summaries.map((summary) => summary.components),
    options.top,
  );
  say(
    `each place is where the component's code sits among the binary's own modules, found by its text; read them with probe extract ${binary}`,
  );
  say(ACTIVITY_MEANING);
  for (const summary of summaries) {
    say('');
    for (const line of formatWindow(summary, places, options.top)) {
      say(line);
    }
  }
}
