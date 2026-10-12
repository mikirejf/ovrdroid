import type { Binding, NodePath, Scope } from '@babel/traverse';
import * as t from '@babel/types';

import type { Mod } from './readable-model.ts';
import { needsCapital, propName } from './readable-model.ts';

export type TypeRef = [Binding, t.JSXIdentifier];

export type Built =
  | {
      node: t.JSXElement | t.JSXFragment;
      refs: TypeRef[];
      typeBinding: Binding | undefined;
    }
  | { reason: string };

type Attribute = t.JSXAttribute | t.JSXSpreadAttribute;

type Child = t.JSXElement['children'][number];

interface Parts {
  attrs: Attribute[];
  children: Child[];
}

interface Context {
  scope: Scope;
  mod: Mod;
  refs: TypeRef[];
}

const SAFE_TEXT = /^[^\s{}<>&](?:[^\r\n\t{}<>&]*[^\s{}<>&])?$/u;
const SAFE_ATTR = /^[^"\\\r\n&]*$/u;
const ATTR_NAME = /^[A-Za-z_$][\w$-]*$/u;
const TAG_NAME = /^[A-Za-z][\w-]*$/u;
const MIN_JSX_ARGS = 2;
const MAX_JSX_ARGS = 3;
const FIRST_CHILD_ARG = 2;

function typeName(
  ctx: Context,
  expr: t.Expression,
): t.JSXIdentifier | t.JSXMemberExpression | string {
  if (t.isIdentifier(expr)) {
    const node = t.jsxIdentifier(expr.name);
    const binding = ctx.scope.getBinding(expr.name);
    if (binding) {
      ctx.refs.push([binding, node]);
    } else if (needsCapital(expr.name)) {
      return 'lowercase global as type';
    }
    return node;
  }
  if (
    t.isMemberExpression(expr) &&
    !expr.computed &&
    t.isIdentifier(expr.property) &&
    t.isExpression(expr.object)
  ) {
    const object = typeName(ctx, expr.object);
    if (typeof object === 'string') {
      return object;
    }
    if (t.isJSXIdentifier(object)) {
      ctx.mod.memberRoots.add(object);
    }
    return t.jsxMemberExpression(object, t.jsxIdentifier(expr.property.name));
  }
  return 'dynamic type';
}

function isTrueLiteral(value: t.Expression): boolean {
  return (
    t.isBooleanLiteral(value, { value: true }) ||
    (t.isUnaryExpression(value, { operator: '!' }) &&
      t.isNumericLiteral(value.argument, { value: 0 }))
  );
}

function attributeValue(value: t.Expression): t.JSXAttribute['value'] {
  if (isTrueLiteral(value)) {
    return null;
  }
  if (t.isStringLiteral(value) && SAFE_ATTR.test(value.value)) {
    const literal = t.stringLiteral(value.value);
    literal.extra = { raw: `"${value.value}"`, rawValue: value.value };
    return literal;
  }
  return t.jsxExpressionContainer(value);
}

function attribute(name: string, value: t.Expression): Attribute {
  if (!ATTR_NAME.test(name)) {
    return t.jsxSpreadAttribute(
      t.objectExpression([t.objectProperty(t.stringLiteral(name), value)]),
    );
  }
  return t.jsxAttribute(t.jsxIdentifier(name), attributeValue(value));
}

function childOf(expr: t.Expression, previous: Child | undefined): Child {
  if (t.isJSXElement(expr) || t.isJSXFragment(expr)) {
    return expr;
  }
  if (t.isStringLiteral(expr) && SAFE_TEXT.test(expr.value) && !t.isJSXText(previous)) {
    return t.jsxText(expr.value);
  }
  return t.jsxExpressionContainer(expr);
}

function isPlainProps(props: t.ObjectExpression): boolean {
  return props.properties.every(
    (property) =>
      t.isSpreadElement(property) ||
      (t.isObjectProperty(property) &&
        propName(property) !== undefined &&
        t.isExpression(property.value)),
  );
}

interface Props {
  attrs: Attribute[];
  children: t.Expression | undefined;
}

function plainProps(props: t.ObjectExpression, attrs: Attribute[]): Props {
  let children: t.Expression | undefined;
  for (const property of props.properties) {
    if (t.isSpreadElement(property)) {
      attrs.push(t.jsxSpreadAttribute(property.argument));
    } else if (t.isObjectProperty(property) && t.isExpression(property.value)) {
      const name = propName(property);
      if (name === 'children') {
        children = property.value;
      } else if (name !== undefined) {
        attrs.push(attribute(name, property.value));
      }
    }
  }
  return { attrs, children };
}

function propsOf(props: t.Expression | undefined, key: t.Expression | undefined): Props {
  const attrs: Attribute[] = key ? [attribute('key', key)] : [];
  if (
    props === undefined ||
    t.isNullLiteral(props) ||
    t.isIdentifier(props, { name: 'undefined' })
  ) {
    return { attrs, children: undefined };
  }
  if (t.isObjectExpression(props) && isPlainProps(props)) {
    return plainProps(props, attrs);
  }
  attrs.push(t.jsxSpreadAttribute(props));
  return { attrs, children: undefined };
}

function isFlatArray(expr: t.Expression): expr is t.ArrayExpression & { elements: t.Expression[] } {
  return (
    t.isArrayExpression(expr) &&
    expr.elements.every((element) => element !== null && !t.isSpreadElement(element))
  );
}

function childExpressions(
  role: 'jsx' | 'create',
  args: t.Expression[],
  inProps: t.Expression | undefined,
): t.Expression[] | string {
  if (role === 'create') {
    const rest = args.slice(FIRST_CHILD_ARG);
    if (inProps && rest.length > 0) {
      return 'children in props and varargs';
    }
    return inProps ? [inProps] : rest;
  }
  if (!inProps) {
    return [];
  }
  return isFlatArray(inProps) ? inProps.elements : [inProps];
}

function childNodes(expressions: readonly t.Expression[]): Child[] {
  const nodes: Child[] = [];
  for (const expr of expressions) {
    nodes.push(childOf(expr, nodes.at(-1)));
  }
  return nodes;
}

function fragmentOf(ctx: Context, type: t.Expression, attrs: Attribute[]): boolean {
  if (!t.isIdentifier(type) || ctx.mod.roles.get(type.name) !== 'fragment' || attrs.length > 0) {
    return false;
  }
  const binding = ctx.scope.getBinding(type.name);
  return binding !== undefined && binding.scope === ctx.mod.prog;
}

function intrinsic(tag: string, { attrs, children }: Parts): Built {
  if (!TAG_NAME.test(tag)) {
    return { reason: 'odd intrinsic tag' };
  }
  const selfClosing = children.length === 0;
  return {
    node: t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier(tag), attrs, selfClosing),
      selfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(tag)),
      children,
    ),
    refs: [],
    typeBinding: undefined,
  };
}

function component(ctx: Context, type: t.Expression, { attrs, children }: Parts): Built {
  const open = typeName(ctx, type);
  if (typeof open === 'string') {
    return { reason: open };
  }
  const close = typeName(ctx, type);
  if (typeof close === 'string') {
    return { reason: close };
  }
  const selfClosing = children.length === 0;
  return {
    node: t.jsxElement(
      t.jsxOpeningElement(open, attrs, selfClosing),
      selfClosing ? null : t.jsxClosingElement(close),
      children,
    ),
    refs: ctx.refs,
    typeBinding: t.isIdentifier(type) ? ctx.scope.getBinding(type.name) : undefined,
  };
}

function argumentsOf(call: t.CallExpression, role: 'jsx' | 'create'): t.Expression[] | string {
  const { arguments: args } = call;
  if (args.length === 0) {
    return 'no arguments';
  }
  if (role === 'jsx' && (args.length < MIN_JSX_ARGS || args.length > MAX_JSX_ARGS)) {
    return 'unexpected arity';
  }
  const expressions = args.filter((arg) => t.isExpression(arg));
  return expressions.length === args.length ? expressions : 'spread argument';
}

export function buildElement(
  path: NodePath<t.CallExpression>,
  role: 'jsx' | 'create',
  mod: Mod,
): Built {
  const args = argumentsOf(path.node, role);
  if (typeof args === 'string') {
    return { reason: args };
  }
  const [type, propsArg, third] = args;
  if (type === undefined) {
    return { reason: 'no arguments' };
  }
  const ctx: Context = { scope: path.scope, mod, refs: [] };
  const { attrs, children: inProps } = propsOf(propsArg, role === 'jsx' ? third : undefined);
  const expressions = childExpressions(role, args, inProps);
  if (typeof expressions === 'string') {
    return { reason: expressions };
  }
  const children = childNodes(expressions);
  if (fragmentOf(ctx, type, attrs)) {
    return {
      node: t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), children),
      refs: [],
      typeBinding: undefined,
    };
  }
  return t.isStringLiteral(type)
    ? intrinsic(type.value, { attrs, children })
    : component(ctx, type, { attrs, children });
}
