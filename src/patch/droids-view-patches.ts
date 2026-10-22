import type { Patch } from './patches.ts';
import { MODEL_OF_GLOBAL } from './session-roster-patches.ts';

const STOCK_ROW_TAIL =
  'pullRequest:s.pullRequest},l=t.get(s.sessionId);o.push(l&&kf(l,d)?l:d)}return o}';

const PATCHED_ROW_TAIL =
  `pullRequest:s.pullRequest,...globalThis.${MODEL_OF_GLOBAL}?.(e,s.sessionId)},l=t.get(s.sessionId);` +
  'o.push(l&&kf(l,d)&&l.model===d.model&&l.reasoningEffort===d.reasoningEffort?l:d)}return o}';

const STOCK_SETTINGS_LISTENER =
  '(t,{sessionId:o})=>{if(this.adoptChild(o)||this.refresh(o))this.schedulePublish(!0)}';

const PATCHED_SETTINGS_LISTENER =
  '(t,{sessionId:o})=>{if(this.adoptChild(o)||this.refresh(o)||t==="settings_updated"&&this.records.has(o))this.schedulePublish(!0)}';

const STOCK_CHIPS = `Ie=W?\`\${kT}\${h().t("common:droidsView.onScreen")}\`:""`;

const PATCHED_CHIPS =
  'Ie=[te.model&&(de(te.model).shortDisplayName||te.model)+(te.reasoningEffort?" ("+mr(te.reasoningEffort)+")":""),' +
  `W&&h().t("common:droidsView.onScreen")].filter(Boolean).map(($ODchip)=>\`\${kT}\${$ODchip}\`).join("")`;

export const droidsViewPatches: readonly Patch[] = [
  {
    name: 'droids-view-row-model',
    find: STOCK_ROW_TAIL,
    lookups: [
      'buildDroids(){let e=this.host.getSessionStateManager(),t=new Map(this.snapshot.map((s)=>[s.sessionId,s])),o=[];',
    ],
    replace: PATCHED_ROW_TAIL,
  },
  {
    name: 'droids-view-publishes-model-change',
    find: STOCK_SETTINGS_LISTENER,
    replace: PATCHED_SETTINGS_LISTENER,
  },
  {
    name: 'droids-view-row-model-chip',
    find: STOCK_CHIPS,
    lookups: ['{droid:te}=q,re=goe(te)', 'let v=de(y).shortDisplayName,M=mr(S);return'],
    replace: PATCHED_CHIPS,
  },
];
