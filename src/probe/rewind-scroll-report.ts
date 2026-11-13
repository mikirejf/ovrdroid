export const REWIND_MENU_TITLE = 'Select a user message to rewind before';
export const HISTORY_HEADER = 'Transcript history';
export const PROMPT_WORD = 'scroll probe message';
export const ANSWER_WORD = 'Answer for';
export const ANSWER_LINES = 24;
export const TOP_ROWS = 4;

const NAMED = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'] as const;
export const MIN_TURNS = 4;

export function topicsFor(turns: number): string[] {
  if (turns < MIN_TURNS) {
    throw new RangeError(`the probe needs at least ${MIN_TURNS} turns, got ${turns}`);
  }
  return turns <= NAMED.length
    ? NAMED.slice(0, turns)
    : Array.from({ length: turns }, (_, index) => `TURN${String(index + 1).padStart(3, '0')}`);
}

export function promptFor(topic: string, run: string): string {
  return `${PROMPT_WORD} ${topic} ${run}`;
}

export function answerFor(topic: string): string {
  const lines = Array.from(
    { length: ANSWER_LINES },
    (_, index) => `${ANSWER_WORD} ${topic}, line ${index + 1} of ${ANSWER_LINES}.`,
  );
  return lines.join('\n\n');
}

export function lastAnswerLine(topic: string): string {
  return `${ANSWER_WORD} ${topic}, line ${ANSWER_LINES} of ${ANSWER_LINES}.`;
}

const PROMPT = new RegExp(`${PROMPT_WORD} (?<topic>[A-Z0-9]+) `, 'u');

export function chatArea(screen: readonly string[]): string[] {
  const menu = screen.findIndex((line) => line.includes(REWIND_MENU_TITLE));
  return menu === -1 ? [...screen] : screen.slice(0, Math.max(0, menu - 1));
}

export interface ChatReading {
  menuOpen: boolean;
  historyShown: boolean;
  prompts: string[];
  firstPromptRow: number | undefined;
  answers: string[];
}

function textRows(lines: readonly string[]): string[] {
  return lines.filter((line) => line.trim() !== '');
}

export function readChat(screen: readonly string[], topics: readonly string[]): ChatReading {
  const rows = textRows(chatArea(screen));
  const history = rows.findIndex((line) => line.includes(HISTORY_HEADER));
  const content = rows.filter((line) => !line.includes(HISTORY_HEADER));
  const prompts = content.flatMap((line) => PROMPT.exec(line)?.groups?.['topic'] ?? []);
  const first = content.findIndex((line) => PROMPT.test(line));
  const answers = topics.filter((topic) =>
    content.some((line) => line.includes(`${ANSWER_WORD} ${topic},`)),
  );
  return {
    menuOpen: screen.some((line) => line.includes(REWIND_MENU_TITLE)),
    historyShown: history !== -1,
    prompts,
    firstPromptRow: first === -1 ? undefined : first,
    answers,
  };
}

export interface Verdict {
  pass: boolean;
  text: string;
}

export function shownVerdict(what: string, topic: string, reading: ChatReading): Verdict {
  const problems = [
    ...(reading.menuOpen ? [] : ['the rewind menu closed']),
    ...(reading.historyShown ? [] : ['the transcript history view never opened']),
    ...(reading.prompts[0] === topic
      ? []
      : [
          reading.prompts.length === 0
            ? 'no user message shows above the menu'
            : `the topmost user message above the menu is ${reading.prompts[0]}`,
        ]),
    ...(reading.firstPromptRow !== undefined && reading.firstPromptRow < TOP_ROWS
      ? []
      : [`its message is not within the top ${TOP_ROWS} rows of the chat`]),
  ];
  return problems.length === 0
    ? {
        pass: true,
        text: `${what}: the chat above the menu starts at the ${topic} message, with what came after it below`,
      }
    : { pass: false, text: `${what}: ${problems.join('; ')}` };
}

export function untouchedVerdict(reading: ChatReading): Verdict {
  return reading.menuOpen && !reading.historyShown
    ? { pass: true, text: 'opening the menu left the live chat as it was' }
    : {
        pass: false,
        text: reading.menuOpen
          ? 'opening the menu already switched to the transcript history view'
          : 'the rewind menu did not open',
      };
}

export function restoredVerdict(reading: ChatReading, newest: string): Verdict {
  const problems = [
    ...(reading.menuOpen ? ['the rewind menu is still open'] : []),
    ...(reading.historyShown ? ['the transcript history view is still showing'] : []),
    ...(reading.answers.includes(newest) ? [] : [`the newest answer (${newest}) is not on screen`]),
  ];
  return problems.length === 0
    ? { pass: true, text: 'Esc closed the menu and brought back the live chat' }
    : { pass: false, text: `after Esc: ${problems.join('; ')}` };
}

const LISTED = 4;

function summary(topics: readonly string[]): string {
  if (topics.length === 0) {
    return 'nothing';
  }
  return topics.length <= LISTED
    ? topics.join(', ')
    : `${topics.length} messages, ${topics[0]} to ${topics.at(-1)}`;
}

export interface ForkReading {
  forked: boolean;
  kept: string[];
}

export function forkReading(
  transcript: string | undefined,
  topics: readonly string[],
): ForkReading {
  if (transcript === undefined) {
    return { forked: false, kept: [] };
  }
  return {
    forked: true,
    kept: topics.filter((topic) => transcript.includes(`${PROMPT_WORD} ${topic} `)),
  };
}

export function rewoundVerdict(
  fork: ForkReading,
  topics: readonly string[],
  before: string,
): Verdict {
  const expected = topics.slice(0, topics.indexOf(before));
  const kept = summary(fork.kept);
  if (!fork.forked) {
    return { pass: false, text: `Enter on ${before} made no rewound chat` };
  }
  return fork.kept.join(',') === expected.join(',')
    ? { pass: true, text: `Enter on ${before} rewound the chat to before it (kept ${kept})` }
    : { pass: false, text: `Enter on ${before} kept ${kept}, expected ${summary(expected)}` };
}

export function settledVerdict(reading: ChatReading): Verdict {
  return !reading.menuOpen && !reading.historyShown
    ? { pass: true, text: 'after the rewind the menu and the history view are gone' }
    : {
        pass: false,
        text: `after the rewind ${reading.menuOpen ? 'the menu is still open' : 'the transcript history view is still showing'}`,
      };
}

export function describeVerdicts(verdicts: readonly Verdict[]): string {
  return verdicts.map((verdict) => `${verdict.pass ? 'ok  ' : 'FAIL'}  ${verdict.text}`).join('\n');
}
