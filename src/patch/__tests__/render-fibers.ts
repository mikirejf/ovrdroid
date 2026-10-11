export const FUNCTION = 0;
export const CLASS = 1;
export const HOST_ROOT = 3;
export const HOST = 5;
export const FORWARD_REF = 11;
export const SIMPLE_MEMO = 15;
export const PERFORMED_WORK = 1;

export interface Fiber {
  tag: number;
  type: unknown;
  elementType: unknown;
  alternate: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  flags: number;
  actualDuration: number;
  memoizedProps: unknown;
  memoizedState: unknown;
  dependencies: unknown;
}

export function fiber(tag: number, type: unknown, over: Partial<Fiber> = {}): Fiber {
  return {
    tag,
    type,
    elementType: type,
    alternate: null,
    child: null,
    sibling: null,
    flags: 0,
    actualDuration: 0,
    memoizedProps: {},
    memoizedState: null,
    dependencies: null,
    ...over,
  };
}

export function withChildren(parent: Fiber, children: readonly Fiber[]): Fiber {
  parent.child = children[0] ?? null;
  for (const [index, child] of children.entries()) {
    child.sibling = children[index + 1] ?? null;
  }
  return parent;
}

export function nullComponent(): null {
  return null;
}

export function named(name: string): () => null {
  const component = nullComponent.bind(null);
  Object.defineProperty(component, 'name', { value: name });
  return component;
}

export function root(
  children: readonly Fiber[],
  previous: Fiber | null = fiber(HOST_ROOT, null),
): Fiber {
  return withChildren(fiber(HOST_ROOT, null, { alternate: previous }), children);
}
