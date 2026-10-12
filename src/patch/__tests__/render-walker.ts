import type { HookType, RenderTuple, SnapshotCause, TypeEntry } from '../../probe/renders.ts';
import { RENDER_WALK } from '../render-profile-patches.ts';
import { payloadFunction } from './payload.ts';
import type { Fiber } from './render-fibers.ts';
import { fiber, FUNCTION, named, PERFORMED_WORK } from './render-fibers.ts';

export interface Walked {
  renders: RenderTuple[];
  refs: TypeEntry[];
  types: TypeEntry[];
  hookTypes: HookType[];
}

export interface HookState {
  memoizedState: unknown;
  queue: object | null;
  next?: HookState | null;
}

type Walker = (current: Fiber) => Walked;
export type Explain = (previous: unknown, next: unknown) => SnapshotCause | undefined;

export function updated(name: string, prev: Partial<Fiber>, next: Partial<Fiber>): Fiber {
  const type = named(name);
  const before = fiber(FUNCTION, type, prev);
  return fiber(FUNCTION, type, { flags: PERFORMED_WORK, ...next, alternate: before });
}

function unexplained(): undefined {
  return undefined;
}

export function newWalker(explain: Explain = unexplained): Walker {
  return payloadFunction<[], (explain: Explain) => Walker>([], `return ${RENDER_WALK}`)()(explain);
}
