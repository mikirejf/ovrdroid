import { carriedLead } from '../patch/skill-carry-patches.ts';
import { entriesOf, fieldsOfJson, resultText, worded } from './fields.ts';

export interface CarryStep {
  step: string;
  after: 'typing' | 'compaction' | 'restart';
}

export const CARRY_STEPS: readonly CarryStep[] = [
  { step: 'the turn the skill was typed in', after: 'typing' },
  { step: 'the turn after the first compaction', after: 'compaction' },
  { step: 'the turn after the second compaction', after: 'compaction' },
  { step: 'the turn after a restart', after: 'restart' },
];

export interface CarryTurn extends CarryStep {
  word: string;
}

export interface CarryRun {
  skill: string;
  marker: string;
  turns: readonly CarryTurn[];
  bodies: readonly string[];
}

export interface TurnReading {
  step: string;
  typed: boolean;
  asked: boolean;
  copies: number;
  carried: boolean;
  named: boolean;
}

export type CarryOutcome = 'carried' | 'lost' | 'unproven';

const RELOAD_LINE = /Skills loaded earlier in this session, most recent first: (?<names>[^\n]*)/u;

const VERDICTS: Record<CarryOutcome, string> = {
  carried:
    'PASS: the text of a skill typed with / reaches the model once in every turn, through two compactions and a restart',
  lost: 'FAIL: after a compaction the text of a skill typed with / no longer reaches the model once per turn',
  unproven:
    'UNPROVEN: the run did not take a typed skill through a compaction, so it shows nothing',
};

function conversationOf(body: string, word: string): string | undefined {
  const request = fieldsOfJson(body);
  const messages = entriesOf(request, 'messages');
  const last = messages.at(-1);
  const isTurn =
    entriesOf(request, 'tools').length > 0 &&
    last !== undefined &&
    worded(last, 'role') === 'user' &&
    resultText(last).includes(word);
  return isTurn ? messages.map((message) => resultText(message)).join('\n') : undefined;
}

export function readCarry(run: CarryRun): TurnReading[] {
  return run.turns.map(({ step, after, word }) => {
    const typed = after === 'typing';
    const conversation = run.bodies
      .map((body) => conversationOf(body, word))
      .findLast((found) => found !== undefined);
    if (conversation === undefined) {
      return { step, typed, asked: false, copies: 0, carried: false, named: false };
    }
    const names = RELOAD_LINE.exec(conversation)?.groups?.['names'] ?? '';
    return {
      step,
      typed,
      asked: true,
      copies: conversation.split(run.marker).length - 1,
      carried: conversation.includes(carriedLead(run.skill)),
      named: names.includes(`"${run.skill}"`),
    };
  });
}

function exercised({ typed, asked, copies, carried }: TurnReading): boolean {
  if (!asked) {
    return false;
  }
  return typed ? copies > 0 : copies === 0 || carried;
}

function holds({ typed, copies, carried, named }: TurnReading): boolean {
  return copies === 1 && (typed || (carried && !named));
}

export function carryOutcome(readings: readonly TurnReading[]): CarryOutcome {
  const tested =
    readings.some((reading) => reading.typed) &&
    readings.some((reading) => !reading.typed) &&
    readings.every((reading) => exercised(reading));
  if (!tested) {
    return 'unproven';
  }
  return readings.every((reading) => holds(reading)) ? 'carried' : 'lost';
}

export function describeTurn(reading: TurnReading, skill: string): string {
  const { step, typed, asked, copies, carried, named } = reading;
  if (!asked) {
    return `${step}: no request for it reached the stub model`;
  }
  if (copies === 0 && typed) {
    return `${step}: typing /${skill} did not put the skill text in the request`;
  }
  if (copies === 0) {
    return named
      ? `${step}: the skill text is gone; the request only names "${skill}" and tells the model to reload it`
      : `${step}: the skill text is gone and nothing names "${skill}"`;
  }
  const count = copies === 1 ? 'once' : `${copies} times`;
  const where = carried ? 'carried next to the summary' : 'in the message it was typed in';
  const reload = named ? `; the reload line still names "${skill}"` : '';
  return `${step}: the request holds the skill text ${count}, ${where}${reload}`;
}

export function describeOutcome(outcome: CarryOutcome): string {
  return VERDICTS[outcome];
}
