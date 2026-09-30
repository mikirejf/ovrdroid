import { describe, expect, test } from 'bun:test';

import { CONSTRUCTOR_BINDS, LAZY_METHODS, patches } from '../patches.ts';

const patch = patches.find((entry) => entry.name === 'zod-v3-lazy-bound-methods');

if (patch === undefined) {
  throw new TypeError('zod-v3-lazy-bound-methods is missing from the patch list');
}

const { replace } = patch;

type Method = () => string;

interface StandardSchema {
  version: number;
  vendor: string;
  validate: Method;
}

interface Schema {
  _def: string;
  '~standard'?: StandardSchema;
  [name: string]: string | Method | StandardSchema | undefined;
}

type SchemaClass = (new (definition: string) => Schema) & { prototype: Schema };

function buildLazy(): SchemaClass {
  const methodSource = LAZY_METHODS.map((name) => `${name}(){return this._def+":${name}"}`).join(
    '',
  );
  // SAFETY: the evaluated source is the patch payload wrapped in the class body
  // it replaces, so the constructed value is exactly the SchemaClass shape.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-call, typescript/no-unsafe-type-assertion
  return new Function(`return class{${methodSource}${replace}}}`)() as SchemaClass;
}

function replacedParse(this: Schema): string {
  return `${this._def}:replaced`;
}

function methodOf(schema: Schema, name: string): Method {
  const method = schema[name];
  if (typeof method !== 'function') {
    throw new TypeError(`${name} is not callable on the schema`);
  }
  return method;
}

const Lazy = buildLazy();
const lazyPrototype = Lazy.prototype;

describe('the constructor the patch matches', () => {
  test('the replacement performs no bind inside the constructor', () => {
    const start = replace.indexOf('constructor(t){');
    expect(start).toBeGreaterThan(0);
    expect(replace.slice(start)).not.toContain('.bind(this)');
  });
});

describe('lazy accessors behave like the per-instance bound copies', () => {
  test('every detached method still carries its instance', () => {
    const lazy = new Lazy('S');

    for (const name of LAZY_METHODS) {
      const detached = methodOf(lazy, name);
      expect(detached()).toBe(`S:${name}`);
    }
  });

  test('detaching from one instance does not capture another', () => {
    const first = methodOf(new Lazy('one'), 'parse');
    const second = methodOf(new Lazy('two'), 'parse');

    expect(first()).toBe('one:parse');
    expect(second()).toBe('two:parse');
  });

  test('spa aliases safeParseAsync, as the constructor did', () => {
    const lazy = new Lazy('S');
    expect(methodOf(lazy, 'spa')()).toBe(methodOf(lazy, 'safeParseAsync')());
  });

  test('reading a method twice yields the same function object', () => {
    const lazy = new Lazy('S');
    expect(lazy['parse']).toBe(lazy['parse']);
  });

  test('an assignment wins, and stays local to its instance', () => {
    const lazy = new Lazy('S');
    lazy['parse'] = () => 'overwritten';

    expect(methodOf(lazy, 'parse')()).toBe('overwritten');
    expect(methodOf(new Lazy('S'), 'parse')()).toBe('S:parse');
  });

  test('reading a method off the prototype does not poison later instances', () => {
    void lazyPrototype['safeParseAsync'];

    expect(methodOf(new Lazy('S'), 'safeParseAsync')()).toBe('S:safeParseAsync');
  });

  test('an object inheriting from the prototype gets working accessors', () => {
    const derived: Schema = { _def: 'S' };
    Object.setPrototypeOf(derived, lazyPrototype);

    expect(methodOf(derived, 'parse')()).toBe('S:parse');
  });

  test('every bound name the constructor covered is callable', () => {
    const lazy = new Lazy('S');
    for (const name of CONSTRUCTOR_BINDS) {
      expect(typeof methodOf(lazy, name)).toBe('function');
    }
  });

  test('the constructor installs the standard-schema property', () => {
    const lazy = new Lazy('S');
    expect(lazy['~standard']?.vendor).toBe('zod');
  });

  test('construction leaves no bound copies on the instance', () => {
    expect(Object.keys(new Lazy('S')).toSorted()).toEqual(['_def', '~standard']);
  });
});

describe('an assignment through the prototype chain stays lazy and stays local', () => {
  test('assigning on the class prototype binds per instance', () => {
    const Fresh = buildLazy();
    Fresh.prototype['parse'] = replacedParse;

    expect(Object.keys(new Fresh('S')).toSorted()).toEqual(['_def', '~standard']);
    expect(methodOf(new Fresh('S'), 'parse')()).toBe('S:replaced');
  });

  test('assigning on a subclass prototype leaves the base class alone', () => {
    const Base = buildLazy();
    class Sub extends Base {}
    Sub.prototype['parse'] = replacedParse;

    expect(methodOf(new Sub('S'), 'parse')()).toBe('S:replaced');
    expect(methodOf(new Base('S'), 'parse')()).toBe('S:parse');
  });

  test('assigning on a bare derived object leaves the base class alone', () => {
    const Base = buildLazy();
    // SAFETY: the object is created from the class prototype, so it has the
    // Schema shape apart from the `_def` that the test never reads.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const bare = Object.create(Base.prototype) as Schema;
    bare['parse'] = () => 'bare';

    expect(methodOf(bare, 'parse')()).toBe('bare');
    expect(methodOf(new Base('S'), 'parse')()).toBe('S:parse');
  });
});

describe('a reentrant proxy trap cannot cross two pending installs', () => {
  test('a defineProperty trap that reads a second method leaves both correct', () => {
    const Base = buildLazy();
    const target = new Base('S');
    const proxy = new Proxy(target, {
      defineProperty(owner, key, descriptor) {
        if (key === 'parse') {
          void proxy['safeParse'];
        }
        return Reflect.defineProperty(owner, key, descriptor);
      },
    });

    expect(methodOf(proxy, 'parse')()).toBe('S:parse');
    expect(methodOf(proxy, 'safeParse')()).toBe('S:safeParse');
  });

  test('a getOwnPropertyDescriptor trap firing during a set leaves both correct', () => {
    const Base = buildLazy();
    const target = new Base('S');
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(owner, key) {
        if (key === 'parse') {
          void proxy['safeParse'];
        }
        return Reflect.getOwnPropertyDescriptor(owner, key);
      },
    });

    proxy['parse'] = replacedParse;

    expect(methodOf(proxy, 'parse').call(target)).toBe('S:replaced');
    expect(methodOf(proxy, 'safeParse')()).toBe('S:safeParse');
  });
});
