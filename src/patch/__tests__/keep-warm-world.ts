import { afterEach, beforeEach, setSystemTime } from 'bun:test';

import { MINUTE_MS, SESSION, World } from './warmer-harness.ts';

export const START = Date.UTC(2026, 10, 5, 12, 0, 0);

export class KeepWarmWorld {
  private current: World | undefined;

  constructor() {
    beforeEach(() => {
      setSystemTime(new Date(START));
      this.current = new World();
    });
    afterEach(() => {
      setSystemTime();
      World.close();
    });
  }

  get world(): World {
    if (this.current === undefined) {
      throw new TypeError('the world exists only inside a test');
    }
    return this.current;
  }

  pendingDelay(sessionId = SESSION): number | undefined {
    return this.world.harness.warm.get(sessionId)?.timer.delay;
  }
}

export function later(minutes: number): void {
  setSystemTime(new Date(START + minutes * MINUTE_MS));
}
