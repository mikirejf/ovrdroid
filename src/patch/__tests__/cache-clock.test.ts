import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { FooterWorld, OTHER_SESSION, SESSION } from './footer-harness.ts';
import { MINUTE_MS } from './warmer-harness.ts';

const SENT_AT = Date.UTC(2026, 8, 29, 12, 0, 0);
const TRUSTED_MS = 45 * MINUTE_MS;
const SECOND_MS = 1000;

let footer: FooterWorld;

beforeEach(() => {
  footer = new FooterWorld();
  FooterWorld.at(SENT_AT);
});

afterEach(() => {
  FooterWorld.reset();
});

function runTurn(sentAt: number, doneAt: number): void {
  FooterWorld.at(sentAt);
  footer.render('idle');
  footer.render('streaming');
  FooterWorld.at(doneAt);
  footer.render('idle');
}

describe('what the footer says', () => {
  test('shows nothing when the session has no cache entry', () => {
    FooterWorld.cache({ [OTHER_SESSION]: SENT_AT });

    expect(footer.render()).toBe('? for help');
    expect(footer.pending).toHaveLength(0);
  });

  test('shows the trusted 45 minutes minus the seconds already spent, right after a send', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + SECOND_MS);

    expect(footer.render()).toBe('[cache 44m] ? for help');
    expect(footer.colorOf('cache 44m')).toBe('muted');
  });

  test('counts whole minutes down as the entry ages', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + 17 * MINUTE_MS + SECOND_MS);

    expect(footer.render()).toBe('[cache 27m] ? for help');
  });

  test('shows <1m through the last minute', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + TRUSTED_MS - 55 * SECOND_MS);

    expect(footer.render()).toBe('[cache <1m] ? for help');
    expect(footer.colorOf('cache <1m')).toBe('muted');
  });

  test('says cold in the warning colour the moment the trusted window is up', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + TRUSTED_MS);

    expect(footer.render()).toBe('[cache cold] ? for help');
    expect(footer.colorOf('cache cold')).toBe('warning');
  });

  test('stays cold long after the trusted window', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + 5 * TRUSTED_MS);

    expect(footer.render()).toBe('[cache cold] ? for help');
  });

  test('sits after the turn clock, separated by a comma', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    runTurn(SENT_AT, SENT_AT + 5 * SECOND_MS);

    expect(footer.render()).toBe('[\u2191<1m \u2193<1m, cache 44m] ? for help');
  });

  test('keeps the comma muted when the countdown turns cold', () => {
    runTurn(SENT_AT, SENT_AT);
    FooterWorld.cache({ [SESSION]: SENT_AT - TRUSTED_MS });

    expect(footer.render()).toBe('[\u2191<1m \u2193<1m, cache cold] ? for help');
    expect(footer.colorOf(',')).toBe('muted');
    expect(footer.colorOf('cache cold')).toBe('warning');
  });

  test('shows a cache entry before this session has any turn edge of its own', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + 20 * MINUTE_MS);

    expect(footer.render()).toBe('[cache 25m] ? for help');
  });
});

describe('where the clocks sit in the footer', () => {
  const DURATION_AND_CONTEXT = '[\u23F1 21m 6s, context: 35%]';
  const DURATION_ONLY = '[\u23F1 21m 6s]';

  test('go between the duration and the context', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    runTurn(SENT_AT, SENT_AT + 5 * SECOND_MS);
    footer.bracket = DURATION_AND_CONTEXT;

    expect(footer.render()).toBe(
      '[\u23F1 21m 6s, \u2191<1m \u2193<1m, cache 44m, context: 35%] ? for help',
    );
  });

  test('close the bracket when it holds only the duration', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    runTurn(SENT_AT, SENT_AT + 5 * SECOND_MS);
    footer.bracket = DURATION_ONLY;

    expect(footer.render()).toBe('[\u23F1 21m 6s, \u2191<1m \u2193<1m, cache 44m] ? for help');
  });

  test('open a bracket of their own when the footer has none', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    runTurn(SENT_AT, SENT_AT + 5 * SECOND_MS);

    expect(footer.render()).toBe('[\u2191<1m \u2193<1m, cache 44m] ? for help');
  });

  test('carry the countdown alone before any turn', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + SECOND_MS);
    footer.bracket = DURATION_AND_CONTEXT;

    expect(footer.render()).toBe('[\u23F1 21m 6s, cache 44m, context: 35%] ? for help');
  });

  test('carry the turn clock alone when the session has no cache entry', () => {
    runTurn(SENT_AT, SENT_AT + 5 * SECOND_MS);
    footer.bracket = DURATION_AND_CONTEXT;

    expect(footer.render()).toBe('[\u23F1 21m 6s, \u2191<1m \u2193<1m, context: 35%] ? for help');
  });

  test('leave the stock bracket untouched when there is nothing to show', () => {
    footer.bracket = DURATION_AND_CONTEXT;

    expect(footer.render()).toBe(`${DURATION_AND_CONTEXT} ? for help`);
    expect(footer.colorOf(DURATION_AND_CONTEXT)).toBe('muted');
  });
});

describe('when the footer wakes up', () => {
  test('sleeps when there is no turn clock and no cache entry', () => {
    footer.render();

    expect(footer.pending).toHaveLength(0);
  });

  test('wakes one millisecond past the cache minute boundary, so the digit has changed', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + 10 * SECOND_MS);
    footer.render();

    expect(footer.pending.map((timer) => timer.delay)).toEqual([50 * SECOND_MS + 1]);
    expect(footer.fireOnlyTimer()).toBe('[cache 43m] ? for help');
    expect(footer.pending.map((timer) => timer.delay)).toEqual([MINUTE_MS]);
  });

  test('wakes at the exact expiry moment to say cold, then sleeps', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + TRUSTED_MS - 55 * SECOND_MS);
    footer.render();

    expect(footer.pending.map((timer) => timer.delay)).toEqual([55 * SECOND_MS + 1]);
    expect(footer.fireOnlyTimer()).toBe('[cache cold] ? for help');
    expect(footer.pending).toHaveLength(0);
  });

  test('sleeps once the entry is cold and no turn clock is running', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + TRUSTED_MS + SECOND_MS);
    footer.render();

    expect(footer.pending).toHaveLength(0);
  });

  test('wakes at the cache boundary when it comes before the turn clock step', () => {
    runTurn(SENT_AT + 20 * SECOND_MS, SENT_AT + 20 * SECOND_MS);
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + 30 * SECOND_MS);
    footer.render();

    expect(footer.pending.map((timer) => timer.delay)).toEqual([30 * SECOND_MS + 1]);
    expect(footer.fireOnlyTimer()).toBe('[\u2191<1m \u2193<1m, cache 43m] ? for help');
  });

  test('wakes at the turn clock step when it comes before the cache boundary', () => {
    runTurn(SENT_AT, SENT_AT);
    FooterWorld.cache({ [SESSION]: SENT_AT + 30 * SECOND_MS });
    FooterWorld.at(SENT_AT + 40 * SECOND_MS);
    footer.render();

    expect(footer.pending.map((timer) => timer.delay)).toEqual([20 * SECOND_MS]);
    expect(footer.fireOnlyTimer()).toBe('[\u21911m \u21931m, cache 44m] ? for help');
  });

  test('keeps the turn clock running after the cache goes cold', () => {
    runTurn(SENT_AT, SENT_AT);
    FooterWorld.cache({ [SESSION]: SENT_AT - 2 * TRUSTED_MS });
    FooterWorld.at(SENT_AT + 5 * SECOND_MS);
    footer.render();

    expect(footer.pending.map((timer) => timer.delay)).toEqual([55 * SECOND_MS]);
  });

  test('a newer entry replaces the pending wake-up', () => {
    FooterWorld.cache({ [SESSION]: SENT_AT });
    FooterWorld.at(SENT_AT + 10 * SECOND_MS);
    footer.render();

    FooterWorld.cache({ [SESSION]: SENT_AT + 10 * SECOND_MS });
    FooterWorld.at(SENT_AT + 11 * SECOND_MS);
    footer.render();

    expect(footer.timers).toHaveLength(2);
    expect(footer.pending.map((timer) => timer.delay)).toEqual([59 * SECOND_MS + 1]);
  });
});
