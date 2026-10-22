import { droidsViewPatches } from '../droids-view-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import type { Store } from './session-roster-harness.ts';
import { storeOf, world } from './session-roster-harness.ts';

export { storeOf };
export type { Store };

export const STOCK_BUILD =
  'buildDroids(){let e=this.host.getSessionStateManager(),t=new Map(this.snapshot.map((s)=>[s.sessionId,s])),o=[];' +
  'for(let s of this.records.values()){if(!s.accepted)continue;let r=y1(e,s.sessionId),' +
  'a=s.parentSessionId===null?null:e.getSubagentInvocationSummary(s.sessionId)?.subagentType||null,' +
  'd={sessionId:s.sessionId,parentSessionId:s.parentSessionId,workingState:s.workingState,prompt:r,subagentType:a,' +
  'mission:s.mission,pullRequest:s.pullRequest},l=t.get(s.sessionId);o.push(l&&kf(l,d)?l:d)}return o}';

export const STOCK_LISTENER =
  '(t,{sessionId:o})=>{if(this.adoptChild(o)||this.refresh(o))this.schedulePublish(!0)}';

export const STOCK_CHIPS = `Ie=W?\`\${kT}\${h().t("common:droidsView.onScreen")}\`:""`;

export interface Row {
  sessionId: string;
  workingState: string;
  model?: string;
  reasoningEffort?: string;
}

interface Entry {
  sessionId: string;
  parentSessionId: string | null;
  workingState: string;
  accepted: boolean;
}

interface StateManager {
  getSessionManager: (id: string) => { getStore: () => Store } | undefined;
  getSubagentInvocationSummary: () => null;
}

interface Builder {
  host: { getSessionStateManager: () => StateManager };
  records: Map<string, Entry>;
  snapshot: Row[];
  buildDroids: () => Row[];
}

type BuilderClass = new () => Builder;

type Names = [() => null, (before: Row, after: Row) => boolean, object];

export const NO_MODEL: Store = storeOf();

export function patchedSnippet(stock: string, name: string): string {
  const { find, replace } = patchNamed(droidsViewPatches, name);
  if (!stock.includes(find)) {
    throw new Error(`the stock snippet no longer holds the find of ${name}`);
  }
  return stock.replace(find, () => replace);
}

const buildClass = payloadFunction<Names, BuilderClass>(
  ['y1', 'kf', 'globalThis'],
  `return class{records=new Map;snapshot=[];${patchedSnippet(STOCK_BUILD, 'droids-view-row-model')}}`,
);

function sameFields(before: Row, after: Row): boolean {
  return before.sessionId === after.sessionId && before.workingState === after.workingState;
}

export interface Roster {
  stores: Map<string, Store>;
  rows: () => Row[];
  accept: (id: string) => null;
  writeSettings: (id: string, content: string) => null;
  removeSettings: (id: string) => null;
  dispose: () => null;
}

export function roster(): Roster {
  const lookup = world();
  const { stores } = lookup;
  const manager: StateManager = {
    getSessionManager: lookup.ssm.getSessionManager,
    getSubagentInvocationSummary: () => null,
  };
  const Droids = buildClass(() => null, sameFields, lookup.bag);
  const builder = new Droids();
  builder.host = { getSessionStateManager: () => manager };
  return {
    stores,
    rows: () => {
      builder.snapshot = builder.buildDroids();
      return builder.snapshot;
    },
    accept: (id) => {
      builder.records.set(id, {
        sessionId: id,
        parentSessionId: null,
        workingState: 'idle',
        accepted: true,
      });
      return null;
    },
    writeSettings: lookup.writeSettings,
    removeSettings: lookup.removeSettings,
    dispose: lookup.dispose,
  };
}
