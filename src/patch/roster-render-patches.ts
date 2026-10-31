import type { Patch } from './patches.ts';

const ROSTER_FACTS =
  'function $ODrosterFacts($ODs){' +
  'let $ODm=$ODs.getSnapshot();' +
  'if($ODs.$ODseen===$ODm)return $ODs.$ODfacts;' +
  '$ODs.$ODseen=$ODm;' +
  'let $ODp=$ODs.$ODfacts,$ODn=$ODm===null?null:' +
  '{identity:$ODm.identity,loaded:$ODm.loaded,working:$ODm.counts.working,needsYou:$ODm.counts.needsYou,lead:$ODm.roster.lead.droid.sessionId};' +
  'if($ODp&&$ODn&&Object.keys($ODn).every(($ODk)=>$ODn[$ODk]===$ODp[$ODk]))return $ODp;' +
  'return $ODs.$ODfacts=$ODn}';

const ROSTER_STORE =
  'function $ODrosterStore($ODd){' +
  'let $ODs=k(()=>{let $ODn=new fQ($ODd);$ODn.$ODfactsOf=()=>$ODrosterFacts($ODn);return $ODn},[$ODd]);' +
  'Na($ODs.subscribe,$ODs.$ODfactsOf);return $ODs}';

const ROSTER_LIVE =
  'var $ODquietRoster={subscribe:()=>()=>{},getSnapshot:()=>null};' +
  'function $ODrosterLive($ODs,$ODf){' +
  'let $ODq=$ODs??$ODquietRoster,$ODl=Na($ODq.subscribe,$ODq.getSnapshot);' +
  'return $ODs?$ODl:$ODf}';

const ROSTER_LINE =
  'function $ODRosterLine({$ODstore:$ODs,model:$ODm,...$ODo}){' +
  'let $ODl=$ODrosterLive($ODs,$ODm);' +
  'return $ODl?t(_q,{...$ODo,model:$ODl}):null}';

const ROSTER_HELPERS = `${ROSTER_FACTS}${ROSTER_STORE}${ROSTER_LIVE}${ROSTER_LINE}`;

const STORE_HOOK =
  'function gQ(g){let y=k(()=>new fQ(g),[g]);return Na(y.subscribe,y.getSnapshot)}';

const ROOT_STORE = 'yg=Rn(gP??void 0),Sg=xY(Fo,gP),Koe=gQ(yg?null:Fo),qoe=Sg??Koe,';

const CONTROLLER_ARGS = 'lu=SZ({model:qoe,currentSessionId:Fo,';

const CONTROLLER_ARGS_LIVE =
  'lu=SZ({get model(){return $ODrl?$ODrl.getSnapshot():qoe},currentSessionId:Fo,';

const PANE_ENTRY = 'missionRoster:Dg?{controller:lu,';

const STATUS_LINE = 'lu.model&&t(_q,{model:lu.model,width:cl,openingTitle:lu.loadingTitle})';

const PANE_READ = 'E=v?.controller.model;if(!M||!v||!E)return t(c,{});';

const PANE_HEIGHT_READ =
  'L=g?.kind==="mission-roster"?S?.missionRoster?.controller:void 0,V=L?.model,';

export const rosterRenderPatches: readonly Patch[] = [
  {
    name: 'roster-render-split',
    find: STORE_HOOK,
    lookups: [
      'function _q({model:g,width:y,openingTitle:S}){let M=u().t;if(S!==void 0)return t(c,{',
    ],
    replace: `${STORE_HOOK}${ROSTER_HELPERS}`,
  },
  {
    name: 'roster-render-split-root',
    find: ROOT_STORE,
    replace:
      'yg=Rn(gP??void 0),Sg=xY(Fo,gP),$ODrs=$ODrosterStore(yg?null:Fo),Koe=$ODrs.getSnapshot(),qoe=Sg??Koe,$ODrl=Sg?void 0:$ODrs,',
  },
  {
    name: 'roster-render-split-controller',
    find: CONTROLLER_ARGS,
    replace: CONTROLLER_ARGS_LIVE,
  },
  {
    name: 'roster-render-split-pane-entry',
    find: PANE_ENTRY,
    replace: `${PANE_ENTRY}$ODstore:$ODrl,`,
  },
  {
    name: 'roster-render-split-status-line',
    find: STATUS_LINE,
    replace:
      'lu.model&&t($ODRosterLine,{$ODstore:$ODrl,model:lu.model,width:cl,openingTitle:lu.loadingTitle})',
  },
  {
    name: 'roster-render-split-pane',
    find: PANE_READ,
    replace: 'E=$ODrosterLive(v?.$ODstore,v?.controller.model);if(!M||!v||!E)return t(c,{});',
  },
  {
    name: 'roster-render-split-pane-height',
    find: PANE_HEIGHT_READ,
    replace:
      'L=g?.kind==="mission-roster"?S?.missionRoster?.controller:void 0,V=$ODrosterLive(L&&S.missionRoster.$ODstore,L?.model),',
  },
];
