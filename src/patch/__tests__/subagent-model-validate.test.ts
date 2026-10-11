import { describe, expect, test } from 'bun:test';

import { CHECK_DROID, subagentModelPatches } from '../subagent-model-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import type { DroidFields } from './subagent-model-harness.ts';
import { KNOWN, OPUS } from './subagent-model-harness.ts';

interface Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface Validator {
  validateMetadata: (metadata: DroidFields, known: readonly string[]) => Validation;
}

const WARNING = 'Reasoning effort is ignored when inheriting the parent model';

const patch = patchNamed(subagentModelPatches, 'droid-validation-checks-new-fields');

const STOCK_VALIDATE_METADATA =
  'static validateModel(e,r){let t=[];if(e&&e!=="inherit"){if(!r.includes(e))t.push("Invalid model: "+e)}return{valid:t.length===0,errors:t,warnings:[]}}' +
  'static validateReasoningEffort(e,r){return["high"].includes(r)}' +
  'static validateTools(){return{errors:[],warnings:[]}}' +
  'static validateMetadata(e,r){let t=[],a=[],o=e.model??"inherit";' +
  `${patch.find}else if(!this.validateReasoningEffort(o,e.reasoningEffort))t.push("Reasoning effort \\""+e.reasoningEffort+"\\" is not supported by model "+o)}` +
  'let T=this.validateTools(e.tools,o);t.push(...T.errors),a.push(...T.warnings);return{valid:t.length===0,errors:t,warnings:a}}';

const stock = payloadFunction<[], Validator>([], `return class{${STOCK_VALIDATE_METADATA}}`)();
const patched = payloadFunction<[], Validator>(
  [],
  `${CHECK_DROID}return class{${STOCK_VALIDATE_METADATA.replace(patch.find, () => patch.replace)}}`,
)();

describe('the droid validator checks the new fields', () => {
  test('the stand-in validator ignores them before the patch', () => {
    const metadata = { name: 'deep', maxDepth: 0 };
    expect(stock.validateMetadata(metadata, KNOWN)).toMatchObject({ valid: true, errors: [] });
  });

  test('a droid without the new fields stays valid', () => {
    expect(patched.validateMetadata({ name: 'plain', model: 'inherit' }, KNOWN)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  test('a well-formed maxDepth and skills stay valid', () => {
    const metadata = { name: 'deep', maxDepth: 2, skills: ['poteto-mode'] };
    expect(patched.validateMetadata(metadata, KNOWN)).toMatchObject({ valid: true, errors: [] });
  });

  test('a leftover complexity key is not read, so the droid stays valid', () => {
    const metadata = { name: 'old', complexity: { extreme: { effort: 'low' } } };
    expect(patched.validateMetadata(metadata, KNOWN)).toMatchObject({ valid: true, errors: [] });
  });

  test('a bad maxDepth and bad skills are both reported', () => {
    const result = patched.validateMetadata({ name: 'deep', maxDepth: 0, skills: 'poteto' }, KNOWN);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join('\n')).toContain('maxDepth must be a positive integer');
    expect(result.errors.join('\n')).toContain('skills must be a list of skill names');
  });
});

describe('reasoning effort on an inherit droid is used, so it never warns', () => {
  const warningsOf = (metadata: DroidFields): string[] =>
    patched.validateMetadata({ name: 'agent', ...metadata }, KNOWN).warnings;

  test('the stand-in validator warns before the patch', () => {
    expect(
      stock.validateMetadata({ name: 'agent', model: 'inherit', reasoningEffort: 'high' }, KNOWN)
        .warnings,
    ).toEqual([WARNING]);
  });

  test.each([
    ['no model', {}],
    ['model inherit', { model: 'inherit' }],
  ])('%s has no warning for a fixed effort', (_label, model) => {
    expect(warningsOf({ ...model, reasoningEffort: 'high' })).toEqual([]);
  });

  test('an effort of inherit has no warning', () => {
    expect(warningsOf({ model: 'inherit', reasoningEffort: 'inherit' })).toEqual([]);
  });

  test('a droid with no effort has no warning', () => {
    expect(warningsOf({ model: 'inherit' })).toEqual([]);
  });

  test('a droid with its own model still has its effort checked', () => {
    const result = patched.validateMetadata(
      { name: 'agent', model: OPUS, reasoningEffort: 'low' },
      KNOWN,
    );
    expect(result.errors).toEqual([`Reasoning effort "low" is not supported by model ${OPUS}`]);
    expect(result.warnings).toEqual([]);
  });
});
