import { describe, expect, test } from 'bun:test';

import type { App } from '../../binary/graph.ts';
import { subagentLaunchPatches } from '../subagent-launch-patches.ts';
import { blockEnd } from '../tokens.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { stockDroid as stock } from './stock-scanner.ts';

const SLUG_FUNCTION =
  /function (?<name>[\w$]+)\((?<arg>[\w$]+)\)\{return \k<arg>\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9-\]\/g,"-"\)/u;

const VALIDATOR_FUNCTION =
  /function (?<name>[\w$]+)\((?<skill>[\w$]+),[\w$]+\)\{let [\w$]+=\[\],[\w$]+=\[\];if\(!\k<skill>\.name\)/u;

interface Extracted {
  name: string;
  source: string;
}

function functionMatching(text: string, head: RegExp): Extracted {
  const match = head.exec(text);
  const name = match?.groups?.['name'];
  if (match === null || name === undefined) {
    throw new Error(`no function in the shipped source matches ${head}`);
  }
  const open = text.indexOf('{', match.index);
  return { name, source: text.slice(match.index, blockEnd(text, open) + 1) };
}

interface NameCheck {
  name: unknown;
  valid: boolean;
  errors: string[];
}

type NameChecker = (name: unknown) => NameCheck;
type Validate = (skill: { name: unknown }, body: string) => Omit<NameCheck, 'name'>;

interface Shipped {
  slug: unknown;
  validate: Validate;
}

function shippedFunctions(app: App): Shipped {
  const module = app.find(
    (candidate) => SLUG_FUNCTION.test(candidate.text) && VALIDATOR_FUNCTION.test(candidate.text),
  );
  if (module === undefined) {
    throw new Error('no shipped module holds both the slug function and the skill validator');
  }
  const slug = functionMatching(module.text, SLUG_FUNCTION);
  const validator = functionMatching(module.text, VALIDATOR_FUNCTION);
  return payloadFunction<[], Shipped>(
    [],
    `${slug.source}${validator.source}return{slug:${slug.name},validate:${validator.name}}`,
  )();
}

function nameChecker(shipped: Shipped, nameField: string): NameChecker {
  const build = payloadFunction<[unknown, Validate], NameChecker>(
    ['Lt', 'validate'],
    `return(name)=>{let c={name},g;${nameField}version:c.version};return{name:g.name,...validate(g,"x".repeat(80))}}`,
  );
  return build(shipped.slug, shipped.validate);
}

const NAME_FIELD = patchNamed(subagentLaunchPatches, 'skill-name-is-its-slug').replace;
const STOCK_NAME_FIELD = patchNamed(subagentLaunchPatches, 'skill-name-is-its-slug').find;

const shipped = stock === undefined ? undefined : shippedFunctions(stock);

function checkerFor(nameField: string): NameChecker {
  return shipped === undefined
    ? () => {
        throw new Error('there is no shipped source to check names against');
      }
    : nameChecker(shipped, nameField);
}

const stockCheck = checkerFor(STOCK_NAME_FIELD);
const patchedCheck = checkerFor(NAME_FIELD);

describe.skipIf(stock === undefined)('a skill name is checked and shown as its slug', () => {
  test('stock Droid rejects a display name', () => {
    expect(stockCheck('Poteto Mode').valid).toBe(false);
  });

  test.each([
    ['Poteto Mode', 'poteto-mode'],
    ['Make Bot UI', 'make-bot-ui'],
    ['poteto-mode', 'poteto-mode'],
  ])('%s is valid and becomes %s', (name, slug) => {
    expect(patchedCheck(name)).toMatchObject({ name: slug, valid: true, errors: [] });
  });

  test.each(['!!!', '---', ''])('the name "%s" stays invalid', (name) => {
    expect(patchedCheck(name).valid).toBe(false);
  });

  test('a name that is not a string is left for the validator to judge', () => {
    expect(patchedCheck(null)).toMatchObject({
      name: null,
      valid: false,
    });
  });
});
