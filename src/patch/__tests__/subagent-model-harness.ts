import { CHECK_DROID, SPLIT_MODEL } from '../subagent-model-patches.ts';
import { payloadFunction } from './payload.ts';

export const OPUS = 'custom:droidproxy:opus-5-5';
export const SONNET = 'custom:droidproxy:sonnet-5-5';
export const HAIKU = 'custom:droidproxy:haiku-5-5';
export const BRACKETED = 'custom:[OpenRouter]-MiniMax-M3-0';
export const KNOWN = [OPUS, SONNET, HAIKU, BRACKETED];

export interface LaunchFields {
  model?: string;
  complexity?: string;
  effort?: string;
}

export interface Launch {
  model?: string | undefined;
  inherit?: boolean | undefined;
  complexity?: string | undefined;
  effort?: string | undefined;
}

type Split = (
  fields: LaunchFields,
  valid: (id: string) => boolean,
  ids: () => readonly string[],
) => Launch;

const split = payloadFunction<[], Split>([], `${SPLIT_MODEL}return $ODsplit`)();

export function isKnown(id: string): boolean {
  return KNOWN.includes(id);
}

export function splitOf(fields: LaunchFields): Launch {
  return split(fields, isKnown, () => KNOWN);
}

export interface DroidFields {
  name?: string;
  model?: string;
  reasoningEffort?: string;
  complexity?: unknown;
  maxDepth?: unknown;
  skills?: unknown;
}

export const droidErrors = payloadFunction<
  [],
  (metadata: DroidFields, valid: (id: string) => boolean) => string[]
>([], `${CHECK_DROID}return $ODdroidErrors`)();

export function isKnownOrEmpty(id: string): boolean {
  return id === '' || isKnown(id);
}

export function splitAsStockValidates(fields: LaunchFields): Launch {
  return split(fields, isKnownOrEmpty, () => KNOWN);
}
