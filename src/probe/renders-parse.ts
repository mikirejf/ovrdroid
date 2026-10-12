import { fieldsOf, hasNumbers, parseJsonLines } from './fields.ts';
import type {
  CommitLine,
  HookLabel,
  HookType,
  RenderTuple,
  SnapshotCause,
  TypeEntry,
} from './renders.ts';

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return isList(value) && value.every((entry) => typeof entry === 'string');
}

function isSnapshotCause(value: unknown): value is SnapshotCause {
  return (
    isList(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number'
  );
}

function isRenderTuple(value: unknown): value is RenderTuple {
  if (!isList(value) || value.length < 3 || value.length > 6) {
    return false;
  }
  const [id, selfMs, reason, keys, hooks, snapshot] = value;
  return (
    Number.isInteger(id) &&
    typeof selfMs === 'number' &&
    typeof reason === 'string' &&
    (keys === undefined || isStringList(keys)) &&
    (hooks === undefined || (isList(hooks) && hooks.every((index) => Number.isInteger(index)))) &&
    (snapshot === undefined || isSnapshotCause(snapshot))
  );
}

function isTypeEntry(value: unknown): value is TypeEntry {
  if (!isList(value) || value.length !== 3) {
    return false;
  }
  const [id, name, source] = value;
  return Number.isInteger(id) && typeof name === 'string' && typeof source === 'string';
}

export function isHookLabel(value: unknown): value is HookLabel {
  return (
    isList(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  );
}

function isHookType(value: unknown): value is HookType {
  if (!isList(value) || value.length !== 4) {
    return false;
  }
  const [id, index] = value;
  return Number.isInteger(id) && Number.isInteger(index) && isHookLabel(value.slice(2));
}

function isAbsentOrListOf(value: unknown, guard: (entry: unknown) => boolean): boolean {
  return value === undefined || (isList(value) && value.every((entry) => guard(entry)));
}

function isCommitLine(value: unknown): value is CommitLine {
  const fields = fieldsOf(value);
  const renders = fields.get('renders');
  const activity = fields.get('activity');
  return (
    hasNumbers(fields, ['t', 'pid', 'renderMs', 'walkMs']) &&
    (activity === undefined || typeof activity === 'string') &&
    isList(renders) &&
    renders.every((entry) => isRenderTuple(entry)) &&
    isAbsentOrListOf(fields.get('types'), isTypeEntry) &&
    isAbsentOrListOf(fields.get('hookTypes'), isHookType)
  );
}

export function parseRenders(text: string): CommitLine[] {
  return parseJsonLines(text, isCommitLine);
}
