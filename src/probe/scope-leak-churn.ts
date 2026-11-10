import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { droidChurnEvents, QUICK_CHILDREN } from './scope-leak-report.ts';
import type { DroidMutation } from './scope-leak-report.ts';
import { CHILD_MODEL } from './scope-leak.ts';

export function projectDroidChurn(enabled: boolean, droids: string, run: string) {
  const churnName = `ovrdroid-scope-unused-${run}.md`;
  const churnFile = path.join(droids, churnName);
  const mutations: DroidMutation[] = [];
  const mutate = (phase: DroidMutation['phase'], action: DroidMutation['action']) => {
    mutations.push({ atMs: Date.now(), phase, action });
    if (action === 'add') {
      writeFileSync(
        churnFile,
        `---\nname: ovrdroid-scope-unused-${run}\ndescription: Unused local watcher probe.\nmodel: custom:${CHILD_MODEL}\n---\nSay hi.\n`,
      );
    } else {
      rmSync(churnFile);
    }
  };
  return {
    mutations,
    beforeFirstReply: () => {
      if (enabled) {
        mutate('before-first-reply', 'add');
      }
    },
    advance(tornDown: number) {
      if (!enabled) {
        return;
      }
      if (
        tornDown > 0 &&
        mutations.length === 1 &&
        Date.now() - (mutations[0]?.atMs ?? 0) >= 1000
      ) {
        mutate('after-first-teardown', 'remove');
      }
      if (tornDown === QUICK_CHILDREN && mutations.length === 2) {
        mutate('after-last-teardown', 'add');
      }
    },
    evidence(log: string, pid: number, main: string) {
      if (!enabled) {
        return {};
      }
      return {
        churnDroids: {
          main,
          file: churnFile,
          mutations,
          events: droidChurnEvents(log, pid, churnName),
        },
      };
    },
  };
}
