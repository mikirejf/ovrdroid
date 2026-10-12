import * as t from '@babel/types';

import type { Mod, Seed } from './readable-model.ts';
import { propName } from './readable-model.ts';

interface Facts {
  typeofSym: string | undefined;
  typeofSeen: boolean;
  currentValue: boolean;
  keyIn: boolean;
  usesArguments: boolean;
  defaultProps: boolean;
  cloneMessage: boolean;
  readsTypeof: boolean;
  ink: string | undefined;
}

const CLONE_MESSAGE = 'The argument must be a React element';
const ELEMENT_SYMBOL = 'react.transitional.element';
const JSX_PARAMS = 3;
const SYMBOL_SEEDS = new Map([
  ['react.memo', 'memo'],
  ['react.forward_ref', 'forwardRef'],
  ['react.lazy', 'lazy'],
]);

function noteObject(node: t.ObjectExpression, facts: Facts, mod: Mod): void {
  for (const property of node.properties) {
    if (t.isObjectProperty(property)) {
      const name = propName(property);
      if (name === '$$typeof' && !facts.typeofSeen) {
        facts.typeofSeen = true;
        facts.typeofSym = t.isIdentifier(property.value)
          ? mod.symFor.get(property.value.name)
          : undefined;
      }
      if (name === '_currentValue') {
        facts.currentValue = true;
      }
    }
  }
}

function keysIn(node: t.Node): string[] {
  const keys: string[] = [];
  t.traverseFast(node, (inner) => {
    if (t.isIdentifier(inner)) {
      keys.push(inner.name);
    } else if (
      t.isCallExpression(inner) &&
      t.isMemberExpression(inner.callee) &&
      t.isIdentifier(inner.callee.property, { name: 'repeat' })
    ) {
      keys.push('repeat');
    }
  });
  return keys;
}

function inkKeys(call: t.CallExpression): string {
  return call.arguments
    .slice(1)
    .flatMap((arg) => keysIn(arg))
    .map((key) => ` ${key}`)
    .join('');
}

function boxName(keys: string): string | undefined {
  if (keys.includes('internal_static')) {
    return 'Static';
  }
  return keys.includes('internal_accessibility') ? 'Box' : undefined;
}

function textName(keys: string): string | undefined {
  if (keys.includes('repeat')) {
    return 'Newline';
  }
  return keys.includes('textWrap') ? 'Text' : undefined;
}

function noteInk(call: t.CallExpression, tag: string, facts: Facts): void {
  const keys = inkKeys(call);
  const found = tag === 'ink-box' ? boxName(keys) : textName(keys);
  if (found !== undefined && (facts.ink === undefined || found === 'Static' || found === 'Box')) {
    facts.ink = found;
  }
}

function noteNode(node: t.Node, facts: Facts, mod: Mod): void {
  if (t.isObjectExpression(node)) {
    noteObject(node, facts, mod);
  } else if (t.isBinaryExpression(node)) {
    facts.keyIn ||= node.operator === 'in' && t.isStringLiteral(node.left, { value: 'key' });
  } else if (t.isIdentifier(node, { name: 'arguments' })) {
    facts.usesArguments = true;
  } else if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    facts.defaultProps ||= node.property.name === 'defaultProps';
    facts.readsTypeof ||= node.property.name === '$$typeof';
  } else if (t.isStringLiteral(node)) {
    facts.cloneMessage ||= node.value.startsWith(CLONE_MESSAGE);
  } else if (mod.hasInk && t.isCallExpression(node)) {
    const [first] = node.arguments;
    if (t.isStringLiteral(first) && (first.value === 'ink-box' || first.value === 'ink-text')) {
      noteInk(node, first.value, facts);
    }
  }
}

function factsOf(fn: t.Function, mod: Mod): Facts {
  const facts: Facts = {
    typeofSym: undefined,
    typeofSeen: false,
    currentValue: false,
    keyIn: false,
    usesArguments: false,
    defaultProps: false,
    cloneMessage: false,
    readsTypeof: false,
    ink: undefined,
  };
  t.traverseFast(fn, (node) => {
    noteNode(node, facts, mod);
  });
  return facts;
}

function reactSeed(fn: t.Function, facts: Facts, mod: Mod): Seed | undefined {
  const { typeofSym } = facts;
  if (typeofSym === ELEMENT_SYMBOL && facts.keyIn && fn.params.length === JSX_PARAMS) {
    return { kind: 'jsxrt', name: 'jsx' };
  }
  const symbolName = typeofSym === undefined ? undefined : SYMBOL_SEEDS.get(typeofSym);
  if (symbolName !== undefined) {
    return { kind: 'react', name: symbolName };
  }
  if (typeofSym === 'react.context' && facts.currentValue) {
    return { kind: 'react', name: 'createContext' };
  }
  const elementParams = 2;
  if (
    facts.usesArguments &&
    facts.defaultProps &&
    !facts.typeofSeen &&
    fn.params.length >= elementParams
  ) {
    return { kind: 'react', name: 'createElement' };
  }
  if (facts.usesArguments && facts.cloneMessage) {
    return { kind: 'react', name: 'cloneElement' };
  }
  if (
    facts.readsTypeof &&
    !facts.typeofSeen &&
    fn.params.length === 1 &&
    [...mod.symFor.values()].includes(ELEMENT_SYMBOL)
  ) {
    return { kind: 'react', name: 'isValidElement' };
  }
  return undefined;
}

function isFlexGrowOnly(props: t.Node | undefined): boolean {
  if (!t.isObjectExpression(props) || props.properties.length !== 1) {
    return false;
  }
  const [only] = props.properties;
  return (
    t.isObjectProperty(only) &&
    propName(only) === 'flexGrow' &&
    t.isNumericLiteral(only.value, { value: 1 })
  );
}

function isSpacer(fn: t.Function): boolean {
  const { body } = fn;
  if (fn.params.length > 0 || !t.isBlockStatement(body) || body.body.length !== 1) {
    return false;
  }
  const [ret] = body.body;
  const callArguments = 2;
  return (
    t.isReturnStatement(ret) &&
    t.isCallExpression(ret.argument) &&
    ret.argument.arguments.length === callArguments &&
    isFlexGrowOnly(ret.argument.arguments[1])
  );
}

export function seedOfFunction(fn: t.Function, mod: Mod): Seed | undefined {
  const facts = factsOf(fn, mod);
  const react = reactSeed(fn, facts, mod);
  if (react !== undefined) {
    return react;
  }
  if (facts.ink !== undefined) {
    return { kind: 'ink', name: facts.ink };
  }
  return mod.hasInk && isSpacer(fn) ? { kind: 'ink', name: 'Spacer' } : undefined;
}
