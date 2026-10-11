import { describe, expect, test } from 'bun:test';

import { subagentLaunchPatches } from '../subagent-launch-patches.ts';
import {
  describeStrayNames,
  failureOf,
  occurrences,
  patchNamed,
  payloadFunction,
} from './payload.ts';
import { shipped, stockDroid as stock, stockText } from './stock-scanner.ts';

describeStrayNames(subagentLaunchPatches);

interface Skill {
  metadata: { name: string; enabled?: boolean; disableModelInvocation?: boolean };
  systemPrompt: string;
  filePath: string;
  validationResult: { valid: boolean; errors: string[] };
}

interface Droid {
  metadata: { name: string; skills?: string[] };
  systemPrompt: string;
}

type Registry = () => Promise<readonly Skill[]>;
type Rewrite = (value: string) => string;
type SystemPromptBuilder = () => Promise<{ systemPrompt: string }>;
type PromptBindings = [wp: Rewrite, R: Droid, vT: Registry, Lt: Rewrite, ap: Rewrite];
type PromptFactory = (...bindings: PromptBindings) => SystemPromptBuilder;

const CONTRACT = 'Subagent contract: stand-in';

const NAME_RULE_ERROR = 'Skill name must contain only lowercase letters, numbers, and hyphens';

function skill(name: string, body: string, overrides: Partial<Skill> = {}): Skill {
  return {
    metadata: { name },
    systemPrompt: body,
    filePath: `/home/me/.agents/skills/${name}/SKILL.md`,
    validationResult: { valid: true, errors: [] },
    ...overrides,
  };
}

const POTETO = skill('poteto-mode', '# Poteto\nRead every principle first.');

function registryOf(skills: readonly Skill[], lookups?: { count: number }): Registry {
  return async () => {
    await Promise.resolve();
    if (lookups !== undefined) {
      lookups.count += 1;
    }
    return skills;
  };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/gu, '-')
    .replaceAll(/-+/gu, '-')
    .replaceAll(/^-|-$/gu, '');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;')
    .replaceAll(/[\n\r\t]/gu, ' ');
}

function withContract(body: string): string {
  return `${body.trim()}\n\n${CONTRACT}`;
}

function keepBody(body: string): string {
  return body;
}

function droidWith(skills: string[] | undefined, name = 'poteto-agent'): Droid {
  const droid: Droid = { metadata: { name }, systemPrompt: 'You are the agent.' };
  if (skills !== undefined) {
    droid.metadata.skills = skills;
  }
  return droid;
}

function promptFactory(): PromptFactory {
  const { replace } = patchNamed(subagentLaunchPatches, 'droid-skills-load-into-system-prompt');
  return payloadFunction<PromptBindings, SystemPromptBuilder>(
    ['wp', 'R', 'vT', 'Lt', 'ap'],
    `let z=0;return async()=>({${replace}z)})`,
  );
}

function promptFor(droid: Droid, registry: readonly Skill[]): SystemPromptBuilder {
  return promptFactory()(withContract, droid, registryOf(registry), normalizeName, escapeAttribute);
}

describe('a droid with skills gets each skill body in its system prompt', () => {
  test('the block names the skill and its file, between the droid body and the contract', async () => {
    const { systemPrompt } = await promptFor(droidWith(['poteto-mode']), [POTETO])();
    expect(systemPrompt).toBe(
      [
        'You are the agent.',
        '',
        '<skill name="poteto-mode" filePath="/home/me/.agents/skills/poteto-mode/SKILL.md">',
        '# Poteto\nRead every principle first.',
        '</skill>',
        '',
        CONTRACT,
      ].join('\n'),
    );
  });

  test('a skill that the model may not invoke still loads', async () => {
    const hidden = skill('hidden', 'Hidden body.');
    hidden.metadata.disableModelInvocation = true;
    const { systemPrompt } = await promptFor(droidWith(['hidden']), [POTETO, hidden])();
    expect(systemPrompt).toContain('Hidden body.');
    expect(systemPrompt).not.toContain('Read every principle first.');
  });

  test('several skills keep the order the droid lists them in', async () => {
    const { systemPrompt } = await promptFor(droidWith(['b-skill', 'a-skill']), [
      skill('a-skill', 'AAA'),
      skill('b-skill', 'BBB'),
    ])();
    expect(systemPrompt.indexOf('BBB')).toBeGreaterThan(-1);
    expect(systemPrompt.indexOf('BBB')).toBeLessThan(systemPrompt.indexOf('AAA'));
    expect(systemPrompt.indexOf('AAA')).toBeLessThan(systemPrompt.indexOf(CONTRACT));
  });

  test('a skill listed twice loads once', async () => {
    const { systemPrompt } = await promptFor(droidWith(['poteto-mode', 'poteto-mode']), [POTETO])();
    expect(systemPrompt.split('<skill name=')).toHaveLength(2);
  });

  test('two spellings of one skill load one block', async () => {
    const { systemPrompt } = await promptFor(droidWith(['Poteto Mode', 'poteto-mode']), [POTETO])();
    expect(systemPrompt.split('<skill name=')).toHaveLength(2);
    expect(systemPrompt).toContain('<skill name="poteto-mode"');
  });

  test('the name matches the way the Skill tool matches it', async () => {
    const { systemPrompt } = await promptFor(droidWith(['Poteto Mode']), [POTETO])();
    expect(systemPrompt).toContain('<skill name="poteto-mode"');
  });
});

describe('a droid without skills keeps the stock system prompt', () => {
  test.each([
    ['no skills field', undefined],
    ['an empty skills list', []],
  ])('%s', async (_label, skills) => {
    const lookups = { count: 0 };
    const droid = droidWith(skills);
    const { systemPrompt } = await promptFactory()(
      keepBody,
      droid,
      registryOf([], lookups),
      normalizeName,
      escapeAttribute,
    )();
    expect(systemPrompt).toBe(droid.systemPrompt);
    expect(lookups.count).toBe(0);
  });
});

describe('a skill that cannot load fails the launch and names the droid and the skill', () => {
  test('a missing skill', async () => {
    expect(await failureOf(promptFor(droidWith(['nope']), [POTETO])())).toBe(
      'Droid "poteto-agent" lists the skill "nope" in its skills field, but no skill with that name exists.',
    );
  });

  test('an invalid skill', async () => {
    const broken = skill('broken', 'x', {
      validationResult: { valid: false, errors: ['missing description'] },
    });
    expect(await failureOf(promptFor(droidWith(['broken']), [broken])())).toBe(
      'Droid "poteto-agent" lists the skill "broken" in its skills field, but that skill is invalid: missing description.',
    );
  });

  test('every validation error is reported, including a naming-rule error', async () => {
    const broken = skill('broken-skill', 'x', {
      validationResult: {
        valid: false,
        errors: [NAME_RULE_ERROR, 'Skill must have a system prompt'],
      },
    });
    expect(await failureOf(promptFor(droidWith(['broken-skill']), [broken])())).toBe(
      `Droid "poteto-agent" lists the skill "broken-skill" in its skills field, but that skill is invalid: ${NAME_RULE_ERROR}, Skill must have a system prompt.`,
    );
  });

  test('a disabled skill', async () => {
    const off = skill('off', 'x', { metadata: { name: 'off', enabled: false } });
    expect(await failureOf(promptFor(droidWith(['off']), [off])())).toBe(
      'Droid "poteto-agent" lists the skill "off" in its skills field, but that skill is disabled.',
    );
  });

  test('one missing skill fails the launch even when the others exist', async () => {
    expect(await failureOf(promptFor(droidWith(['poteto-mode', 'ghost']), [POTETO])())).toContain(
      '"ghost"',
    );
  });
});

const { patchedText, rebasedNamed } = shipped(subagentLaunchPatches);

describe.skipIf(stock === undefined)('each patch lands once in the shipped source', () => {
  test.each(subagentLaunchPatches.map((patch) => [patch.name] as const))('%s', (name) => {
    const { find, replace } = rebasedNamed(name);
    expect(occurrences(stockText, find)).toBe(1);
    expect(occurrences(stockText, replace)).toBe(0);
    expect(occurrences(patchedText, replace)).toBe(1);
  });

  test('the Task schema carries the readonly field next to resume', () => {
    expect(patchedText).toMatch(
      /to resume with full context preserved"\),readonly:[\w$]+\(\)\.optional\(\)\.describe\("Optional\. Set true/u,
    );
  });
});
