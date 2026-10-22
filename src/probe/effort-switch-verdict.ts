import { whole } from '../cli.ts';
import { kept, ruling } from './effort-cache-verdict.ts';
import type { BustLine, UsageLine } from './logs.ts';

export type TurnName = 'seed' | 'control' | 'switched';

export interface TurnUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TurnBust {
  turn: TurnName;
  region: string;
  kind: string;
  index: number;
}

export interface SwitchOutcomes {
  efforts: Record<TurnName, string>;
  seed: TurnUsage;
  control: TurnUsage;
  switched: TurnUsage;
  busts: readonly TurnBust[];
}

export type TurnEnds = Record<TurnName, string>;

const TURN_NAMES: readonly TurnName[] = ['seed', 'control', 'switched'];

export function turnUsage(line: UsageLine): TurnUsage {
  return {
    input: line.inputTokens,
    cacheRead: line.cacheReadInputTokens,
    cacheWrite: line.cachedTokensWritten,
  };
}

export function turnLine(added: readonly UsageLine[], model: string, turn: TurnName): UsageLine {
  const line = added.findLast(({ modelId }) => modelId === model);
  if (line === undefined) {
    const seen = added.map(({ modelId }) => modelId).join(', ') || 'none';
    throw new Error(`the ${turn} turn logged no usage line for ${model}; models logged: ${seen}`);
  }
  return line;
}

export function bustsByTurn(busts: readonly BustLine[], ends: TurnEnds): TurnBust[] {
  return busts.flatMap((bust) => {
    const turn = TURN_NAMES.find((name) => bust.at <= ends[name]);
    return turn === undefined
      ? []
      : [
          {
            turn,
            region: bust.mismatchRegion,
            kind: bust.mismatchKind,
            index: bust.firstMismatchIndex,
          },
        ];
  });
}

function turnPhrase(turn: TurnName): string {
  return `the ${turn} turn`;
}

function bustLine(bust: TurnBust): string {
  return `Droid warned on ${turnPhrase(bust.turn)} that the request was not append-only: mismatch in ${bust.region}, kind ${bust.kind}, first at index ${bust.index}`;
}

function effortProblem(efforts: Record<TurnName, string>): string | undefined {
  if (efforts.seed === efforts.control && efforts.control !== efforts.switched) {
    return undefined;
  }
  return [
    'the effort did not change as intended:',
    `the seed turn ran at "${efforts.seed}", the control turn at "${efforts.control}", the switched turn at "${efforts.switched}",`,
    'so the run cannot judge the switch',
  ].join(' ');
}

export interface SwitchRuling {
  kind: 'kept' | 'busted' | 'undecided';
  text: string;
}

function undecided(text: string): SwitchRuling {
  return { kind: 'undecided', text };
}

export function switchRuling(outcomes: SwitchOutcomes): SwitchRuling {
  const { efforts, seed, control, switched } = outcomes;
  const problem = effortProblem(efforts);
  if (problem !== undefined) {
    return undecided(problem);
  }
  const from = efforts.control;
  if (control.cacheRead <= seed.cacheRead) {
    return undecided(
      `the control turn at "${from}" read ${whole(control.cacheRead)} from the cache, no more than the seed turn read (${whole(seed.cacheRead)}), so the conversation never reached the cache and the run cannot judge the switch`,
    );
  }
  const cached = control.cacheRead + control.cacheWrite;
  const warned = outcomes.busts.some((bust) => bust.turn === 'switched');
  return {
    kind: kept(switched, cached) && !warned ? 'kept' : 'busted',
    text: ruling(`switching effort from "${from}" to "${efforts.switched}"`, switched, cached),
  };
}

export function switchVerdict(outcomes: SwitchOutcomes): string {
  return [switchRuling(outcomes).text, ...outcomes.busts.map((bust) => bustLine(bust))].join('\n');
}
