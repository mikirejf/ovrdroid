export type Stand = object | number | boolean | null | undefined;

interface Scope {
  readonly stubs: Map<string, Stand>;
}

export function scopeOver(stubs: Map<string, Stand>) {
  return new Proxy<Scope>(
    { stubs },
    {
      has: (_target, key) => typeof key === 'string' && (stubs.has(key) || !(key in globalThis)),
      get: (_target, key) => {
        if (typeof key !== 'string') {
          return null;
        }
        if (!stubs.has(key)) {
          stubs.set(key, () => null);
        }
        return stubs.get(key);
      },
    },
  );
}

export function scoped(source: string): string {
  return `with($ODscope){return ${source}}`;
}
