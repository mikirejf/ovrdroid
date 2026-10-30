import { readFileSync } from 'node:fs';

import { whole } from '../cli.ts';
import type { BodyRow, Divergence } from './bodies.ts';
import { compareBodies, isOneShot, isWarm, parseBodies, pathText } from './bodies.ts';
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

export type BodyComparison = ReturnType<typeof compareBodies>;

export interface RequestPair {
  control: BodyRow;
  switched: BodyRow;
}

export interface SwitchOutcomes {
  efforts: Record<TurnName, string>;
  seed: TurnUsage;
  control: TurnUsage;
  switched: TurnUsage;
  busts: readonly TurnBust[];
  body: BodyComparison | undefined;
}

export type TurnEnds = Record<TurnName, string>;

const TURN_NAMES: readonly TurnName[] = ['seed', 'control', 'switched'];
const EFFORT_SETTING = 'output_config';

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

function switchingFrom(efforts: Record<TurnName, string>): string {
  return `switching effort from "${efforts.control}" to "${efforts.switched}"`;
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

export function findRequests(
  rows: readonly BodyRow[],
  controlEnd: string,
): RequestPair | undefined {
  const main = rows.filter((row) => !isOneShot(row) && !isWarm(row));
  const endMs = Date.parse(controlEnd);
  const index = main.findLastIndex((row) => row.t <= endMs);
  const control = main[index];
  const switched = main[index + 1];
  return control === undefined || switched === undefined ? undefined : { control, switched };
}

export function compareLogged(file: string, controlEnd: string): BodyComparison | undefined {
  const requests = findRequests(parseBodies(readFileSync(file, 'utf-8')), controlEnd);
  return requests === undefined
    ? undefined
    : compareBodies(requests.control.body, requests.switched.body);
}

export function bodyRecord(body?: BodyComparison) {
  return body === undefined
    ? null
    : { extends: body.divergence === undefined, settings: [...body.settings] };
}

function undecided(text: string): SwitchRuling {
  return { kind: 'undecided', text };
}

function changedPrompt(found: Divergence): string {
  return `the switched request does not extend the control request: it changed ${found.label}, at ${pathText(found.path)}; the control request had ${found.old}, the switched request has ${found.new}`;
}

function otherSettings(body: BodyComparison): string[] {
  return body.settings.filter((key) => key !== EFFORT_SETTING);
}

function bustReasons(outcomes: SwitchOutcomes, body: BodyComparison): string[] {
  const { seed, switched } = outcomes;
  const reasons: string[] = [];
  if (body.divergence !== undefined) {
    reasons.push(changedPrompt(body.divergence));
  }
  const others = otherSettings(body);
  if (others.length > 0) {
    reasons.push(
      `the switched request changed a setting besides the effort (${EFFORT_SETTING}): ${others.join(', ')}`,
    );
  }
  reasons.push(
    ...outcomes.busts.filter((bust) => bust.turn === 'switched').map((bust) => bustLine(bust)),
  );
  if (seed.cacheRead > 0 && switched.cacheRead <= seed.cacheRead) {
    reasons.push(
      `the switched turn read none of the conversation from the cache: it read ${whole(switched.cacheRead)}, no more than the ${whole(seed.cacheRead)} the seed turn read, which is only the tools and system prompt cached before the conversation started`,
    );
  }
  return reasons;
}

function keptText(outcomes: SwitchOutcomes): string {
  const { efforts, seed, control, switched } = outcomes;
  const cached = control.cacheRead + control.cacheWrite;
  const lines = [
    `${switchingFrom(efforts)} did not bust the cache: the switched request extended the control request with only the effort changed`,
    `control turn read ${whole(control.cacheRead)} and wrote ${whole(control.cacheWrite)}; switched turn read ${whole(switched.cacheRead)} and wrote ${whole(switched.cacheWrite)}`,
  ];
  if (switched.cacheRead < cached) {
    lines.push(
      `the switched turn read ${whole(switched.cacheRead)} of the ${whole(cached)} the control turn had cached: Droid's request extended the previous one unchanged, so the ${whole(switched.cacheWrite)} tokens it re-wrote were lost outside Droid's request. In most runs the same one-time loss lands on the control turn`,
    );
  }
  if (seed.cacheRead === 0) {
    lines.push(
      'the seed turn read nothing from the cache (a cold start), so the check that the switched turn read the conversation could not run',
    );
  }
  return lines.join('\n');
}

export function switchRuling(outcomes: SwitchOutcomes): SwitchRuling {
  const problem = effortProblem(outcomes.efforts);
  if (problem !== undefined) {
    return undecided(problem);
  }
  const { body } = outcomes;
  if (body === undefined) {
    return undecided(
      'the bodies file holds no control and switched request to compare, so the run cannot judge the switch. Is the binary a `probe build --bodies` build, and did $OD_BODIES reach it?',
    );
  }
  const reasons = bustReasons(outcomes, body);
  if (reasons.length > 0) {
    return {
      kind: 'busted',
      text: [
        `${switchingFrom(outcomes.efforts)} busted the cache:`,
        ...reasons.map((reason) => `  ${reason}`),
      ].join('\n'),
    };
  }
  return { kind: 'kept', text: keptText(outcomes) };
}

export function switchVerdict(outcomes: SwitchOutcomes): string {
  const { kind, text } = switchRuling(outcomes);
  const rest = outcomes.busts.filter((bust) => kind !== 'busted' || bust.turn !== 'switched');
  return [text, ...rest.map((bust) => bustLine(bust))].join('\n');
}
