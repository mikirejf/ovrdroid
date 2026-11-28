import { describe, expect, test } from 'bun:test';

import type { App } from '../../binary/graph.ts';
import { subagentLaunchPatches } from '../subagent-launch-patches.ts';
import { declarationText } from './module-closure.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { stockDroid as stock } from './stock-scanner.ts';

const SLUG_FUNCTION =
  /function (?<name>[\w$]+)\((?<arg>[\w$]+)\)\{return \k<arg>\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9-\]\/g,"-"\)/u;

const VALIDATOR_FUNCTION =
  /function (?<name>[\w$]+)\(\{metadata:[\w$]+,systemPrompt:[\w$]+,frontmatterIssues:[\w$]+=\[\]\}\)/u;

const DEFINITION_ERROR =
  /function (?<name>[\w$]+)\((?<arg>[\w$]+)\)\{switch\(\k<arg>\)\{case"missing_name":/u;

interface NameCheck {
  name: unknown;
  valid: boolean;
  errors: string[];
}

type NameChecker = (name: unknown) => NameCheck;
type Validate = (skill: {
  metadata: { name: unknown };
  systemPrompt: string;
}) => Omit<NameCheck, 'name'>;

interface Shipped {
  slug: unknown;
  validate: Validate;
}

function shippedFunctions(app: App): Shipped {
  for (const { text } of app) {
    const slug = SLUG_FUNCTION.exec(text)?.groups?.['name'];
    const validate = VALIDATOR_FUNCTION.exec(text)?.groups?.['name'];
    const definitionError = DEFINITION_ERROR.exec(text)?.groups?.['name'];
    if (slug !== undefined && validate !== undefined && definitionError !== undefined) {
      const code = [slug, validate, definitionError]
        .map((name) => declarationText(text, name))
        .join(';');
      return payloadFunction<[], Shipped>(
        [],
        `${code};return{slug:${slug},validate:${validate}}`,
      )();
    }
  }
  throw new Error('no shipped module holds both the slug function and the skill validator');
}

function nameChecker(shipped: Shipped, nameField: string): NameChecker {
  const build = payloadFunction<[unknown, Validate], NameChecker>(
    ['Lt', 'validate'],
    `return(name)=>{let c={name},g;${nameField}version:c.version};return{name:g.name,...validate({metadata:g,systemPrompt:"x".repeat(80)})}}`,
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
