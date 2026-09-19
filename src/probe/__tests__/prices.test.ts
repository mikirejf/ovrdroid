import { describe, expect, test } from 'bun:test';

import { fieldsOf } from '../fields.ts';
import type { CustomModel, ModelPrice } from '../prices.ts';
import {
  costOf,
  customModelsIn,
  formatPrices,
  modelsDevIdFor,
  parseCatalog,
  resolvePrices,
} from '../prices.ts';

const RAW_CATALOG = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: {
      'claude-opus-5': {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
      },
      'claude-haiku-4-5-20251001': {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
      },
      'shared-model': {
        id: 'shared-model',
        cost: { input: 2, output: 8, cache_read: 0.2, cache_write: 2.5 },
      },
      'no-price-model': { id: 'no-price-model' },
    },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: {
      'gpt-5.6-sol': {
        id: 'gpt-5.6-sol',
        name: 'GPT 5.6 Sol',
        cost: { input: 4, output: 20, cache_read: 0.4, cache_write: 5 },
      },
      'shared-model': {
        id: 'shared-model',
        cost: { input: 3, output: 9, cache_read: 0.3, cache_write: 3.75 },
      },
    },
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    models: {
      'MiniMax-M3': {
        id: 'MiniMax-M3',
        cost: { input: 0.3, output: 1.2, cache_read: 0.03, cache_write: 0.375 },
      },
      'shared-model': { id: 'shared-model', cost: { input: 4, output: 12 } },
    },
  },
  zebra: {
    id: 'zebra',
    name: 'Zebra',
    models: {
      'zebra-only': { id: 'zebra-only', cost: { input: 9, output: 18, cache_read: 0.9 } },
    },
  },
};

const CATALOG = parseCatalog(RAW_CATALOG);

const CUSTOM_MODELS: readonly CustomModel[] = [
  { id: 'custom:droidproxy:opus-5', model: 'claude-opus-5', provider: 'anthropic' },
  { id: 'custom:droidproxy:gpt-5.6-sol', model: 'gpt-5.6-sol', provider: 'openai' },
  {
    id: 'custom:[OpenRouter]-MiniMax-M3-0',
    model: 'MiniMax-M3',
    provider: 'generic-chat-completion-api',
  },
  { id: 'custom:declared:shared', model: 'shared-model', provider: 'openai' },
];

const NO_CUSTOM_MODELS: readonly CustomModel[] = [];

describe('the catalog keeps only the models whose price it actually knows', () => {
  test('every provider is kept, priced models under it', () => {
    expect(CATALOG.get('anthropic')?.get('claude-opus-5')).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
  });

  test('a model with no cost block is dropped rather than priced at zero', () => {
    expect(CATALOG.get('anthropic')?.has('no-price-model')).toBe(false);
  });

  test('missing cache fields fall back to zero, not to undefined', () => {
    expect(CATALOG.get('openrouter')?.get('shared-model')).toEqual({
      input: 4,
      output: 12,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  test('a payload that is not a catalog gives an empty map instead of throwing', () => {
    expect(parseCatalog('nonsense').size).toBe(0);
    expect(parseCatalog([]).size).toBe(0);
  });
});

describe('settings give up only the three fields a price lookup needs', () => {
  test('id, model and provider are read and nothing else is carried', () => {
    expect(
      customModelsIn(
        fieldsOf({
          customModels: [
            {
              id: 'custom:droidproxy:opus-5',
              model: 'claude-opus-5',
              provider: 'anthropic',
              apiKey: 'sk-secret',
              baseUrl: 'https://example.invalid',
            },
          ],
        }),
      ),
    ).toEqual([{ id: 'custom:droidproxy:opus-5', model: 'claude-opus-5', provider: 'anthropic' }]);
  });

  test('an entry with no id or no model is skipped', () => {
    expect(
      customModelsIn(fieldsOf({ customModels: [{ id: 'only-id' }, { model: 'only-model' }] })),
    ).toEqual([]);
  });

  test('settings with no customModels give an empty list', () => {
    expect(customModelsIn(fieldsOf({}))).toEqual([]);
    expect(customModelsIn(fieldsOf({ customModels: 'not a list' }))).toEqual([]);
  });
});

describe('a droid id maps to a models.dev id by three rules in order', () => {
  test('a declared custom model wins, its model field is the id', () => {
    expect(modelsDevIdFor('custom:droidproxy:opus-5', CUSTOM_MODELS)).toEqual({
      modelId: 'claude-opus-5',
      hint: 'anthropic',
    });
  });

  test('a declared provider that is neither anthropic nor openai gives no hint', () => {
    expect(modelsDevIdFor('custom:[OpenRouter]-MiniMax-M3-0', CUSTOM_MODELS).hint).toBeUndefined();
    expect(modelsDevIdFor('custom:[OpenRouter]-MiniMax-M3-0', CUSTOM_MODELS).modelId).toBe(
      'MiniMax-M3',
    );
  });

  test('an undeclared droidproxy name becomes a claude id under anthropic', () => {
    expect(modelsDevIdFor('custom:droidproxy:opus-4-8', NO_CUSTOM_MODELS)).toEqual({
      modelId: 'claude-opus-4-8',
      hint: 'anthropic',
    });
  });

  test('an undeclared droidproxy gpt name is the openai id as-is', () => {
    expect(modelsDevIdFor('custom:droidproxy:gpt-6-astra', NO_CUSTOM_MODELS)).toEqual({
      modelId: 'gpt-6-astra',
      hint: 'openai',
    });
  });

  test('an effort suffix is stripped before the claude prefix goes on', () => {
    expect(modelsDevIdFor('custom:droidproxy:opus-4-7-xhigh', NO_CUSTOM_MODELS).modelId).toBe(
      'claude-opus-4-7',
    );
    expect(modelsDevIdFor('custom:droidproxy:opus-5-low', NO_CUSTOM_MODELS).modelId).toBe(
      'claude-opus-5',
    );
    expect(modelsDevIdFor('custom:droidproxy:sonnet-5-medium', NO_CUSTOM_MODELS).modelId).toBe(
      'claude-sonnet-5',
    );
    expect(modelsDevIdFor('custom:droidproxy:opus-5-high', NO_CUSTOM_MODELS).modelId).toBe(
      'claude-opus-5',
    );
    expect(modelsDevIdFor('custom:droidproxy:gpt-6-astra-max', NO_CUSTOM_MODELS).modelId).toBe(
      'gpt-6-astra',
    );
  });

  test('anything else is the models.dev id itself, with no hint', () => {
    expect(modelsDevIdFor('claude-haiku-4-5-20251001', NO_CUSTOM_MODELS)).toEqual({
      modelId: 'claude-haiku-4-5-20251001',
    });
  });
});

describe('a mapped id finds its provider by preference', () => {
  test('the hint is tried before anything else', () => {
    const { priced } = resolvePrices(CATALOG, ['custom:declared:shared'], CUSTOM_MODELS);
    expect(priced[0]).toMatchObject({ provider: 'openai', modelId: 'shared-model', input: 3 });
  });

  test('with no hint anthropic comes first, then openai, then openrouter', () => {
    const { priced } = resolvePrices(CATALOG, ['shared-model'], NO_CUSTOM_MODELS);
    expect(priced[0]).toMatchObject({ provider: 'anthropic', input: 2 });
  });

  test('a model only an unlisted provider has is unmapped, not priced at a stray rate', () => {
    const { priced, unmapped } = resolvePrices(CATALOG, ['zebra-only'], NO_CUSTOM_MODELS);
    expect(priced).toEqual([]);
    expect(unmapped).toEqual(['zebra-only']);
  });

  test('an unhinted id still reaches openrouter through the preference list', () => {
    const { priced } = resolvePrices(CATALOG, ['custom:[OpenRouter]-MiniMax-M3-0'], CUSTOM_MODELS);
    expect(priced[0]).toMatchObject({ provider: 'openrouter', modelId: 'MiniMax-M3', input: 0.3 });
  });
});

describe('an id that resolves nowhere is reported, never thrown and never guessed', () => {
  test('the unmapped id is listed and the rest still get prices', () => {
    const { priced, unmapped } = resolvePrices(
      CATALOG,
      ['custom:droidproxy:opus-5', 'custom:nope:zzz'],
      CUSTOM_MODELS,
    );
    expect(unmapped).toEqual(['custom:nope:zzz']);
    expect(priced).toHaveLength(1);
    expect(priced[0]?.droidId).toBe('custom:droidproxy:opus-5');
  });
});

describe('the 1 hour cache write price is derived for anthropic only', () => {
  test('anthropic gets twice its input price', () => {
    const { priced } = resolvePrices(CATALOG, ['custom:droidproxy:opus-5'], CUSTOM_MODELS);
    expect(priced[0]).toEqual({
      droidId: 'custom:droidproxy:opus-5',
      provider: 'anthropic',
      modelId: 'claude-opus-5',
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite5m: 6.25,
      cacheWrite1h: 10,
    });
  });

  test('a non-anthropic provider has no 1 hour price at all', () => {
    const { priced } = resolvePrices(CATALOG, ['custom:droidproxy:gpt-5.6-sol'], CUSTOM_MODELS);
    expect(priced[0]?.cacheWrite1h).toBeUndefined();
  });
});

describe('costOf turns tokens into dollars at per-million prices', () => {
  const opus: ModelPrice = {
    droidId: 'custom:droidproxy:opus-5',
    provider: 'anthropic',
    modelId: 'claude-opus-5',
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
  };

  const sol: ModelPrice = {
    droidId: 'custom:droidproxy:gpt-5.6-sol',
    provider: 'openai',
    modelId: 'gpt-5.6-sol',
    input: 4,
    output: 20,
    cacheRead: 0.4,
    cacheWrite5m: 5,
  };

  test('each bucket is priced with its own rate and summed', () => {
    expect(
      costOf(opus, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWrite5mTokens: 1_000_000,
        cacheWrite1hTokens: 1_000_000,
      }),
    ).toBeCloseTo(46.75, 10);
  });

  test('a small mixed request costs a fraction of a dollar', () => {
    expect(
      costOf(opus, {
        inputTokens: 1000,
        outputTokens: 2000,
        cacheReadTokens: 100_000,
        cacheWrite5mTokens: 20_000,
        cacheWrite1hTokens: 0,
      }),
    ).toBeCloseTo(0.23, 10);
  });

  test('1 hour tokens against a model with no 1 hour price throw instead of guessing', () => {
    expect(() =>
      costOf(sol, {
        inputTokens: 10,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 1,
      }),
    ).toThrow('custom:droidproxy:gpt-5.6-sol has no 1 hour cache write price');
  });

  test('zero 1 hour tokens against that same model is fine', () => {
    expect(
      costOf(sol, {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
      }),
    ).toBeCloseTo(4, 10);
  });
});

describe('the table shows the prices and the multiples the TTL maths uses', () => {
  const { priced } = resolvePrices(
    CATALOG,
    ['custom:droidproxy:opus-5', 'custom:droidproxy:gpt-5.6-sol'],
    CUSTOM_MODELS,
  );
  const report = formatPrices(priced);

  test('every column heading is there', () => {
    expect(report).toContain('droid id');
    expect(report).toContain('provider/models.dev id');
    expect(report).toContain('write 5m');
    expect(report).toContain('write 1h');
  });

  test('the provider and models.dev id travel together in one cell', () => {
    expect(report).toContain('anthropic/claude-opus-5');
    expect(report).toContain('openai/gpt-5.6-sol');
  });

  test('the multiples of input are spelled out per model', () => {
    expect(report).toContain('custom:droidproxy:opus-5: read 0.1x, write5m 1.25x, write1h 2x');
  });

  test('a model with no 1 hour price says so in its multiples', () => {
    expect(report).toContain('custom:droidproxy:gpt-5.6-sol: read 0.1x, write5m 1.25x, write1h -');
  });

  test('nothing priced still gives a line instead of an empty table', () => {
    expect(formatPrices([])).toBe('no priced models');
  });
});
